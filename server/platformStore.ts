// Private durable account data. Never place this directory inside the public website folder.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual, randomBytes } from 'node:crypto';
import { emptyHistory, loadHistory, pruneHistory, type ChatHistory } from '../src/lib/chatHistory';
import type { HistorySnapshot } from '../src/lib/historyMerge';

export class PlatformError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface VenueEvent { id: string; title: string; venue: string; startsAt: number; endsAt: number; capacity: number; open: boolean }
export interface VenuePass { id: string; eventId: string; ownerId: string; email: string; status: 'issued' | 'checked-in' | 'revoked'; issuedAt: number; checkedAt: number | null; revokedAt: number | null }

export class PlatformStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') { mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS histories (uid TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, deleted TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venue_events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venue_passes (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL, issued_at INTEGER NOT NULL, checked_at INTEGER, revoked_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_pass ON venue_passes(event_id, owner_id) WHERE status != 'revoked';
      CREATE TABLE IF NOT EXISTS venue_audit (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, pass_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, uid TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS push_owner ON push_subscriptions(uid);
      CREATE TABLE IF NOT EXISTS push_jobs (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    `);
    if (path !== ':memory:') { try { chmodSync(path, 0o600); } catch { /* Windows ACLs are configured on the mounted volume. */ } }
  }
  close() { this.db.close(); }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setting(key: string, create: () => string): string {
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run(key, create());
    return (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any).value;
  }
  history(uid: string): HistorySnapshot {
    const row = this.db.prepare('SELECT * FROM histories WHERE uid = ?').get(uid) as any;
    const result: HistorySnapshot = row ? { revision: row.revision, history: JSON.parse(row.data), deleted: JSON.parse(row.deleted) } : { revision: 0, history: emptyHistory(), deleted: [] };
    const pruned = pruneHistory(result.history);
    if (pruned.removed) return this.saveHistory(uid, result.revision, pruned.data);
    return result;
  }
  saveHistory(uid: string, revision: number, input: ChatHistory): HistorySnapshot {
    // Use the same parser as local migration, with no implicit writes or eviction.
    const parsed = loadHistory({ getItem: () => JSON.stringify(input), setItem() {}, removeItem() {} }, uid).data;
    if (parsed.threads.length > 500 || parsed.threads.some(t => t.id.length > 160 || t.title.length > 100 || t.messages.length > 2000)) throw new PlatformError(413, 'History is too large. Export and remove older conversations before syncing.');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM histories WHERE uid = ?').get(uid) as any;
      if ((row?.revision || 0) !== revision) throw new PlatformError(409, 'History changed on another device.');
      const previous: ChatHistory = row ? JSON.parse(row.data) : emptyHistory();
      const ids = new Set(parsed.threads.map(t => t.id));
      const deleted = new Set<string>(row ? JSON.parse(row.deleted) : []);
      previous.threads.filter(t => !ids.has(t.id)).forEach(t => deleted.add(t.id));
      const history = { ...parsed, activeThreadId: null, threads: parsed.threads.filter(t => !deleted.has(t.id)) };
      this.db.prepare('INSERT OR REPLACE INTO histories VALUES (?, ?, ?, ?)').run(uid, revision + 1, JSON.stringify(history), JSON.stringify([...deleted]));
      return { revision: revision + 1, history, deleted: [...deleted] };
    });
  }
  pruneHistories() { for (const row of this.db.prepare('SELECT uid FROM histories').all() as any[]) this.history(row.uid); }
  events(): VenueEvent[] { return (this.db.prepare('SELECT data FROM venue_events').all() as any[]).map(row => JSON.parse(row.data)); }
  event(id: string) { return this.events().find(event => event.id === id); }
  saveEvent(event: VenueEvent, actor: string) {
    return this.transaction(() => {
      if (event.capacity < this.passes(event.id).filter(p => p.status !== 'revoked').length) throw new PlatformError(409, 'Capacity cannot be lower than the number of active passes.');
      this.db.prepare('INSERT OR REPLACE INTO venue_events VALUES (?, ?)').run(event.id, JSON.stringify(event));
      this.audit(event.id, '', actor, 'event-saved'); return event;
    });
  }
  passes(eventId?: string, ownerId?: string): VenuePass[] {
    return (this.db.prepare('SELECT * FROM venue_passes WHERE (? IS NULL OR event_id = ?) AND (? IS NULL OR owner_id = ?) ORDER BY issued_at DESC').all(eventId || null, eventId || null, ownerId || null, ownerId || null) as any[]).map(row => ({ id: row.id, eventId: row.event_id, ownerId: row.owner_id, email: row.email, status: row.status, issuedAt: row.issued_at, checkedAt: row.checked_at, revokedAt: row.revoked_at }));
  }
  issue(eventId: string, ownerId: string, email: string) {
    return this.transaction(() => {
      const event = this.event(eventId);
      if (!event || !event.open || Date.now() >= event.endsAt) throw new PlatformError(409, 'This event is closed for admission passes.');
      const passes = this.passes(eventId), existing = passes.find(p => p.ownerId === ownerId && p.status !== 'revoked');
      if (existing) return existing;
      if (passes.filter(p => p.status !== 'revoked').length >= event.capacity) throw new PlatformError(409, 'This event has reached its pass capacity.');
      const pass: VenuePass = { id: randomUUID(), eventId, ownerId, email, status: 'issued', issuedAt: Date.now(), checkedAt: null, revokedAt: null };
      this.db.prepare('INSERT INTO venue_passes VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)').run(pass.id, eventId, ownerId, email, pass.status, pass.issuedAt);
      this.audit(eventId, pass.id, ownerId, 'issued'); return pass;
    });
  }
  code(pass: VenuePass) {
    const key = this.setting('venue-signing-key', () => randomBytes(32).toString('hex'));
    return `ARENAHUB-PASS.v1.${pass.id}.${createHmac('sha256', key).update(pass.id).digest('base64url')}`;
  }
  checkIn(eventId: string, code: string, actor: string) {
    return this.transaction(() => {
      const parts = code.split('.');
      const pass = this.passes(eventId).find(p => p.id === parts[2]);
      if (!pass || parts.length !== 4 || Buffer.byteLength(code) !== Buffer.byteLength(this.code(pass)) || !timingSafeEqual(Buffer.from(code), Buffer.from(this.code(pass)))) throw new PlatformError(400, 'The admission pass is invalid for this event.');
      const event = this.event(eventId)!;
      if (!event.open || Date.now() < event.startsAt || Date.now() >= event.endsAt) throw new PlatformError(409, 'Venue check-in is outside the event admission window.');
      if (pass.status !== 'issued') throw new PlatformError(409, pass.status === 'checked-in' ? 'This pass has already been checked in.' : 'This pass was revoked.');
      this.db.prepare("UPDATE venue_passes SET status = 'checked-in', checked_at = ? WHERE id = ?").run(Date.now(), pass.id);
      this.audit(eventId, pass.id, actor, 'checked-in'); return this.passes(eventId).find(p => p.id === pass.id)!;
    });
  }
  revoke(id: string, actor: string) {
    return this.transaction(() => {
      const pass = this.passes().find(p => p.id === id);
      if (!pass) throw new PlatformError(404, 'Pass not found.');
      this.db.prepare("UPDATE venue_passes SET status = 'revoked', revoked_at = ? WHERE id = ?").run(Date.now(), id);
      this.audit(pass.eventId, id, actor, 'revoked');
    });
  }
  audit(eventId: string, passId: string, actor: string, action: string) { this.db.prepare('INSERT INTO venue_audit VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), eventId, passId, actor, action, Date.now()); }
}
