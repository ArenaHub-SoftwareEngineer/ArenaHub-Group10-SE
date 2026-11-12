// Local storage for the Match Integrity Monitor. Everything here stays on the event laptop:
// raw device reports and recordings never go to Firestore or Firebase Storage, which keeps
// ArenaHub on the free Spark plan and keeps monitoring data off the public internet.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_MONITOR_CONFIG, monitorConfigSchema, PAIRING_ALPHABET, scoreSignals, type MonitorConfig, type MonitorGame, type MonitorPlatform, type Signal, type SignalId, type Severity } from '../src/lib/integrityRisk.ts';

export const HEARTBEAT_SECONDS = 15;
export const LOST_AFTER_MS = 45_000;
export const PAIRING_TTL_MS = 5 * 60_000;
export const RETENTION_MS = 30 * 24 * 3600_000;

export interface SessionRow {
  id: string; match_id: string; match_label: string; game: MonitorGame; platform: MonitorPlatform; player_name: string;
  expected_steam_id: string; created_by: string; created_at: number; expires_at: number; code_hash: string | null; code_expires_at: number;
  token_hash: string | null; claimed_at: number | null; device: string | null; status: 'pending' | 'active' | 'ended'; ended_at: number | null;
  team: string; last_seen: number | null; last_facts: string | null; gsi: string | null; review_note: string; hold: number; media_bytes: number;
}
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// Node 24's recursive rmSync fails silently on Windows paths with non-ASCII characters
// (this project folder has an em dash), so folders are removed file by file.
function removeTree(path: string) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) { for (const entry of readdirSync(path)) removeTree(join(path, entry)); rmdirSync(path); }
  else unlinkSync(path);
}

export class IntegrityStore {
  readonly db: DatabaseSync;
  readonly mediaRoot: string;
  constructor(dataDir: string, readonly now: () => number = Date.now) {
    const root = resolve(dataDir);
    mkdirSync(root, { recursive: true });
    this.mediaRoot = join(root, 'recordings');
    mkdirSync(this.mediaRoot, { recursive: true });
    this.db = new DatabaseSync(join(root, 'integrity.db'));
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, match_label TEXT NOT NULL, game TEXT NOT NULL, platform TEXT NOT NULL,
        player_name TEXT NOT NULL, expected_steam_id TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        code_hash TEXT, code_expires_at INTEGER NOT NULL, token_hash TEXT, claimed_at INTEGER, device TEXT, status TEXT NOT NULL, ended_at INTEGER,
        last_seen INTEGER, last_facts TEXT, gsi TEXT, review_note TEXT NOT NULL DEFAULT '', hold INTEGER NOT NULL DEFAULT 0, media_bytes INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS sessions_match ON sessions(match_id);
      CREATE UNIQUE INDEX IF NOT EXISTS sessions_token ON sessions(token_hash);
      CREATE TABLE IF NOT EXISTS signals (session_id TEXT NOT NULL, signal_id TEXT NOT NULL, severity TEXT NOT NULL, evidence TEXT NOT NULL,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (session_id, signal_id, evidence));
      CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, session_id TEXT NOT NULL, note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    // Databases created before teams existed get the column added in place.
    const columns = this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'team')) this.db.exec(`ALTER TABLE sessions ADD COLUMN team TEXT NOT NULL DEFAULT ''`);
  }

  config(): MonitorConfig {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get('monitor') as { value: string } | undefined;
    if (!row) return structuredClone(DEFAULT_MONITOR_CONFIG);
    const parsed = monitorConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : structuredClone(DEFAULT_MONITOR_CONFIG);
  }
  saveConfig(value: unknown, actor: string) {
    const config = monitorConfigSchema.parse(value);
    this.db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('monitor', JSON.stringify(config));
    this.audit(actor, 'config-updated', '', 'Monitor blocklists or thresholds changed');
    return config;
  }
  audit(actor: string, action: string, sessionId: string, note: string) {
    this.db.prepare('INSERT INTO audit (at, actor, action, session_id, note) VALUES (?, ?, ?, ?, ?)').run(this.now(), actor, action, sessionId, note.slice(0, 500));
  }

  createPairing(input: { matchId: string; matchLabel: string; game: MonitorGame; platform: MonitorPlatform; playerName: string; team?: string; expectedSteamId: string; hours: number }, actor: string) {
    const id = randomBytes(12).toString('base64url');
    const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
    const now = this.now();
    this.db.prepare(`INSERT INTO sessions (id, match_id, match_label, game, platform, player_name, team, expected_steam_id, created_by, created_at, expires_at, code_hash, code_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(id, input.matchId, input.matchLabel, input.game, input.platform, input.playerName, input.team || '', input.expectedSteamId, actor, now, now + input.hours * 3600_000, sha256(code), now + PAIRING_TTL_MS);
    this.audit(actor, 'pairing-created', id, `${input.playerName} on ${input.platform} for ${input.matchLabel}`);
    return { id, code, codeExpiresAt: now + PAIRING_TTL_MS };
  }
  /** Single use: the code is erased the moment a device claims it. */
  claim(code: string, device: Record<string, string>) {
    const now = this.now();
    const row = this.db.prepare(`SELECT * FROM sessions WHERE code_hash = ? AND status = 'pending'`).get(sha256(code.trim().toUpperCase())) as SessionRow | undefined;
    if (!row || row.code_expires_at < now || row.expires_at < now) return null;
    const token = randomBytes(32).toString('base64url');
    this.db.prepare(`UPDATE sessions SET code_hash = NULL, token_hash = ?, claimed_at = ?, device = ?, status = 'active', last_seen = ? WHERE id = ?`).run(sha256(token), now, JSON.stringify(device), now, row.id);
    this.audit('device', 'device-paired', row.id, `${device.model || 'device'} ${device.os || ''}`.trim());
    return { token, session: this.session(row.id)! };
  }
  session(id: string) {
    this.expire();
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }
  byToken(token: string) {
    this.expire();
    return this.db.prepare(`SELECT * FROM sessions WHERE token_hash = ? AND status = 'active'`).get(sha256(token)) as SessionRow | undefined;
  }
  sessions(matchId?: string) {
    this.expire();
    return (matchId ? this.db.prepare('SELECT * FROM sessions WHERE match_id = ? ORDER BY created_at DESC').all(matchId) : this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200').all()) as unknown as SessionRow[];
  }
  /** Match windows close on their own: past expiry, a session can no longer report. */
  private expire() {
    const now = this.now();
    this.db.prepare(`UPDATE sessions SET status = 'ended', ended_at = expires_at, token_hash = NULL, code_hash = NULL WHERE status != 'ended' AND expires_at < ?`).run(now);
  }
  end(id: string, actor: string, reason: string) {
    const result = this.db.prepare(`UPDATE sessions SET status = 'ended', ended_at = ?, token_hash = NULL, code_hash = NULL WHERE id = ? AND status != 'ended'`).run(this.now(), id);
    if (result.changes) this.audit(actor, 'session-ended', id, reason);
    return result.changes > 0;
  }

  heartbeat(row: SessionRow, facts: unknown, signals: Signal[]) {
    const now = this.now();
    if (row.last_seen && now - row.last_seen > LOST_AFTER_MS) signals = [...signals, { id: 'heartbeat-lost', severity: 'medium', evidence: `No report for ${Math.round((now - row.last_seen) / 1000)} s` }];
    this.db.prepare('UPDATE sessions SET last_seen = ?, last_facts = ? WHERE id = ?').run(now, JSON.stringify(facts), row.id);
    this.recordSignals(row.id, signals);
  }
  recordSignals(sessionId: string, signals: Signal[]) {
    const now = this.now();
    const upsert = this.db.prepare(`INSERT INTO signals (session_id, signal_id, severity, evidence, first_seen, last_seen, count) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(session_id, signal_id, evidence) DO UPDATE SET last_seen = excluded.last_seen, count = count + 1, severity = excluded.severity`);
    for (const s of signals) upsert.run(sessionId, s.id, s.severity, s.evidence, now, now);
  }
  saveGsi(row: SessionRow, gsi: unknown, signals: Signal[]) {
    this.db.prepare('UPDATE sessions SET gsi = ?, last_seen = ? WHERE id = ?').run(JSON.stringify(gsi), this.now(), row.id);
    this.recordSignals(row.id, signals);
  }
  signals(sessionId: string) {
    return this.db.prepare('SELECT signal_id AS id, severity, evidence, first_seen AS firstSeen, last_seen AS lastSeen, count FROM signals WHERE session_id = ? ORDER BY last_seen DESC').all(sessionId) as unknown as { id: SignalId; severity: Severity; evidence: string; firstSeen: number; lastSeen: number; count: number }[];
  }
  /**
   * Live risk: stored signals, plus a lost-contact signal while an active device is silent.
   * An iPhone cannot report in the background, so it is judged on whether a recording arrived instead.
   */
  liveSignals(row: SessionRow): Pick<Signal, 'id' | 'severity'>[] {
    if (row.platform === 'ios') return row.status === 'ended' && row.claimed_at && row.media_bytes === 0 ? [{ id: 'recording-missing', severity: 'medium' }] : [];
    return row.status === 'active' && row.last_seen && this.now() - row.last_seen > LOST_AFTER_MS ? [{ id: 'heartbeat-lost', severity: 'medium' }] : [];
  }
  risk(row: SessionRow) {
    return scoreSignals([...this.signals(row.id), ...this.liveSignals(row)], this.config().thresholds);
  }
  connection(row: SessionRow): 'waiting' | 'online' | 'paired' | 'lost' | 'ended' {
    if (row.status === 'ended') return 'ended';
    if (row.status === 'pending') return 'waiting';
    if (row.platform === 'ios') return 'paired';
    return row.last_seen && this.now() - row.last_seen > LOST_AFTER_MS ? 'lost' : 'online';
  }

  addMedia(row: SessionRow, kind: 'video' | 'image', data: Buffer) {
    const dir = join(this.mediaRoot, row.id);
    mkdirSync(dir, { recursive: true });
    const file = `${this.now()}-${randomBytes(3).toString('hex')}.${kind === 'video' ? 'mp4' : 'jpg'}`;
    writeFileSync(join(dir, file), data);
    const info = this.db.prepare('INSERT INTO media (session_id, kind, file, bytes, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, kind, file, data.length, this.now());
    this.db.prepare('UPDATE sessions SET media_bytes = media_bytes + ?, last_seen = ? WHERE id = ?').run(data.length, this.now(), row.id);
    return Number(info.lastInsertRowid);
  }
  // Large uploads (an iPhone screen recording can be several GB) arrive in ordered chunks.
  beginUpload(row: SessionRow, extension: 'mp4' | 'mov') {
    const dir = join(this.mediaRoot, row.id);
    mkdirSync(dir, { recursive: true });
    const file = `${this.now()}-${randomBytes(3).toString('hex')}.${extension}`;
    writeFileSync(join(dir, `${file}.part`), Buffer.alloc(0));
    return file;
  }
  appendUpload(row: SessionRow, file: string, data: Buffer) { appendFileSync(join(this.mediaRoot, row.id, `${file}.part`), data); }
  finishUpload(row: SessionRow, file: string) {
    const path = join(this.mediaRoot, row.id, file);
    renameSync(`${path}.part`, path);
    const bytes = statSync(path).size;
    const info = this.db.prepare('INSERT INTO media (session_id, kind, file, bytes, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, 'video', file, bytes, this.now());
    this.db.prepare('UPDATE sessions SET media_bytes = media_bytes + ?, last_seen = ? WHERE id = ?').run(bytes, this.now(), row.id);
    this.audit('device', 'recording-uploaded', row.id, `${(bytes / 1024 / 1024).toFixed(1)} MB`);
    return Number(info.lastInsertRowid);
  }
  abortUpload(row: SessionRow, file: string) { try { unlinkSync(join(this.mediaRoot, row.id, `${file}.part`)); } catch {} }
  media(sessionId: string) {
    return this.db.prepare('SELECT id, kind, bytes, created_at AS createdAt FROM media WHERE session_id = ? ORDER BY created_at').all(sessionId) as unknown as { id: number; kind: string; bytes: number; createdAt: number }[];
  }
  mediaFile(sessionId: string, mediaId: number) {
    const row = this.db.prepare('SELECT kind, file FROM media WHERE session_id = ? AND id = ?').get(sessionId, mediaId) as { kind: string; file: string } | undefined;
    return row ? { kind: row.kind, path: join(this.mediaRoot, sessionId, row.file), type: row.kind === 'image' ? 'image/jpeg' : row.file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' } : null;
  }
  auditFor(sessionId: string) {
    return this.db.prepare('SELECT at, actor, action, note FROM audit WHERE session_id = ? ORDER BY at').all(sessionId);
  }
  review(id: string, actor: string, note: string, hold: boolean) {
    this.db.prepare('UPDATE sessions SET review_note = ?, hold = ? WHERE id = ?').run(note, hold ? 1 : 0, id);
    this.audit(actor, hold ? 'evidence-held' : 'reviewed', id, note);
  }

  /** 30-day retention. Sessions a referee marked "hold" (attached to a case) are kept. */
  cleanup() {
    this.expire();
    const cutoff = this.now() - RETENTION_MS;
    const old = this.db.prepare(`SELECT id FROM sessions WHERE hold = 0 AND created_at < ? AND status = 'ended'`).all(cutoff) as { id: string }[];
    for (const { id } of old) {
      removeTree(join(this.mediaRoot, id));
      for (const table of ['media', 'signals']) this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      this.audit('system', 'retention-deleted', id, 'Recordings and signals deleted after 30 days');
    }
    return old.length;
  }
  close() { this.db.close(); }
}
