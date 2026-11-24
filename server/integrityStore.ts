// Local storage for the Match Integrity Monitor. Everything here stays on the event laptop:
// raw device reports and recordings never go to Firestore or Firebase Storage, which keeps
// ArenaHub on the free Spark plan and keeps monitoring data off the public internet.
// The hosted API uses FirestoreIntegrityStore instead (see server/monitorStore.ts).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_MONITOR_CONFIG, monitorConfigSchema, PAIRING_ALPHABET, type MonitorConfig, type MonitorPlatform, type Signal } from '../src/lib/integrityRisk.ts';
import { IOS_CLEARANCE_MS, foundIndicators, iosReviewSchema, type IosReviewInput, type IosClearance } from '../src/lib/iosAntiCheat.ts';
import { HEARTBEAT_SECONDS, LOST_AFTER_MS, PAIRING_TTL_MS, RETENTION_MS, RoomError, WrongDeviceError, claimingPlatform, connectionOf, liveSignalsOf, lostGapSignal, policyVersionOf, riskOf, roomOpen, scanOf, sha256, slotBlocked,
  type MediaItem, type MonitorStore, type Pairing, type PairingInput, type RoomInput, type RoomRow, type SessionRow, type StoredSignal } from './monitorStore.ts';

export { HEARTBEAT_SECONDS, LOST_AFTER_MS, PAIRING_TTL_MS, RETENTION_MS, WrongDeviceError, claimingPlatform, sha256, type SessionRow };
const idOf = (row: SessionRow | string) => typeof row === 'string' ? row : row.id;

// Node 24's recursive rmSync fails silently on Windows paths with non-ASCII characters
// (this project folder has an em dash), so folders are removed file by file.
function removeTree(path: string) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) { for (const entry of readdirSync(path)) removeTree(join(path, entry)); rmdirSync(path); }
  else unlinkSync(path);
}

export class IntegrityStore implements MonitorStore {
  readonly db: DatabaseSync;
  readonly mediaRoot: string;
  readonly heartbeatSeconds = HEARTBEAT_SECONDS;
  readonly lostAfterMs = LOST_AFTER_MS;
  readonly recordings = true;
  readonly gsiMinGapMs = 0;
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS ios_clearances (session_id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    // Databases created before teams existed get the column added in place.
    const columns = this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'team')) this.db.exec(`ALTER TABLE sessions ADD COLUMN team TEXT NOT NULL DEFAULT ''`);
    if (!columns.some(c => c.name === 'record')) this.db.exec(`ALTER TABLE sessions ADD COLUMN record INTEGER NOT NULL DEFAULT 1`);
    if (!columns.some(c => c.name === 'gsi_token_hash')) this.db.exec('ALTER TABLE sessions ADD COLUMN gsi_token_hash TEXT');
    if (!columns.some(c => c.name === 'player_key')) this.db.exec("ALTER TABLE sessions ADD COLUMN player_key TEXT NOT NULL DEFAULT ''");
    if (!columns.some(c => c.name === 'scan_challenge')) this.db.exec("ALTER TABLE sessions ADD COLUMN scan_challenge TEXT NOT NULL DEFAULT ''");
    if (!columns.some(c => c.name === 'roster_version')) this.db.exec("ALTER TABLE sessions ADD COLUMN roster_version TEXT NOT NULL DEFAULT ''");
    // 1: staff did not choose a device; the app or page that claims the code decides it (any phone for MLBB/CODM).
    if (!columns.some(c => c.name === 'platform_flexible')) this.db.exec('ALTER TABLE sessions ADD COLUMN platform_flexible INTEGER NOT NULL DEFAULT 0');
    if (!columns.some(c => c.name === 'room_id')) this.db.exec("ALTER TABLE sessions ADD COLUMN room_id TEXT NOT NULL DEFAULT ''");
    for (const column of ['email', 'college', 'email_check']) if (!columns.some(c => c.name === column)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    if (!columns.some(c => c.name === 'passed_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN passed_at INTEGER');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_gsi_token ON sessions(gsi_token_hash)');
    this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS screen_staff (screen_key TEXT PRIMARY KEY, emails TEXT NOT NULL, updated_at INTEGER NOT NULL)');
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

  createPairing(input: PairingInput, actor: string): Pairing {
    const id = randomBytes(12).toString('base64url');
    const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
    const now = this.now();
    this.db.prepare(`INSERT INTO sessions (id, match_id, match_label, game, platform, player_name, team, record, expected_steam_id, created_by, created_at, expires_at, code_hash, code_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(id, input.matchId, input.matchLabel, input.game, input.platform, input.playerName, input.team || '', input.record === false ? 0 : 1, input.expectedSteamId, actor, now, now + input.hours * 3600_000, sha256(code), now + PAIRING_TTL_MS);
    this.audit(actor, 'pairing-created', id, `${input.playerName} on ${input.flexible ? 'any phone' : input.platform} for ${input.matchLabel}`);
    this.db.prepare('UPDATE sessions SET player_key = ?, scan_challenge = ?, roster_version = ?, platform_flexible = ?, room_id = ?, email = ?, college = ?, email_check = ? WHERE id = ?').run(input.playerKey || '', randomBytes(24).toString('hex'), input.rosterVersion || '', input.flexible ? 1 : 0, input.roomId || '', input.email || '', input.college || '', input.emailCheck || '', id);
    return { id, code, codeExpiresAt: now + PAIRING_TTL_MS };
  }
  /** A pending pairing for a valid, unexpired code, without using the code up. */
  pending(code: string) {
    this.expire();
    const row = this.db.prepare(`SELECT * FROM sessions WHERE code_hash = ? AND status = 'pending'`).get(sha256(code.trim().toUpperCase())) as SessionRow | undefined;
    return row && row.code_expires_at >= this.now() ? row : undefined;
  }
  /** The player said no. The code is used up, and staff see the decision straight away. */
  decline(code: string) {
    const row = this.pending(code);
    if (!row) return undefined;
    this.db.prepare(`UPDATE sessions SET status = 'declined', ended_at = ?, code_hash = NULL WHERE id = ?`).run(this.now(), row.id);
    this.recordSignals(row.id, [{ id: 'monitoring-declined', severity: 'medium', evidence: 'The player chose Decline on the consent screen' }]);
    this.audit('player', 'player-declined', row.id, 'The player declined monitoring for this match');
    return this.session(row.id);
  }
  /**
   * Single use: the code is erased the moment a device claims it. An any-phone code takes the platform of
   * the app or page claiming it; a device that cannot play this game is refused and the code stays usable.
   */
  claim(code: string, device: Record<string, string>, allowed?: MonitorPlatform[]) {
    const now = this.now();
    let row = this.db.prepare(`SELECT * FROM sessions WHERE code_hash = ? AND status = 'pending'`).get(sha256(code.trim().toUpperCase())) as SessionRow | undefined;
    if (!row || row.code_expires_at < now || row.expires_at < now) return null;
    if (row.platform_flexible === 1) {
      const platform = claimingPlatform(device.agent);
      if (!platform || (allowed && !allowed.includes(platform))) throw new WrongDeviceError();
      this.db.prepare('UPDATE sessions SET platform = ?, platform_flexible = 0 WHERE id = ?').run(platform, row.id);
      row = { ...row, platform, platform_flexible: 0 };
    }
    const token = randomBytes(32).toString('base64url');
    const gsiToken = row.game === 'dota2' && row.platform === 'pc' ? randomBytes(32).toString('base64url') : undefined;
    this.db.prepare(`UPDATE sessions SET code_hash = NULL, token_hash = ?, gsi_token_hash = ?, claimed_at = ?, device = ?, status = 'active', last_seen = ? WHERE id = ?`).run(sha256(token), gsiToken ? sha256(gsiToken) : null, now, JSON.stringify(device), now, row.id);
    this.audit('device', 'device-paired', row.id, `${device.model || 'device'} ${device.os || ''}`.trim());
    return { token, ...(gsiToken ? { gsiToken } : {}), session: this.session(row.id)! };
  }
  session(id: string) {
    this.expire();
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }
  policyVersion() { return policyVersionOf(this.config()); }
  scan(row: SessionRow) { return scanOf(row, this.config(), this.iosClearance(row.id), this.now()); }
  iosClearance(session: SessionRow | string): IosClearance | null {
    const row = this.db.prepare('SELECT value FROM ios_clearances WHERE session_id = ?').get(idOf(session)) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  reviewIos(id: string, actor: string, value: IosReviewInput) {
    const input = iosReviewSchema.parse(value), row = this.session(id), found = foundIndicators(input);
    if (!row || row.platform !== 'ios' || row.game === 'dota2' || (input.approved && row.status !== 'active')) throw new Error('Pair an active iPhone session before inspection.');
    const review: IosClearance = { approved: input.approved, reviewedAt: this.now(), validUntil: input.approved ? Math.min(row.expires_at, this.now() + IOS_CLEARANCE_MS) : this.now(), actor, note: found.length ? `Found: ${found.join("; ")}. ${input.note}`.slice(0, 2600) : input.note, challenge: row.scan_challenge, policyVersion: this.policyVersion(), rosterVersion: row.roster_version, ...(found.length ? { indicatorsFound: found } : {}) };
    this.db.prepare('INSERT INTO ios_clearances (session_id, value) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET value = excluded.value').run(id, JSON.stringify(review));
    this.audit(actor, input.approved ? 'ios-inspection-approved' : 'ios-clearance-revoked', id, JSON.stringify(input));
    return review;
  }
  byToken(token: string) {
    this.expire();
    return this.db.prepare(`SELECT * FROM sessions WHERE token_hash = ? AND status = 'active'`).get(sha256(token)) as SessionRow | undefined;
  }
  /** The token written into Dota's GSI config cannot control, upload to or stop a device session. */
  byGsiToken(token: string) {
    this.expire();
    return this.db.prepare(`SELECT * FROM sessions WHERE gsi_token_hash = ? AND status = 'active' AND game = 'dota2' AND platform = 'pc'`).get(sha256(token)) as SessionRow | undefined;
  }
  sessions(matchId?: string) {
    this.expire();
    return (matchId ? this.db.prepare('SELECT * FROM sessions WHERE match_id = ? ORDER BY created_at DESC, rowid DESC').all(matchId) : this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 200').all()) as unknown as SessionRow[];
  }
  /** Match windows close on their own: past expiry, a session can no longer report. */
  private expire() {
    const now = this.now();
    this.db.prepare(`UPDATE sessions SET status = 'ended', ended_at = expires_at, token_hash = NULL, gsi_token_hash = NULL, code_hash = NULL WHERE status IN ('pending', 'active') AND expires_at < ?`).run(now);
  }
  end(id: string, actor: string, reason: string) {
    const result = this.db.prepare(`UPDATE sessions SET status = 'ended', ended_at = ?, token_hash = NULL, gsi_token_hash = NULL, code_hash = NULL WHERE id = ? AND status IN ('pending', 'active')`).run(this.now(), id);
    if (result.changes) this.audit(actor, 'session-ended', id, reason);
    return result.changes > 0;
  }

  heartbeat(row: SessionRow, facts: unknown, signals: Signal[]) {
    const now = this.now();
    signals = [...signals, ...lostGapSignal(row, now, this.lostAfterMs)];
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
    // Match telemetry is not proof that device checks are still running.
    this.db.prepare('UPDATE sessions SET gsi = ? WHERE id = ?').run(JSON.stringify(gsi), row.id);
    this.recordSignals(row.id, signals);
  }
  signals(session: SessionRow | string) {
    return this.db.prepare('SELECT signal_id AS id, severity, evidence, first_seen AS firstSeen, last_seen AS lastSeen, count FROM signals WHERE session_id = ? ORDER BY last_seen DESC').all(idOf(session)) as unknown as StoredSignal[];
  }
  /** Live risk: stored signals, plus a lost-contact signal while an active device is silent. */
  liveSignals(row: SessionRow) { return liveSignalsOf(row, this.now(), this.lostAfterMs); }
  risk(row: SessionRow) { return riskOf(this.signals(row.id), row, this.config(), this.now(), this.lostAfterMs); }
  connection(row: SessionRow) { return connectionOf(row, this.now(), this.lostAfterMs); }

  addMedia(row: SessionRow, kind: 'video' | 'image', data: Buffer) {
    const dir = join(this.mediaRoot, row.id);
    mkdirSync(dir, { recursive: true });
    const file = `${this.now()}-${randomBytes(3).toString('hex')}.${kind === 'video' ? 'mp4' : 'jpg'}`;
    writeFileSync(join(dir, file), data);
    const info = this.db.prepare('INSERT INTO media (session_id, kind, file, bytes, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, kind, file, data.length, this.now());
    this.db.prepare('UPDATE sessions SET media_bytes = media_bytes + ? WHERE id = ?').run(data.length, row.id);
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
    this.db.prepare('UPDATE sessions SET media_bytes = media_bytes + ? WHERE id = ?').run(bytes, row.id);
    this.audit('device', 'recording-uploaded', row.id, `${(bytes / 1024 / 1024).toFixed(1)} MB`);
    return Number(info.lastInsertRowid);
  }
  abortUpload(row: SessionRow, file: string) { try { unlinkSync(join(this.mediaRoot, row.id, `${file}.part`)); } catch {} }
  media(session: SessionRow | string) {
    return this.db.prepare('SELECT id, kind, bytes, created_at AS createdAt FROM media WHERE session_id = ? ORDER BY created_at').all(idOf(session)) as unknown as MediaItem[];
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

  markPassed(row: SessionRow, at: number) { this.db.prepare('UPDATE sessions SET passed_at = ? WHERE id = ? AND passed_at IS NULL').run(at, row.id); }

  /** 30-day retention. Sessions a referee marked "hold" (attached to a case) are kept. */
  cleanup() {
    this.expire();
    const cutoff = this.now() - RETENTION_MS;
    const old = this.db.prepare(`SELECT id FROM sessions WHERE hold = 0 AND created_at < ? AND status IN ('ended', 'declined')`).all(cutoff) as { id: string }[];
    for (const { id } of old) {
      removeTree(join(this.mediaRoot, id));
      for (const table of ['media', 'signals', 'ios_clearances']) this.db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      this.audit('system', 'retention-deleted', id, 'Recordings and signals deleted after 30 days');
    }
    return old.length;
  }

  // ---------- Rooms ----------
  createRoom(input: RoomInput, actor: string): RoomRow {
    const now = this.now();
    const room: RoomRow = { id: randomBytes(9).toString('base64url'), label: input.label, match_id: input.matchId, game: input.game, roster_version: input.rosterVersion, players: input.players,
      secret: randomBytes(32).toString('base64url'), record: input.record ? 1 : 0, hours: input.hours, created_by: actor, created_at: now, expires_at: now + input.hours * 3600_000, closed_at: null, joined: {}, ...(input.testRoom ? { test_room: true } : {}), ...(input.verifiedCheckIn ? { verified_checkin: true } : {}) };
    this.db.prepare('INSERT INTO rooms (id, value, created_at) VALUES (?, ?, ?)').run(room.id, JSON.stringify(room), now);
    this.audit(actor, 'room-opened', '', `${input.label} (${input.players.length || 'typed'} players)`);
    return room;
  }
  room(id: string): RoomRow | undefined {
    const row = this.db.prepare('SELECT value FROM rooms WHERE id = ?').get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  rooms(): RoomRow[] {
    return (this.db.prepare('SELECT value FROM rooms WHERE created_at > ? ORDER BY created_at DESC LIMIT 50').all(this.now() - 2 * 24 * 3600_000) as { value: string }[]).map(r => JSON.parse(r.value));
  }
  private saveRoom(room: RoomRow) { this.db.prepare('UPDATE rooms SET value = ? WHERE id = ?').run(JSON.stringify(room), room.id); }
  screenStaff(): Record<string, string[]> {
    const rows = this.db.prepare('SELECT screen_key, emails FROM screen_staff').all() as { screen_key: string; emails: string }[];
    return Object.fromEntries(rows.map(row => [row.screen_key, JSON.parse(row.emails)]));
  }
  setScreenStaff(key: string, emails: string[], actor: string) {
    if (emails.length) this.db.prepare('INSERT INTO screen_staff (screen_key, emails, updated_at) VALUES (?, ?, ?) ON CONFLICT(screen_key) DO UPDATE SET emails = excluded.emails, updated_at = excluded.updated_at').run(key, JSON.stringify(emails), this.now());
    else this.db.prepare('DELETE FROM screen_staff WHERE screen_key = ?').run(key);
    this.audit(actor, 'screen-facilitator', '', key + ' · ' + (emails.join(', ') || 'removed'));
  }
  closeRoom(id: string, actor: string) {
    const room = this.room(id);
    if (!room || room.closed_at) return false;
    this.saveRoom({ ...room, closed_at: this.now() });
    this.audit(actor, 'room-closed', '', room.label);
    return true;
  }
  joinRoom(roomId: string, slot: string, pairing: PairingInput): Pairing {
    // node:sqlite is synchronous, so nothing else runs between this check and the write.
    const room = this.room(roomId);
    if (!room || !roomOpen(room, this.now())) throw new RoomError(404, 'This room is closed. Ask the referee.');
    const held = room.joined[slot];
    const blocked = slotBlocked(held ? this.session(held.sessionId) : undefined, this.now());
    if (blocked) throw new RoomError(409, blocked);
    const issued = this.createPairing({ ...pairing, roomId }, 'room');
    this.saveRoom({ ...room, joined: { ...room.joined, [slot]: { sessionId: issued.id, at: this.now() } } });
    return issued;
  }
  resetRoomSlot(roomId: string, slot: string, actor: string) {
    const room = this.room(roomId), held = room?.joined[slot];
    if (!room || !held) return false;
    this.end(held.sessionId, actor, 'Staff reset this player in the room so they can join again');
    const { [slot]: _removed, ...rest } = room.joined;
    const name = this.session(held.sessionId)?.player_name || slot;
    this.saveRoom({ ...room, joined: rest, resets: [...(room.resets || []), { slot, name, sessionId: held.sessionId, by: actor, at: this.now() }].slice(-200) });
    this.audit(actor, 'room-slot-reset', held.sessionId, `${room.label}: ${slot}`);
    return true;
  }
  close() { this.db.close(); }
}
