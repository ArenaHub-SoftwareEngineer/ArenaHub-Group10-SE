// What the Match Integrity Monitor needs from storage, shared by both stores:
// - IntegrityStore (server/integrityStore.ts): SQLite on the event laptop, with recordings on disk.
// - FirestoreIntegrityStore (server/firestoreIntegrityStore.ts): Firestore, for the hosted (Vercel) API,
//   where no disk survives between requests. Recordings are not available there.
// This file must not import node:sqlite, so the hosted API never loads it.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PAIRING_ALPHABET, scoreSignals, type MonitorConfig, type MonitorGame, type MonitorPlatform, type Signal, type SignalId, type Severity } from '../src/lib/integrityRisk.ts';
import { preMatchScan } from '../src/lib/preMatchScan.ts';
import type { IosClearance, IosReviewInput } from '../src/lib/iosAntiCheat.ts';

export const HEARTBEAT_SECONDS = 15;
export const LOST_AFTER_MS = 45_000;
export const PAIRING_TTL_MS = 5 * 60_000;
export const RETENTION_MS = 30 * 24 * 3600_000;

export interface SessionRow {
  id: string; match_id: string; match_label: string; game: MonitorGame; platform: MonitorPlatform; player_name: string;
  expected_steam_id: string; created_by: string; created_at: number; expires_at: number; code_hash: string | null; code_expires_at: number;
  token_hash: string | null; gsi_token_hash: string | null; claimed_at: number | null; device: string | null; status: 'pending' | 'active' | 'ended' | 'declined'; ended_at: number | null;
  team: string; player_key: string; scan_challenge: string; roster_version: string; record: number; platform_flexible: number; last_seen: number | null; last_facts: string | null; gsi: string | null; review_note: string; hold: number; media_bytes: number;
  /** The room this pairing was issued from, or '' when staff made the code by hand. */
  room_id?: string;
  /** Registration typed on the join page (room joins only). */
  email?: string; college?: string;
  /** Roster email comparison for legacy rooms, or 'verified' for a signed-in campus account. */
  email_check?: string;
  /** When this session first passed its scan (or iPhone inspection). Kept after the scan goes stale, as proof it ran. */
  passed_at?: number | null;
}
export type StoredSignal = { id: SignalId; severity: Severity; evidence: string; firstSeen: number; lastSeen: number; count: number };
export type MediaItem = { id: number; kind: string; bytes: number; createdAt: number };
export type PairingInput = { matchId: string; matchLabel: string; game: MonitorGame; platform: MonitorPlatform; flexible?: boolean; playerName: string; team?: string; playerKey?: string; rosterVersion?: string; record?: boolean; expectedSteamId: string; hours: number; roomId?: string; email?: string; college?: string; emailCheck?: 'match' | 'mismatch' | 'unknown' | 'verified' };
export type Pairing = { id: string; code: string; codeExpiresAt: number };

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** An any-phone code was opened by something that cannot play its game (for example a PC for MLBB). */
export class WrongDeviceError extends Error { constructor() { super('This device cannot claim that code.'); } }
/** Which kind of device is claiming a code, from the agent name each ArenaHub client sends. */
export function claimingPlatform(agent: string | undefined): MonitorPlatform | undefined {
  const name = (agent || '').trim().toLowerCase();
  if (name.startsWith('android')) return 'android';
  if (name.startsWith('pc-agent')) return 'pc';
  // join.html's iPhone check-in.
  if (name.startsWith('web')) return 'ios';
  return undefined;
}

/** Match windows close on their own: past expiry, a session reads as ended and can no longer report. */
export function withExpiry<T extends SessionRow>(row: T, now: number): T {
  return (row.status === 'pending' || row.status === 'active') && row.expires_at < now
    ? { ...row, status: 'ended', ended_at: row.expires_at, token_hash: null, gsi_token_hash: null, code_hash: null } : row;
}
export function connectionOf(row: SessionRow, now: number, lostAfterMs: number): 'waiting' | 'online' | 'paired' | 'lost' | 'ended' | 'declined' {
  if (row.status === 'declined') return 'declined';
  if (row.status === 'ended') return 'ended';
  if (row.status === 'pending') return 'waiting';
  if (row.platform === 'ios') return 'paired';
  return row.last_seen && now - row.last_seen > lostAfterMs ? 'lost' : 'online';
}
/**
 * Live risk adds a lost-contact signal while an active device is silent.
 * iPhones are recorded by the referee from an observer slot, so a silent iPhone is normal.
 */
export function liveSignalsOf(row: SessionRow, now: number, lostAfterMs: number): Pick<Signal, 'id' | 'severity'>[] {
  if (row.platform === 'ios') return [];
  return row.status === 'active' && row.last_seen && now - row.last_seen > lostAfterMs ? [{ id: 'heartbeat-lost', severity: 'medium' }] : [];
}
export function riskOf(stored: StoredSignal[], row: SessionRow, config: MonitorConfig, now: number, lostAfterMs: number) {
  return scoreSignals([...stored, ...liveSignalsOf(row, now, lostAfterMs)], config.thresholds);
}
export const policyVersionOf = (config: MonitorConfig) => sha256(JSON.stringify(config));
export function scanOf(row: SessionRow, config: MonitorConfig, clearance: IosClearance | null, now: number) {
  return preMatchScan({ platform: row.platform, game: row.game, status: row.status, lastSeen: row.last_seen, expiresAt: row.expires_at, facts: row.last_facts ? JSON.parse(row.last_facts) : null, challenge: row.scan_challenge, policyVersion: policyVersionOf(config), config, now, iosClearance: clearance?.rosterVersion === row.roster_version ? clearance : null });
}
/** Signals a heartbeat adds when the device was silent for too long before it. */
export function lostGapSignal(row: SessionRow, now: number, lostAfterMs: number): Signal[] {
  return row.last_seen && now - row.last_seen > lostAfterMs ? [{ id: 'heartbeat-lost', severity: 'medium', evidence: `No report for ${Math.round((now - row.last_seen) / 1000)} s` }] : [];
}

// ---------- Room codes ----------
// A room is the front door for one match (or a scrim): players open the fixed join address and type the
// room code that only staff can see. The code is derived from a secret kept on the server and changes
// every 5 minutes, like an authenticator app. Typing it does not admit anyone by itself: the player then
// picks their own roster name, and each roster player can join once until staff reset them.
export const ROOM_WINDOW_MS = 5 * 60_000;
/** The previous code keeps working this long after it changes, for a player who was mid-typing. */
export const ROOM_GRACE_MS = 60_000;
export const ROOM_CODE_LENGTH = 6;

export type RoomPlayer = { slot: string; name: string; team: string; playerKey: string; college: string;
  /** sha256 of the lower-case school email from the staff-only roster. Never sent to players. */
  emailHash?: string };
export type RoomReset = { slot: string; name: string; sessionId: string; by: string; at: number };
export interface RoomRow {
  id: string; label: string; match_id: string; game: MonitorGame | ''; roster_version: string;
  /** Roster players who may join. Empty: players type their own name (scrims and tests). */
  players: RoomPlayer[];
  secret: string; record: number; hours: number; created_by: string; created_at: number; expires_at: number; closed_at: number | null;
  /** Slot key to the session issued for it. */
  joined: Record<string, { sessionId: string; at: number }>;
  /** Every staff reset, so a slot that was taken twice stays visible. */
  resets?: RoomReset[];
  test_room?: boolean;
  verified_checkin?: boolean;
}

export function roomCodeAt(secret: string, window: number) {
  const digest = createHmac('sha256', secret).update(`arenahub-room:${window}`).digest();
  // Two bytes per character keeps the bias of the modulo below 0.05%.
  return Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => PAIRING_ALPHABET[digest.readUInt16BE(i * 2) % PAIRING_ALPHABET.length]).join('');
}
/** The code staff show right now, and when it changes. */
type CodeRoom = Pick<RoomRow, 'secret'> & Partial<Pick<RoomRow, 'test_room' | 'expires_at'>>;

export function currentRoomCode(room: CodeRoom, now: number) {
  if (room.test_room) return { code: roomCodeAt(room.secret, 0), changesAt: room.expires_at ?? now };
  const window = Math.floor(now / ROOM_WINDOW_MS);
  return { code: roomCodeAt(room.secret, window), changesAt: (window + 1) * ROOM_WINDOW_MS };
}
export const normalizeRoomCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** True when the typed code is this room's current code, or the previous one within the grace period. */
export function roomCodeMatches(room: CodeRoom, typed: string, now: number) {
  const value = normalizeRoomCode(typed);
  if (value.length !== ROOM_CODE_LENGTH) return false;
  if (room.test_room) return timingSafeEqual(Buffer.from(roomCodeAt(room.secret, 0)), Buffer.from(value));
  const window = Math.floor(now / ROOM_WINDOW_MS);
  const candidates = [window, ...(now - window * ROOM_WINDOW_MS < ROOM_GRACE_MS ? [window - 1] : [])];
  return candidates.some(w => timingSafeEqual(Buffer.from(roomCodeAt(room.secret, w)), Buffer.from(value)));
}
export const roomOpen = (room: RoomRow, now: number) => !room.closed_at && room.expires_at > now;
/** A free-name slot: the same name typed twice is the same player. */
export const nameSlot = (name: string) => `name:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
export type RoomInput = { label: string; matchId: string; game: MonitorGame | ''; rosterVersion: string; players: RoomPlayer[]; record: boolean; hours: number; testRoom?: boolean; verifiedCheckIn?: boolean };
/** Why a slot cannot be joined, or null when it is free. */
export function slotBlocked(session: SessionRow | undefined, now: number): string | null {
  if (!session) return null;
  if (session.status === 'active') return 'This player already joined on a device. If that was not you, tell the referee straight away.';
  if (session.status === 'pending' && session.code_expires_at >= now) return 'This player is joining on another device right now. Wait 5 minutes, or ask the referee.';
  return null;
}
export const emailHash = (email: string) => sha256(email.trim().toLowerCase());
export class RoomError extends Error { constructor(readonly status: number, message: string) { super(message); } }

type Awaitable<T> = T | Promise<T>;
/**
 * Every call is awaited by the router, so the SQLite store answers synchronously and the Firestore
 * store asynchronously through the same interface.
 */
export interface MonitorStore {
  readonly now: () => number;
  /** How often devices report, and how long silence lasts before a device counts as lost. */
  readonly heartbeatSeconds: number;
  readonly lostAfterMs: number;
  /** False on the hosted API: no disk for screen recordings, so recording is switched off for every code. */
  readonly recordings: boolean;
  /** Minimum gap between stored Dota live-data updates for one session (0: store every update). */
  readonly gsiMinGapMs: number;
  config(): Awaitable<MonitorConfig>;
  saveConfig(value: unknown, actor: string): Awaitable<MonitorConfig>;
  audit(actor: string, action: string, sessionId: string, note: string): Awaitable<void>;
  createPairing(input: PairingInput, actor: string): Awaitable<Pairing>;
  pending(code: string): Awaitable<SessionRow | undefined>;
  decline(code: string): Awaitable<SessionRow | undefined>;
  claim(code: string, device: Record<string, string>, allowed?: MonitorPlatform[]): Awaitable<{ token: string; gsiToken?: string; session: SessionRow } | null>;
  session(id: string): Awaitable<SessionRow | undefined>;
  policyVersion(): Awaitable<string>;
  scan(row: SessionRow): Awaitable<ReturnType<typeof preMatchScan>>;
  iosClearance(row: SessionRow | string): Awaitable<IosClearance | null>;
  reviewIos(id: string, actor: string, value: IosReviewInput): Awaitable<IosClearance>;
  byToken(token: string): Awaitable<SessionRow | undefined>;
  byGsiToken(token: string): Awaitable<SessionRow | undefined>;
  sessions(matchId?: string): Awaitable<SessionRow[]>;
  end(id: string, actor: string, reason: string): Awaitable<boolean>;
  heartbeat(row: SessionRow, facts: unknown, signals: Signal[]): Awaitable<void>;
  recordSignals(sessionId: string, signals: Signal[]): Awaitable<void>;
  saveGsi(row: SessionRow, gsi: unknown, signals: Signal[]): Awaitable<void>;
  signals(row: SessionRow | string): Awaitable<StoredSignal[]>;
  risk(row: SessionRow): Awaitable<ReturnType<typeof scoreSignals>>;
  connection(row: SessionRow): 'waiting' | 'online' | 'paired' | 'lost' | 'ended' | 'declined';
  addMedia(row: SessionRow, kind: 'video' | 'image', data: Buffer): Awaitable<number>;
  beginUpload(row: SessionRow, extension: 'mp4' | 'mov'): Awaitable<string>;
  appendUpload(row: SessionRow, file: string, data: Buffer): Awaitable<void>;
  finishUpload(row: SessionRow, file: string): Awaitable<number>;
  abortUpload(row: SessionRow, file: string): Awaitable<void>;
  media(row: SessionRow | string): Awaitable<MediaItem[]>;
  mediaFile(sessionId: string, mediaId: number): Awaitable<{ kind: string; path: string; type: string } | null>;
  auditFor(sessionId: string): Awaitable<unknown[]>;
  review(id: string, actor: string, note: string, hold: boolean): Awaitable<void>;
  /** Records the first time a session passed. Later calls keep the first time. */
  markPassed(row: SessionRow, at: number): Awaitable<void>;
  cleanup(): Awaitable<number>;
  // Rooms
  createRoom(input: RoomInput, actor: string): Awaitable<RoomRow>;
  room(id: string): Awaitable<RoomRow | undefined>;
  rooms(): Awaitable<RoomRow[]>;
  /** Staff emails assigned to watch each screen room (a scheduled match or a scrim room), by screen key. */
  screenStaff(): Awaitable<Record<string, string[]>>;
  setScreenStaff(key: string, emails: string[], actor: string): Awaitable<void>;
  closeRoom(id: string, actor: string): Awaitable<boolean>;
  /**
   * Reserves a slot and issues its pairing in one step, so two devices cannot take the same player.
   * Throws RoomError when the slot is taken.
   */
  joinRoom(roomId: string, slot: string, pairing: PairingInput): Awaitable<Pairing>;
  /** Staff free a slot: its session ends, and the player can join again. */
  resetRoomSlot(roomId: string, slot: string, actor: string): Awaitable<boolean>;
}
