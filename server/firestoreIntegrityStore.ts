// Match Integrity Monitor storage for the hosted API (Vercel), where no disk survives between requests.
// Kerr chose this on 23 Nov 2026 so players can join from one fixed web address without the event laptop.
//
// Collections (server only; firestore.rules denies every client, and the Admin SDK bypasses rules):
//   monitorSessions/{id}  one document per pairing: the SessionRow fields, its signals and iPhone clearance
//   monitorAudit/{auto}   audit trail
//   monitorRooms/{id}     room codes (the secret behind each changing code never leaves the server)
//   monitorScreenStaff/{screen key}  facilitators assigned to watch a match's live screens
//   monitorSettings/config  blocklists and thresholds
//
// Free-plan budget (Spark: 50,000 reads and 20,000 writes a day). Each heartbeat is one read and one write,
// and devices report every 30 s here (15 s on the laptop), so 20 devices cost about 2,400 writes an hour.
// Staff lists re-read only sessions that changed since the last read, and Dota live data is stored at most
// every 30 s per player. Screen recordings are not available: they need the event laptop's disk.
import type { RelayPlaceStore } from './iphoneRelay.ts';
import { randomBytes, randomInt } from 'node:crypto';
import { FieldPath, FieldValue, getFirestore, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { DEFAULT_MONITOR_CONFIG, monitorConfigSchema, PAIRING_ALPHABET, type MonitorConfig, type MonitorPlatform, type Signal } from '../src/lib/integrityRisk.ts';
import { IOS_CLEARANCE_MS, foundIndicators, iosReviewSchema, type IosClearance, type IosReviewInput } from '../src/lib/iosAntiCheat.ts';
import { adminApp } from './firebaseAdmin.ts';
import { PAIRING_TTL_MS, RETENTION_MS, RoomError, WrongDeviceError, claimingPlatform, connectionOf, lostGapSignal, policyVersionOf, riskOf, roomOpen, scanOf, sha256, slotBlocked, withExpiry,
  type FacilitatorInvite, type IphoneSetup, type MediaItem, type MonitorStore, type Pairing, type PairingInput, type RoomInput, type RoomRow, type SessionRow, type StoredSignal } from './monitorStore.ts';

type Doc = SessionRow & { signals?: Record<string, StoredSignal>; ios_clearance?: IosClearance | null; updated_at?: number };
const NO_RECORDINGS = 'Screen recordings need the event laptop. The hosted server does not store them.';
const signalKey = (s: Pick<Signal, 'id' | 'evidence'>) => `s${sha256(`${s.id}|${s.evidence}`).slice(0, 20)}`;
/** Firestore rejects undefined values; every stored value goes through JSON first. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const HOSTED_HEARTBEAT_SECONDS = 30;
export const HOSTED_LOST_AFTER_MS = 100_000;

export class FirestoreIntegrityStore implements MonitorStore {
  readonly heartbeatSeconds = HOSTED_HEARTBEAT_SECONDS;
  readonly lostAfterMs = HOSTED_LOST_AFTER_MS;
  readonly recordings = false;
  readonly gsiMinGapMs = 30_000;
  private readonly cache = new Map<string, Doc>();
  private loaded = false;
  private syncedFrom = 0;
  private lastSync = 0;
  private configCache: { value: MonitorConfig; at: number } | null = null;
  private gsiCache = new Map<string, { row: Doc; at: number }>();
  private lastCleanup = 0;

  constructor(readonly db: Firestore, readonly now: () => number = Date.now) {}
  private get sessionsCol() { return this.db.collection('monitorSessions'); }
  private get roomsCol() { return this.db.collection('monitorRooms'); }
  private ref(id: string) { return this.sessionsCol.doc(id); }
  private read(data: FirebaseFirestore.DocumentData | undefined): Doc | undefined { return data ? withExpiry(data as Doc, this.now()) : undefined; }
  private remember(row: Doc | undefined) { if (row) this.cache.set(row.id, row); return row; }

  // ---------- Settings and audit ----------
  /** Where the organizer's laptop relay is now (iPhone live screens, laptop mode). */
  relayPlaces(): RelayPlaceStore {
    const doc = this.db.collection('monitorSettings').doc('iphoneRelay');
    return {
      get: async () => {
        const snap = await doc.get();
        if (!snap.exists) return null;
        const { rtmp, web, at, hls, livekit } = snap.data() || {};
        return typeof rtmp === 'string' && typeof web === 'string' && typeof at === 'number'
          ? { rtmp, web, at, hls: hls === true, ...(typeof livekit === 'string' && livekit ? { livekit } : {}) } : null;
      },
      set: async place => { await doc.set({ rtmp: place.rtmp, web: place.web, at: place.at || this.now(), hls: !!place.hls, livekit: place.livekit || '' }); },
    };
  }
  async config(): Promise<MonitorConfig> {
    if (this.configCache && this.now() - this.configCache.at < 15_000) return structuredClone(this.configCache.value);
    const snap = await this.db.collection('monitorSettings').doc('config').get();
    const parsed = snap.exists ? monitorConfigSchema.safeParse(JSON.parse(String(snap.get('value') || 'null'))) : null;
    const value = parsed?.success ? parsed.data : structuredClone(DEFAULT_MONITOR_CONFIG);
    this.configCache = { value, at: this.now() };
    return structuredClone(value);
  }
  async saveConfig(value: unknown, actor: string) {
    const config = monitorConfigSchema.parse(value);
    // Stored as one JSON string: the lists hold keys Firestore field names cannot (dots, slashes).
    await this.db.collection('monitorSettings').doc('config').set({ value: JSON.stringify(config), updated_at: this.now() });
    this.configCache = { value: config, at: this.now() };
    await this.audit(actor, 'config-updated', '', 'Monitor blocklists or thresholds changed');
    return structuredClone(config);
  }
  async audit(actor: string, action: string, sessionId: string, note: string) {
    await this.db.collection('monitorAudit').add({ at: this.now(), actor, action, session_id: sessionId, note: note.slice(0, 500) });
  }
  async policyVersion() { return policyVersionOf(await this.config()); }

  // ---------- Pairing ----------
  private buildPairing(input: PairingInput, actor: string) {
    const id = randomBytes(12).toString('base64url');
    const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
    const now = this.now();
    const row: Doc = {
      id, match_id: input.matchId, match_label: input.matchLabel, game: input.game, platform: input.platform, player_name: input.playerName, expected_steam_id: input.expectedSteamId,
      created_by: actor, created_at: now, expires_at: now + input.hours * 3600_000, code_hash: sha256(code), code_expires_at: now + PAIRING_TTL_MS, token_hash: null, gsi_token_hash: null,
      claimed_at: null, device: null, status: 'pending', ended_at: null, team: input.team || '', player_key: input.playerKey || '', scan_challenge: randomBytes(24).toString('hex'),
      roster_version: input.rosterVersion || '', record: input.record === false ? 0 : 1, platform_flexible: input.flexible ? 1 : 0, last_seen: null, last_facts: null, gsi: null,
      review_note: '', hold: 0, media_bytes: 0, room_id: input.roomId || '', email: input.email || '', college: input.college || '', email_check: input.emailCheck || '', passed_at: null,
      signals: {}, ios_clearance: null, updated_at: now,
    };
    return { row, pairing: { id, code, codeExpiresAt: now + PAIRING_TTL_MS } };
  }
  async createPairing(input: PairingInput, actor: string): Promise<Pairing> {
    const { row, pairing } = this.buildPairing(input, actor);
    await this.ref(row.id).set(plain(row));
    this.remember(row);
    await this.audit(actor, 'pairing-created', row.id, `${input.playerName} on ${input.flexible ? 'any phone' : input.platform} for ${input.matchLabel}`);
    void this.cleanup().catch(() => {});
    return pairing;
  }
  private codeQuery(code: string) { return this.sessionsCol.where('code_hash', '==', sha256(code.trim().toUpperCase())).limit(1); }
  async pending(code: string) {
    const snap = await this.codeQuery(code).get();
    const row = this.read(snap.docs[0]?.data());
    return row && row.status === 'pending' && row.code_expires_at >= this.now() ? row : undefined;
  }
  async decline(code: string) {
    const now = this.now();
    const row = await this.db.runTransaction(async tx => {
      const snap = await tx.get(this.codeQuery(code));
      const found = this.read(snap.docs[0]?.data());
      if (!found || found.status !== 'pending' || found.code_expires_at < now) return undefined;
      const signal: Signal = { id: 'monitoring-declined', severity: 'medium', evidence: 'The player chose Decline on the consent screen' };
      tx.update(snap.docs[0].ref, { status: 'declined', ended_at: now, code_hash: null, updated_at: now, [`signals.${signalKey(signal)}`]: { ...signal, firstSeen: now, lastSeen: now, count: 1 } });
      return found;
    });
    if (!row) return undefined;
    await this.audit('player', 'player-declined', row.id, 'The player declined monitoring for this match');
    return this.session(row.id);
  }
  async claim(code: string, device: Record<string, string>, allowed?: MonitorPlatform[]) {
    const now = this.now();
    const result = await this.db.runTransaction(async tx => {
      const snap = await tx.get(this.codeQuery(code));
      let row = snap.docs[0]?.data() as Doc | undefined;
      // Single use: the code is erased the moment a device claims it.
      if (!row || row.status !== 'pending' || row.code_expires_at < now || row.expires_at < now) return null;
      if (row.platform_flexible === 1) {
        const platform = claimingPlatform(device.agent);
        if (!platform || (allowed && !allowed.includes(platform))) throw new WrongDeviceError();
        row = { ...row, platform, platform_flexible: 0 };
      }
      const token = randomBytes(32).toString('base64url');
      const gsiToken = row.game === 'dota2' && row.platform === 'pc' ? randomBytes(32).toString('base64url') : undefined;
      const update = { platform: row.platform, platform_flexible: 0, code_hash: null, token_hash: sha256(token), gsi_token_hash: gsiToken ? sha256(gsiToken) : null, claimed_at: now, device: JSON.stringify(device), status: 'active' as const, last_seen: now, updated_at: now };
      tx.update(snap.docs[0].ref, update);
      return { token, gsiToken, session: { ...row, ...update } as Doc };
    });
    if (!result) return null;
    this.remember(result.session);
    await this.audit('device', 'device-paired', result.session.id, `${device.model || 'device'} ${device.os || ''}`.trim());
    return { token: result.token, ...(result.gsiToken ? { gsiToken: result.gsiToken } : {}), session: result.session };
  }
  async session(id: string) {
    if (!id || id.length > 64 || id.includes('/')) return undefined;
    return this.remember(this.read((await this.ref(id).get()).data()));
  }
  async byToken(token: string) {
    const snap = await this.sessionsCol.where('token_hash', '==', sha256(token)).limit(1).get();
    const row = this.read(snap.docs[0]?.data());
    return row?.status === 'active' ? row : undefined;
  }
  /** Dota sends live data every few seconds; the session behind a telemetry token is cached briefly. */
  async byGsiToken(token: string) {
    const hash = sha256(token), cached = this.gsiCache.get(hash);
    if (cached && this.now() - cached.at < 30_000) { const row = withExpiry(cached.row, this.now()); return row.status === 'active' ? row : undefined; }
    const snap = await this.sessionsCol.where('gsi_token_hash', '==', hash).limit(1).get();
    const row = this.read(snap.docs[0]?.data());
    if (this.gsiCache.size > 500) this.gsiCache.clear();
    if (row) this.gsiCache.set(hash, { row, at: this.now() });
    return row?.status === 'active' && row.game === 'dota2' && row.platform === 'pc' ? row : undefined;
  }

  /**
   * Staff poll the session list every few seconds. The first call on a server instance reads the newest
   * 300 sessions; after that, only sessions written since the last read (with a few seconds of overlap for
   * writes from other instances still landing).
   */
  private async sync() {
    // The throttle uses wall time: it limits database reads, not match time.
    const started = this.now(), wall = Date.now();
    if (this.loaded && wall - this.lastSync < 1500) return;
    const snap = this.loaded
      ? await this.sessionsCol.where('updated_at', '>', this.syncedFrom - 5000).get()
      : await this.sessionsCol.orderBy('created_at', 'desc').limit(300).get();
    for (const doc of snap.docs) this.cache.set(doc.id, doc.data() as Doc);
    this.loaded = true; this.syncedFrom = started; this.lastSync = wall;
  }
  async sessions(matchId?: string) {
    await this.sync();
    const cutoff = this.now() - RETENTION_MS;
    const rows = [...this.cache.values()].filter(row => row.created_at >= cutoff && (!matchId || row.match_id === matchId))
      .sort((a, b) => b.created_at - a.created_at).map(row => withExpiry(row, this.now()));
    return matchId ? rows : rows.slice(0, 200);
  }
  async end(id: string, actor: string, reason: string) {
    const now = this.now();
    const ended = await this.db.runTransaction(async tx => {
      const row = this.read((await tx.get(this.ref(id))).data());
      if (!row || (row.status !== 'pending' && row.status !== 'active')) return false;
      tx.update(this.ref(id), { status: 'ended', ended_at: now, token_hash: null, gsi_token_hash: null, code_hash: null, updated_at: now });
      return true;
    });
    if (ended) { this.cache.delete(id); await this.audit(actor, 'session-ended', id, reason); }
    return ended;
  }

  // ---------- Signals and reports ----------
  /** Field updates that add or count signals without rewriting the others. */
  private signalUpdates(existing: Record<string, StoredSignal> | undefined, signals: Signal[], now: number) {
    const update: Record<string, unknown> = {};
    for (const s of signals) {
      const key = signalKey(s);
      if (existing?.[key] && !update[`signals.${key}`]) {
        update[`signals.${key}.lastSeen`] = now; update[`signals.${key}.severity`] = s.severity; update[`signals.${key}.count`] = FieldValue.increment(1);
      } else update[`signals.${key}`] = { id: s.id, severity: s.severity, evidence: s.evidence, firstSeen: now, lastSeen: now, count: 1 };
    }
    return update;
  }
  async heartbeat(row: SessionRow, facts: unknown, signals: Signal[]) {
    const now = this.now();
    const all = [...signals, ...lostGapSignal(row, now, this.lostAfterMs)];
    await this.ref(row.id).update({ last_seen: now, last_facts: JSON.stringify(facts), updated_at: now, ...this.signalUpdates((row as Doc).signals, all, now) });
  }
  async recordSignals(sessionId: string, signals: Signal[]) {
    if (!signals.length) return;
    const row = await this.session(sessionId);
    if (!row) return;
    const now = this.now();
    await this.ref(sessionId).update({ updated_at: now, ...this.signalUpdates(row.signals, signals, now) });
  }
  async saveGsi(row: SessionRow, gsi: unknown, signals: Signal[]) {
    const now = this.now();
    await this.ref(row.id).update({ gsi: JSON.stringify(gsi), updated_at: now, ...this.signalUpdates((row as Doc).signals, signals, now) });
  }
  async signals(row: SessionRow | string) {
    const doc = typeof row === 'string' ? await this.session(row) : (row as Doc).signals ? row as Doc : await this.session(row.id);
    return Object.values(doc?.signals || {}).sort((a, b) => b.lastSeen - a.lastSeen);
  }
  async risk(row: SessionRow) { return riskOf(await this.signals(row), row, await this.config(), this.now(), this.lostAfterMs); }
  connection(row: SessionRow) { return connectionOf(row, this.now(), this.lostAfterMs); }
  async iosClearance(row: SessionRow | string) {
    if (typeof row !== 'string' && 'ios_clearance' in row) return (row as Doc).ios_clearance || null;
    return (await this.session(typeof row === 'string' ? row : row.id))?.ios_clearance || null;
  }
  async scan(row: SessionRow) { return scanOf(row, await this.config(), await this.iosClearance(row), this.now()); }
  async reviewIos(id: string, actor: string, value: IosReviewInput) {
    const input = iosReviewSchema.parse(value), row = await this.session(id), found = foundIndicators(input), now = this.now();
    if (!row || row.platform !== 'ios' || row.game === 'dota2' || (input.approved && row.status !== 'active')) throw new Error('Pair an active iPhone session before inspection.');
    const policyVersion = await this.policyVersion();
    const review: IosClearance = { approved: input.approved, reviewedAt: now, validUntil: input.approved ? Math.min(row.expires_at, now + IOS_CLEARANCE_MS) : now, actor, note: found.length ? `Found: ${found.join('; ')}. ${input.note}`.slice(0, 2600) : input.note, challenge: row.scan_challenge, policyVersion, rosterVersion: row.roster_version, ...(found.length ? { indicatorsFound: found } : {}) };
    await this.ref(id).update({ ios_clearance: plain(review), updated_at: now });
    await this.audit(actor, input.approved ? 'ios-inspection-approved' : 'ios-clearance-revoked', id, JSON.stringify(input));
    return review;
  }
  async review(id: string, actor: string, note: string, hold: boolean) {
    await this.ref(id).update({ review_note: note, hold: hold ? 1 : 0, updated_at: this.now() });
    await this.audit(actor, hold ? 'evidence-held' : 'reviewed', id, note);
  }
  async markPassed(row: SessionRow, at: number) {
    if (row.passed_at) return;
    await this.db.runTransaction(async tx => {
      const current = (await tx.get(this.ref(row.id))).data() as Doc | undefined;
      if (current && !current.passed_at) tx.update(this.ref(row.id), { passed_at: at, updated_at: this.now() });
    });
  }
  async auditFor(sessionId: string) {
    const snap = await this.db.collection('monitorAudit').where('session_id', '==', sessionId).limit(300).get();
    return snap.docs.map(doc => doc.data()).sort((a, b) => a.at - b.at).map(({ at, actor, action, note }) => ({ at, actor, action, note }));
  }

  // ---------- Recordings: not on the hosted server ----------
  addMedia(): Promise<number> { return Promise.reject(new Error(NO_RECORDINGS)); }
  beginUpload(): Promise<string> { return Promise.reject(new Error(NO_RECORDINGS)); }
  appendUpload(): Promise<void> { return Promise.reject(new Error(NO_RECORDINGS)); }
  finishUpload(): Promise<number> { return Promise.reject(new Error(NO_RECORDINGS)); }
  async abortUpload() {}
  async media(): Promise<MediaItem[]> { return []; }
  async mediaFile() { return null; }

  /** 30-day retention, at most once an hour per server instance. Sessions on evidence hold are kept. */
  async cleanup() {
    const now = this.now();
    if (now - this.lastCleanup < 3600_000) return 0;
    this.lastCleanup = now;
    const old = await this.sessionsCol.where('created_at', '<', now - RETENTION_MS).limit(200).get();
    const doomed = old.docs.filter(doc => { const row = withExpiry(doc.data() as Doc, now); return row.hold !== 1 && (row.status === 'ended' || row.status === 'declined'); });
    const rooms = await this.roomsCol.where('created_at', '<', now - 2 * 24 * 3600_000).limit(100).get();
    const batch = this.db.batch();
    for (const doc of [...doomed, ...rooms.docs]) batch.delete(doc.ref);
    if (doomed.length || rooms.size) await batch.commit();
    for (const doc of doomed) { this.cache.delete(doc.id); await this.audit('system', 'retention-deleted', doc.id, 'Signals deleted after 30 days'); }
    return doomed.length;
  }

  // ---------- Rooms ----------
  async createRoom(input: RoomInput, actor: string) {
    const now = this.now();
    const room: RoomRow = { id: randomBytes(9).toString('base64url'), label: input.label, match_id: input.matchId, game: input.game, roster_version: input.rosterVersion, players: input.players,
      secret: randomBytes(32).toString('base64url'), record: input.record ? 1 : 0, hours: input.hours, created_by: actor, created_at: now, expires_at: now + input.hours * 3600_000, closed_at: null, joined: {}, ...(input.testRoom ? { test_room: true } : {}), ...(input.verifiedCheckIn ? { verified_checkin: true } : {}), ...(input.noSignIn ? { no_sign_in: true } : {}) };
    await this.roomsCol.doc(room.id).set(plain(room));
    await this.audit(actor, 'room-opened', '', `${input.label} (${input.players.length || 'typed'} players)${input.noSignIn ? ', TEST: no sign-in' : ''}`);
    return room;
  }
  async room(id: string) {
    if (!id || id.length > 64 || id.includes('/')) return undefined;
    const snap = await this.roomsCol.doc(id).get();
    return snap.exists ? snap.data() as RoomRow : undefined;
  }
  async rooms() {
    const snap = await this.roomsCol.where('created_at', '>', this.now() - 2 * 24 * 3600_000).orderBy('created_at', 'desc').limit(50).get();
    return snap.docs.map(doc => doc.data() as RoomRow);
  }
  async screenStaff() {
    const snap = await this.db.collection('monitorScreenStaff').limit(500).get();
    return Object.fromEntries(snap.docs.map(doc => [doc.id, (doc.data().emails || []) as string[]]));
  }
  async setScreenStaff(key: string, emails: string[], actor: string) {
    const ref = this.db.collection('monitorScreenStaff').doc(key);
    if (emails.length) await ref.set({ emails, updated_at: this.now() });
    else await ref.delete();
    await this.audit(actor, 'screen-facilitator', '', key + ' · ' + (emails.join(', ') || 'removed'));
  }
  async facilitatorInvites() {
    const snap = await this.db.collection('monitorFacilitators').limit(200).get();
    return snap.docs.map(doc => doc.data() as FacilitatorInvite).sort((a, b) => a.email.localeCompare(b.email));
  }
  async saveFacilitatorInvite(invite: FacilitatorInvite, actor: string) {
    await this.db.collection('monitorFacilitators').doc(invite.email).set(invite);
    await this.audit(actor, 'facilitator-invite', '', invite.email + (invite.accepted_at ? ' · active' : ' · invited'));
  }
  async deleteFacilitatorInvite(email: string, actor: string) {
    await this.db.collection('monitorFacilitators').doc(email).delete();
    await this.audit(actor, 'facilitator-removed', '', email);
  }
  async iphoneSetups(playerIds: string[]) {
    const ids = [...new Set(playerIds)].filter(id => /^[\w-]{1,64}$/.test(id));
    if (!ids.length) return [];
    const col = this.db.collection('monitorIphoneSetups');
    const snaps = await this.db.getAll(...ids.map(id => col.doc(id)));
    return snaps.filter(snap => snap.exists).map(snap => snap.data() as IphoneSetup);
  }
  async saveIphoneSetup(setup: IphoneSetup) {
    await this.db.collection('monitorIphoneSetups').doc(setup.player_id).set(setup);
  }
  async closeRoom(id: string, actor: string) {
    const room = await this.room(id);
    if (!room || room.closed_at) return false;
    await this.roomsCol.doc(id).update({ closed_at: this.now() });
    await this.audit(actor, 'room-closed', '', room.label);
    return true;
  }
  async newRoomCode(id: string, actor: string) {
    const room = await this.room(id);
    if (!room || room.closed_at) return false;
    await this.roomsCol.doc(id).update({ code_start: this.now() });
    await this.audit(actor, 'room-new-code', '', room.label);
    return true;
  }
  async joinRoom(roomId: string, slot: string, input: PairingInput) {
    const now = this.now();
    const roomRef = this.roomsCol.doc(roomId);
    // A transaction, so two phones picking the same name at the same moment cannot both get in.
    const { row, pairing } = await this.db.runTransaction(async (tx: Transaction) => {
      const room = (await tx.get(roomRef)).data() as RoomRow | undefined;
      if (!room || !roomOpen(room, this.now())) throw new RoomError(404, 'This room is closed. Ask the referee.');
      const held = room.joined?.[slot];
      const heldRow = held ? this.read((await tx.get(this.ref(held.sessionId))).data()) : undefined;
      const blocked = slotBlocked(heldRow, now);
      if (blocked) throw new RoomError(409, blocked);
      const built = this.buildPairing({ ...input, roomId }, 'room');
      tx.set(this.ref(built.row.id) as DocumentReference, plain(built.row));
      tx.update(roomRef, new FieldPath('joined', slot), { sessionId: built.row.id, at: now });
      return built;
    });
    this.remember(row);
    await this.audit('room', 'pairing-created', row.id, `${input.playerName} joined room ${input.matchLabel}`);
    return pairing;
  }
  async resetRoomSlot(roomId: string, slot: string, actor: string, moved?: string) {
    const room = await this.room(roomId), held = room?.joined?.[slot];
    if (!room || !held) return false;
    const name = (await this.session(held.sessionId))?.player_name || slot;
    await this.end(held.sessionId, actor, moved || 'Staff reset this player in the room so they can join again');
    if (moved) await this.roomsCol.doc(roomId).update(new FieldPath('joined', slot), FieldValue.delete());
    else await this.roomsCol.doc(roomId).update(new FieldPath('joined', slot), FieldValue.delete(), 'resets', FieldValue.arrayUnion({ slot, name, sessionId: held.sessionId, by: actor, at: this.now() }));
    await this.audit(actor, moved ? 'room-slot-moved' : 'room-slot-reset', held.sessionId, `${room.label}: ${slot}`);
    return true;
  }
}

/** The hosted store, or null when the server has no Firebase Admin access (no service account). */
export function firestoreStoreFromEnv(env: Record<string, string | undefined>) {
  const app = adminApp(env);
  return app ? new FirestoreIntegrityStore(getFirestore(app)) : null;
}
