// /api/integrity: the Match Integrity Monitor API.
// Staff routes need a verified staff Firebase token. Device routes (Android companion, PC agent,
// Dota 2 Game State Integration) use a session token issued once through a single-use pairing code.
// Room routes let players join from one fixed address with a room code that changes every 5 minutes.
// The store is SQLite on the event laptop, or Firestore on the hosted API (INTEGRITY_STORE=firestore).
import express from 'express';
import { bearer, callerVerifier, type VerifyCaller } from './auth.ts';
import { defaultScreenKey, iphonePlayerId, screenCredential, screenWallRouter } from './screenWall.ts';
import { iphoneRelayFromEnv, type IphoneRelay } from './iphoneRelay.ts';
import { liveScreensFromEnv, matchScreenKey, roomScreenKey, screenMatches, type LiveScreens } from './liveScreens.ts';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { cheatById } from '../src/lib/cheatCatalog.ts';
import QRCode from 'qrcode';
import { z } from 'zod';
import { deviceFactsSchema, evaluateFacts, evaluateGsi, GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, PLATFORM_LABEL, SEVERITIES, SIGNAL_CATEGORY, pairingLink, parseGsi, statOutliers, steamIdToAccountId, SIGNAL_CATALOG, type MonitorGame, type MonitorPlatform } from '../src/lib/integrityRisk.ts';
import { IntegrityStore } from './integrityStore.ts';
import { FirestoreIntegrityStore, firestoreStoreFromEnv } from './firestoreIntegrityStore.ts';
import { RoomError, WrongDeviceError, currentRoomCode, emailHash, nameSlot, normalizeRoomCode, roomCodeMatches, roomOpen, sha256, slotBlocked, unsignedSession, ROOM_CODE_LENGTH, ROOM_WINDOW_MS, type MonitorStore, type RoomRow, type SessionRow } from './monitorStore.ts';
import { AuthError, verifyStaffToken, type MonitorStaff } from './staffAuth.ts';
import { facilitatorRouter, firebaseRoleAdmin, type RoleAdmin } from './facilitators.ts';
import { clientAddress } from './publicAccess.ts';
import { inspectionCoverage, reportedFingerprint } from '../src/lib/integrityRisk.ts';
import { PRACTICE_NOTE, practicePlatform, practiceVerdict } from '../src/lib/practiceScan.ts';
import { monitorAddress } from '../src/lib/monitorAddress.ts';
import { allowedOrigins, originAllowed } from './cors.ts';
import { publishedReader, type PublishedReader } from './data.ts';
import { matchScanReadiness, scanMatch, scanMatchLabel, ScanAdmissionError } from './scanAdmission.ts';
import { rosterEmailReader, type RosterEmailReader } from './privateRoster.ts';
import { iosReviewSchema } from '../src/lib/iosAntiCheat.ts';

// Player downloads, served from dist-agent/ by exact name only.
export const DOWNLOADS: Record<string, string> = { 'arenahub-companion.apk': 'application/vnd.android.package-archive', 'arenahub-agent.exe': 'application/octet-stream' };
const CHUNK_BYTES = 8 * 1024 * 1024, MAX_CHUNKS = 1024, TICKET_MS = 10 * 60_000;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024, MAX_IMAGE_BYTES = 3 * 1024 * 1024, MAX_SESSION_BYTES = 4 * 1024 ** 3;
const NO_RECORDINGS = 'Recording is not available on this server. The referee records from the observer slot instead.';
const pairingInput = z.object({
  matchId: z.string().trim().min(1).max(160),
  matchLabel: z.string().trim().min(1).max(200),
  game: z.enum(MONITOR_GAMES),
  playerName: z.string().trim().min(1).max(80),
  team: z.string().trim().max(80).default(''),
  playerKey: z.string().max(400).default(''),
  // 'any': the player's own phone decides (Android app or iPhone Safari) when it claims the code.
  platform: z.enum(['android', 'ios', 'pc', 'any']).optional(),
  expectedSteamId: z.string().trim().regex(/^(\d{17})?$/, 'Steam ID must be the 17-digit SteamID64.').default(''),
  hours: z.number().min(0.5).max(12).default(4),
  record: z.boolean().default(true),
});
const claimInput = z.object({ code: z.string().trim().min(6).max(12), device: z.object({ model: z.string().max(80).default(''), os: z.string().max(80).default(''), agent: z.string().max(40).default('') }).default({ model: '', os: '', agent: '' }) });
const roomInput = z.object({
  matchId: z.string().trim().max(160).default(''),
  label: z.string().trim().max(80).default(''),
  // '': the player chooses the game on the join page (scrims only).
  game: z.union([z.enum(MONITOR_GAMES), z.literal('')]).default(''),
  hours: z.number().min(0.5).max(12).default(4),
  record: z.boolean().default(false),
  testRoom: z.boolean().default(false),
  verifiedCheckIn: z.boolean().default(false),
  /** Staff test switch: this match check-in accepts players who are not signed in (marked unverified). */
  noSignIn: z.boolean().default(false),
});
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const joinInput = z.object({
  code: z.string().max(20),
  slot: z.string().regex(/^p\d{1,3}$/).optional(),
  name: z.string().trim().max(60).optional(),
  email: z.string().trim().toLowerCase().max(160).default(''),
  college: z.string().trim().max(80).default(''),
  team: z.string().trim().max(80).default(''),
  game: z.enum(MONITOR_GAMES).optional(),
  platform: z.enum(['android', 'ios', 'pc']),
});
const checkInInput = z.object({
  name: z.string().trim().min(2).max(60),
  team: z.string().trim().min(2).max(80),
  college: z.string().trim().min(2).max(80),
  game: z.enum(MONITOR_GAMES),
  platform: z.enum(['android', 'ios', 'pc']),
  /** The scheduled match the player is about to play. Its staff watch this player's live screen. */
  matchId: z.string().min(1).max(80).optional(),
});
/** A match check-in: the room fixes the match and game, and the player's school email finds their roster seat. */
const matchCheckInInput = z.object({
  code: z.string().max(20),
  platform: z.enum(['android', 'ios', 'pc']),
  /** Only when the roster has no school email for this player: they pick their own name. */
  slot: z.string().regex(/^p\d{1,3}$/).optional(),
});

type Deps = { screens?: LiveScreens | null; relay?: IphoneRelay | null; store?: MonitorStore; dataDir?: string; verifyCaller?: VerifyCaller; verifyStaff?: (token: string | undefined) => Promise<string | MonitorStaff>; roles?: RoleAdmin | null; fetcher?: typeof fetch; published?: PublishedReader; rosterEmails?: RosterEmailReader };
/** `scope`: the screen keys a facilitator is assigned to (m-<matchId>, r-<roomId>). Absent for full staff. */
type StaffRequest = express.Request & { staffUid?: string; scope?: Set<string> };
type Handler = (req: express.Request, res: express.Response, next: express.NextFunction) => unknown;
/** Express 4 does not catch rejected promises; this passes them to the error handler. */
const h = (fn: Handler): express.RequestHandler => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

function lanUrls(port: number) {
  const real: string[] = [], virtual: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) for (const net of list || []) {
    if (net.family !== 'IPv4' || net.internal) continue;
    if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address)) continue;
    // Virtual machine adapters (VirtualBox, VMware, Hyper-V, WSL) have private addresses that phones cannot reach, so they go last.
    // VPN adapters (ProtonVPN, WireGuard, OpenVPN TAP) are tunnels to a remote network, so a phone on the same Wi-Fi cannot reach them either.
    const isVirtual = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:15:5d|00:00:00:00:00:00)/i.test(net.mac) || /virtual|vmware|vethernet|wsl|hyper-v|vpn|proton|wireguard|nordlynx|tap-|tun|zerotier/i.test(name) || net.address.startsWith('192.168.56.');
    (isVirtual ? virtual : real).push(`http://${net.address}:${port}`);
  }
  return [...real, ...virtual];
}

/** True when the listening socket accepts every address (0.0.0.0 or ::), so phones on the same Wi-Fi can reach it. */
function listensOnAllAddresses(req: express.Request) {
  const address = (req.socket as { server?: { address?: () => unknown } }).server?.address?.();
  return !!address && typeof address === 'object' && ['0.0.0.0', '::'].includes((address as { address?: string }).address || '');
}

/** The store this deployment uses. Hosted (INTEGRITY_STORE=firestore) needs a Firebase service account. */
export function monitorStoreFor(env: Record<string, string | undefined>, dataDir = 'data'): MonitorStore {
  if (env.INTEGRITY_STORE === 'firestore') {
    const store = firestoreStoreFromEnv(env);
    if (!store) throw new Error('INTEGRITY_STORE=firestore needs FIREBASE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS).');
    return store;
  }
  return new IntegrityStore(env.INTEGRITY_DATA_DIR || dataDir);
}

export function createIntegrityRouter(env: Record<string, string | undefined>, deps: Deps = {}) {
  const hostedUrl = env.INTEGRITY_HOSTED_URL ? monitorAddress(env.INTEGRITY_HOSTED_URL) : '';
  if (hostedUrl && !hostedUrl.startsWith('https://')) throw new Error('INTEGRITY_HOSTED_URL must be an HTTPS origin.');
  if (hostedUrl && env.INTEGRITY_PUBLIC_URL) throw new Error('Choose hosted service mode or player-only tunnel mode, not both.');
  // Hosted downloads: the API streams the agent and the app from this public HTTPS folder (for example a
  // GitHub release), under the same /downloads/ address, because a 90 MB file does not fit the host itself.
  const downloadBase = env.INTEGRITY_DOWNLOAD_BASE ? new URL(env.INTEGRITY_DOWNLOAD_BASE).href.replace(/\/+$/, '') : '';
  if (downloadBase && !downloadBase.startsWith('https://')) throw new Error('INTEGRITY_DOWNLOAD_BASE must be an HTTPS address.');
  const store = deps.store || monitorStoreFor(env, deps.dataDir);
  const fetcher = deps.fetcher || fetch;
  const verifyStaff = deps.verifyStaff || ((token: string | undefined) => verifyStaffToken(env, token, fetcher));
  const published = deps.published || publishedReader(env, { fetcher });
  const freshPublished = deps.published || publishedReader(env, { fetcher, ttlMs: 0 });
  const rosterEmails = deps.rosterEmails || rosterEmailReader(env, fetcher);
  // The laptop cleans up on a timer. The hosted store cleans up on its own while codes are made.
  if (!deps.store && store instanceof IntegrityStore) { store.cleanup(); setInterval(() => store.cleanup(), 3600_000).unref(); }
  /** Addresses players can open, best first: the online or hosted address, then this laptop's Wi-Fi addresses. */
  const playerAddresses = (req: express.Request) => {
    const port = req.socket.localPort || Number(env.PORT || 3210);
    // Wi-Fi addresses are listed only when the server listens beyond this laptop: HOST=0.0.0.0, or a dev server started with --host.
    const publicUrl = hostedUrl || env.INTEGRITY_PUBLIC_URL || '', lan = !hostedUrl && (env.HOST ? !/^(127\.|localhost$|::1$)/.test(env.HOST) : listensOnAllAddresses(req));
    return { publicUrl, urls: [...(publicUrl ? [publicUrl] : []), ...(lan ? lanUrls(port) : [])] };
  };
  /** The address a new code uses when staff did not choose one. Last resort: the address staff are using now. */
  const defaultPlayerAddress = (req: express.Request) => {
    const first = playerAddresses(req).urls[0];
    if (first) return first;
    try { return monitorAddress(`${req.protocol}://${req.get('host')}`); } catch { return ''; }
  };
  const router = express.Router();
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); next(); });
  // Live screens run through LiveKit, so they work on the laptop server and on the hosted (Vercel) API alike.
  const verifyCaller = deps.verifyCaller || callerVerifier(env, fetcher);
  // iPhone screens arrive through a separate free relay, because Safari cannot share the screen (iphoneRelay.ts).
  // Laptop mode keeps the laptop's current addresses in Firestore on the hosted API, so every instance sees them.
  const relayPlaces = store instanceof FirestoreIntegrityStore ? () => store.relayPlaces() : undefined;
  const relay = deps.relay !== undefined ? deps.relay : iphoneRelayFromEnv(env, fetcher, relayPlaces);
  // While the relay laptop is checked in with its own LiveKit, Android and PC screens use that one (no minute limits).
  const screens = deps.screens !== undefined ? deps.screens
    : liveScreensFromEnv(env, relay?.laptop ? async () => (await relay.place())?.livekit || null : undefined);
  router.use(screenWallRouter(store, verifyCaller, screens, req => originAllowed(req, env), relay));
  router.use(facilitatorRouter(store, verifyCaller, deps.roles === undefined ? firebaseRoleAdmin(env) : deps.roles, req => originAllowed(req, env)));
  const lastCall = new Map<string, number>();
  // Code lookups allow short bursts (a page reload, Chrome's app fallback) but still stop guessing: 10 per 10 seconds per address.
  const lookups = new Map<string, number[]>();
  const tooManyLookups = (ip: string, limit = 10) => {
    const now = Date.now();
    if (lookups.size >= 5000) for (const [key, times] of lookups) if (times[times.length - 1] < now - 10_000) lookups.delete(key);
    if (!lookups.has(ip) && lookups.size >= 5000) return true;
    const recent = (lookups.get(ip) || []).filter(t => now - t < 10_000);
    if (recent.length >= limit) { lookups.set(ip, recent); return true; }
    recent.push(now); lookups.set(ip, recent); return false;
  };
  const tooFast = (key: string, gapMs: number) => {
    const now = Date.now(), last = lastCall.get(key) || 0;
    if (now - last < gapMs) return true;
    if (lastCall.size >= 5000) for (const [entry, at] of lastCall) if (at < now - 60_000) lastCall.delete(entry);
    if (!lastCall.has(key) && lastCall.size >= 5000) return true;
    lastCall.set(key, now); return false;
  };

  /** What a device checks for. Official and practice scans get the same lists. */
  const deviceLists = async (platform: 'android' | 'pc', game: MonitorGame) => {
    const config = await store.config();
    return platform === 'android'
      ? { gamePackages: game === 'mlbb' ? config.android.games.mlbb.packages : config.android.games.codm.packages, blockedPackages: config.android.blockedPackages.map(e => e.match), blockedCertificates: (config.android.blockedCertificates || []).map(e => e.sha256) }
      : { blockedProcesses: config.pc.blockedProcesses.map(e => e.match), blockedApplications: (config.pc.blockedApplications || []).map(e => e.match), blockedFileHashes: (config.pc.blockedFileHashes || []).map(e => e.sha256), blockedModules: (config.pc.blockedModules || []).map(e => e.match), fileSweep: config.pc.fileSweep === true };
  };
  const deviceConfig = async (row: SessionRow) => row.platform === 'ios' ? {} : { ...await deviceLists(row.platform, row.game), scan: { challenge: row.scan_challenge, policyVersion: await store.policyVersion() } };
  const sessionView = async (row: SessionRow) => {
    const [risk, scan, iosClearance] = await Promise.all([store.risk(row), store.scan(row), row.platform === 'ios' ? store.iosClearance(row) : null]);
    return {
      id: row.id, matchId: row.match_id, matchLabel: row.match_label, game: row.game, gameLabel: GAME_LABEL[row.game], platform: row.platform, anyDevice: row.platform_flexible === 1, playerName: row.player_name, team: row.team, record: row.record === 1,
      expectedSteamId: row.expected_steam_id, status: row.status, connection: store.connection(row), createdAt: row.created_at, expiresAt: row.expires_at, claimedAt: row.claimed_at,
      endedAt: row.ended_at, lastSeen: row.last_seen, device: row.device ? JSON.parse(row.device) : null, gsi: row.gsi ? JSON.parse(row.gsi) : null,
      reviewNote: row.review_note, hold: row.hold === 1, mediaBytes: row.media_bytes, risk,
      inspection: inspectionCoverage(row.platform, row.last_facts ? JSON.parse(row.last_facts) : null), scan, playerKey: row.player_key, iosClearance,
      roomId: row.room_id || '', email: row.email || '', college: row.college || '', emailCheck: row.email_check || '', passedAt: row.passed_at ?? null,
    };
  };
  /** Proof for staff that a scan really ran: the first time it passed is kept even after it goes stale. */
  const notePassed = async (row: SessionRow) => {
    // A test check-in without sign-in has nobody behind it, so its scan is never kept as proof.
    if (row.passed_at || unsignedSession(row)) return;
    const scan = await store.scan(row);
    if (scan.status === 'ready') await store.markPassed(row, store.now());
  };

  // Players fetch the Android app and the PC agent from the event laptop, so no store or sign-in is needed.
  const downloadDir = resolve(env.INTEGRITY_DOWNLOAD_DIR || 'dist-agent');
  const available = () => downloadBase ? Object.keys(DOWNLOADS) : Object.keys(DOWNLOADS).filter(name => existsSync(resolve(downloadDir, name)));
  router.get('/downloads/:name', h(async (req, res) => {
    const name = String(req.params.name);
    if (!Object.hasOwn(DOWNLOADS, name) || !available().includes(name)) { res.status(404).type('text/plain').send('This download is not on the laptop yet. Ask the referee.'); return; }
    // ?code= names the agent arenahub-scan-<CODE>.exe, so double-clicking the download already knows the
    // player's scan code. The file itself is identical; only the saved name changes.
    const code = typeof req.query.code === 'string' ? req.query.code.toUpperCase() : '';
    const saveAs = name === 'arenahub-agent.exe' && /^[A-Z2-9]{8}$/.test(code) ? `arenahub-scan-${code}.exe` : name;
    if (!downloadBase) { res.download(resolve(downloadDir, name), saveAs, { headers: { 'Content-Type': DOWNLOADS[name], 'X-Content-Type-Options': 'nosniff' } }); return; }
    // Streamed through this address, so Windows still records it as the download's source and the agent finds this server.
    const upstream = await fetcher(`${downloadBase}/${name}`, { redirect: 'follow', signal: AbortSignal.timeout(290_000) }).catch(() => null);
    if (!upstream?.ok || !upstream.body) { res.status(502).type('text/plain').send('The download is not reachable right now. Try again, or ask the referee.'); return; }
    const length = upstream.headers.get('content-length');
    res.set({ 'Content-Type': DOWNLOADS[name], 'Content-Disposition': `attachment; filename="${saveAs}"`, 'X-Content-Type-Options': 'nosniff', ...(length && /^\d+$/.test(length) ? { 'Content-Length': length } : {}) });
    Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res);
  }));

  // ---------- Device routes ----------
  const device: express.RequestHandler = h(async (req, res, next) => {
    const token = req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    const row = token ? await store.byToken(token) : undefined;
    if (!row) { res.status(410).json({ active: false, error: 'This monitoring session has ended or the pairing is no longer valid.' }); return; }
    res.locals.session = row; next();
  });
  router.post('/device/claim', express.json({ limit: '8kb' }), h(async (req, res) => {
    const input = claimInput.safeParse(req.body);
    if (tooFast(`claim:${clientAddress(req)}`, 1500)) { res.status(429).json({ error: 'Wait a second before trying the code again.' }); return; }
    if (!input.success) { res.status(400).json({ error: 'Enter the 8-character pairing code from the referee screen.' }); return; }
    const pending = await store.pending(input.data.code);
    let claimed: Awaited<ReturnType<MonitorStore['claim']>>;
    try { claimed = await store.claim(input.data.code, input.data.device, pending ? GAME_PLATFORMS[pending.game] : undefined); }
    catch (error) {
      if (!(error instanceof WrongDeviceError)) throw error;
      res.status(409).json({ error: 'Open this code on the phone you will play on: the ArenaHub app on Android, or Safari on iPhone. The code still works.' }); return;
    }
    if (!claimed) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    const row = claimed.session;
    res.json({ token: claimed.token, ...(claimed.gsiToken ? { gsiToken: claimed.gsiToken } : {}), sessionId: row.id, game: row.game, gameLabel: GAME_LABEL[row.game], platform: row.platform, playerName: row.player_name, matchLabel: row.match_label, expiresAt: row.expires_at, heartbeatSeconds: store.heartbeatSeconds, record: row.record === 1, monitor: await deviceConfig(row) });
  }));
  // ---------- Practice scan (no code) ----------
  // Players check their own device before match day. Nothing here is stored or linked to a match.
  const practiceGame = (value: unknown) => typeof value === 'string' && (MONITOR_GAMES as readonly string[]).includes(value) && practicePlatform(value as MonitorGame) ? value as MonitorGame : null;
  router.post('/practice/policy', express.json({ limit: '1kb' }), h(async (req, res) => {
    const game = practiceGame(req.body?.game);
    if (!game) { res.status(400).json({ error: 'Choose Mobile Legends, CODM or Dota 2.' }); return; }
    if (tooManyLookups(clientAddress(req))) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const platform = practicePlatform(game)!;
    // The PC agent judges its practice scan on the PC itself, so it needs the rules, not just the lists.
    res.json({ game, gameLabel: GAME_LABEL[game], platform, monitor: await deviceLists(platform, game), ...(platform === 'pc' ? { config: await store.config() } : {}), note: PRACTICE_NOTE });
  }));
  // The Android app cannot run the TypeScript rules, so it sends its findings once and gets the verdict back.
  router.post('/practice/check', express.json({ limit: '64kb' }), h(async (req, res) => {
    if (tooFast(`practice:${clientAddress(req)}`, 3000)) { res.status(429).json({ error: 'Wait a few seconds before checking again.' }); return; }
    const game = practiceGame(req.body?.game);
    const facts = deviceFactsSchema.safeParse(req.body?.facts);
    if (!game || !facts.success || facts.data.platform !== practicePlatform(game)) { res.status(400).json({ error: 'Update the app and try the practice scan again.' }); return; }
    const verdict = practiceVerdict(game, facts.data, await store.config());
    res.json({ ...verdict, note: PRACTICE_NOTE });
  }));
  // The join page reads what a code is for (device type, game, player) before the player decides. The code stays unused.
  router.get('/device/pairing/:code', h(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tooManyLookups(clientAddress(req))) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const code = String(req.params.code);
    const row = /^[A-Za-z0-9]{8}$/.test(code) ? await store.pending(code) : undefined;
    if (!row) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    // folderCheck lets the PC agent ask for consent once, covering the folder check too.
    // An any-phone code says "any" and lists the devices that can claim it; the page picks one from the browser.
    res.json({ platform: row.platform_flexible === 1 ? 'any' : row.platform, platforms: GAME_PLATFORMS[row.game], game: row.game, gameLabel: GAME_LABEL[row.game], playerName: row.player_name, matchLabel: row.match_label, record: row.record === 1, codeExpiresAt: row.code_expires_at, ...(row.platform === 'pc' ? { folderCheck: (await store.config()).pc.fileSweep === true } : {}) });
  }));
  router.post('/device/decline', express.json({ limit: '2kb' }), h(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (tooFast(`claim:${clientAddress(req)}`, 1500)) { res.status(429).json({ error: 'Wait a second and try again.' }); return; }
    const row = /^[A-Za-z0-9]{8}$/.test(code) ? await store.decline(code) : undefined;
    if (!row) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    res.json({ declined: true });
  }));
  router.post('/device/heartbeat', device, express.json({ limit: '64kb' }), h(async (req, res) => {
    const row = res.locals.session as SessionRow;
    if (tooFast(`hb:${row.id}`, 4000)) { res.status(429).json({ error: 'Reporting too often.' }); return; }
    const facts = deviceFactsSchema.safeParse(req.body);
    if (!facts.success || facts.data.platform !== row.platform) { res.status(400).json({ error: 'The device report was not in the expected format. Update the companion.' }); return; }
    await store.heartbeat(row, facts.data, evaluateFacts(facts.data, await store.config(), row.game, { recordingRequired: row.record === 1 }));
    // The report just written, without reading it back.
    const fresh: SessionRow = { ...row, last_seen: store.now(), last_facts: JSON.stringify(facts.data) };
    await notePassed(fresh);
    res.json({ active: true, heartbeatSeconds: store.heartbeatSeconds, expiresAt: row.expires_at, monitor: await deviceConfig(row), scan: await store.scan(fresh) });
  }));
  // Reading clearance never refreshes a device scan or grants referee approval.
  router.get('/device/status', device, h(async (_req, res) => {
    const row = res.locals.session as SessionRow;
    res.json({ active: true, expiresAt: row.expires_at, record: row.record === 1, scan: await store.scan(row) });
  }));
  const recordingAllowed: express.RequestHandler = (_req, res, next) => {
    if (!store.recordings) { res.status(403).json({ error: NO_RECORDINGS }); return; }
    if ((res.locals.session as SessionRow).record !== 1) { res.status(403).json({ error: 'Recording is disabled for this match.' }); return; }
    next();
  };
  router.post('/device/media', device, recordingAllowed, express.raw({ type: ['video/mp4', 'image/jpeg'], limit: MAX_VIDEO_BYTES }), h(async (req, res) => {
    const row = res.locals.session as SessionRow;
    const data = req.body as Buffer;
    const kind = req.get('content-type') === 'video/mp4' ? 'video' : 'image';
    const valid = Buffer.isBuffer(data) && data.length > 12 && (kind === 'video' ? data.subarray(4, 8).toString('latin1') === 'ftyp' : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data.length <= MAX_IMAGE_BYTES);
    if (!valid) { res.status(400).json({ error: 'Send an MP4 recording segment or a JPEG screenshot.' }); return; }
    if (tooFast(`media:${row.id}`, 2000)) { res.status(429).json({ error: 'Uploading too often.' }); return; }
    if (row.media_bytes + data.length > MAX_SESSION_BYTES) { res.status(507).json({ error: 'This session reached its recording limit.' }); return; }
    res.json({ id: await store.addMedia(row, kind, data) });
  }));
  // Chunked upload for full-match recordings (iPhone). Chunks must arrive in order; the first one must look like MP4/MOV.
  const uploads = new Map<string, { sessionId: string; file: string; next: number; total: number; bytes: number; touched: number }>();
  router.post('/device/upload', device, recordingAllowed, express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES }), h(async (req, res) => {
    const row = res.locals.session as SessionRow;
    const data = req.body as Buffer;
    const id = String(req.get('x-upload-id') || ''), index = Number(req.get('x-chunk-index')), total = Number(req.get('x-chunk-total'));
    if (!/^[a-z0-9]{12,40}$/.test(id) || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || index < 0 || index >= total || !Buffer.isBuffer(data) || !data.length) { res.status(400).json({ error: 'The upload was not in the expected format. Reload the page and try again.' }); return; }
    for (const [key, entry] of uploads) if (Date.now() - entry.touched > 30 * 60_000) { const owner = await store.session(entry.sessionId); if (owner) await store.abortUpload(owner, entry.file); uploads.delete(key); }
    const key = `${row.id}:${id}`;
    let upload = uploads.get(key);
    if (index === 0 && !upload) {
      if (data.length < 12 || data.subarray(4, 8).toString('latin1') !== 'ftyp') { res.status(400).json({ error: 'Choose the screen recording video from your Photos.' }); return; }
      // One upload per session: starting again replaces an unfinished attempt.
      for (const [other, entry] of uploads) if (entry.sessionId === row.id) { await store.abortUpload(row, entry.file); uploads.delete(other); }
      upload = { sessionId: row.id, file: await store.beginUpload(row, data.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4'), next: 0, total, bytes: 0, touched: Date.now() };
      uploads.set(key, upload);
    }
    if (!upload || upload.total !== total || upload.next !== index) { res.status(409).json({ error: 'Upload out of order.', next: upload?.next ?? 0 }); return; }
    if (row.media_bytes + upload.bytes + data.length > MAX_SESSION_BYTES) { await store.abortUpload(row, upload.file); uploads.delete(key); res.status(507).json({ error: 'This session reached its recording limit.' }); return; }
    await store.appendUpload(row, upload.file, data);
    upload.next++; upload.bytes += data.length; upload.touched = Date.now();
    if (upload.next < total) { res.json({ next: upload.next }); return; }
    uploads.delete(key);
    res.json({ done: true, id: await store.finishUpload(row, upload.file) });
  }));
  router.post('/device/stop', device, h(async (_req, res) => {
    const row = res.locals.session as SessionRow;
    await store.end(row.id, 'player', 'The player stopped monitoring on the device');
    res.json({ active: false });
  }));
  // Dota receives a separate, telemetry-only token. Never accept a device-control token here.
  router.post('/dota/gsi', express.json({ limit: '256kb', type: () => true }), h(async (req, res) => {
    const row = typeof req.body?.auth?.token === 'string' && req.body.auth.token.length <= 128 ? await store.byGsiToken(req.body.auth.token) : undefined;
    if (!row || row.game !== 'dota2') { res.status(410).end(); return; }
    if (tooFast(`gsi:${row.id}`, 250)) { res.status(429).end(); return; }
    // The hosted store keeps one update every 30 s per player, which fits the free database quota.
    if (store.gsiMinGapMs && tooFast(`gsi-store:${row.id}`, store.gsiMinGapMs)) { res.status(200).end(); return; }
    const summary = parseGsi(req.body);
    if (summary) await store.saveGsi(row, summary, evaluateGsi(summary, row.expected_steam_id));
    res.status(200).end();
  }));

  // ---------- Rooms: the player side ----------
  // Players open the fixed join address and type the room code from the referee screen.
  const findRoom = async (typed: unknown) => {
    if (typeof typed !== 'string') return undefined;
    const now = store.now();
    return (await store.rooms()).find(room => !room.verified_checkin && roomOpen(room, now) && roomCodeMatches(room, typed, now));
  };
  /** The ArenaHub website players sign in on: PLAYER_SITE_URL, else the first https site allowed to call this API, else this host. */
  const playerSite = (req: express.Request) => {
    const listed = [env.PLAYER_SITE_URL || '', ...allowedOrigins(env)].map(origin => { try { return new URL(origin); } catch { return null; } })
      .find(url => url?.protocol === 'https:');
    return listed ? listed.origin : !hostedUrl ? defaultPlayerAddress(req) : '';
  };
  const roomMatchId = (room: RoomRow) => room.match_id || `room:${room.id}`;
  const WRONG_ROOM = 'That room code is wrong or has changed. Type the code that is on the referee screen now.';
  const checkInRoom = async (req: express.Request, res: express.Response) => {
    const id = String(req.params.id);
    const room = /^[A-Za-z0-9_-]{12}$/.test(id) ? await store.room(id) : undefined;
    if (room?.verified_checkin && roomOpen(room, store.now())) return room;
    res.status(404).json({ error: 'This check-in link has expired or closed. Ask your organizer for the current QR.' });
  };
  router.get('/device/checkin/:id', h(async (req, res) => {
    if (tooManyLookups(`checkin-info:${clientAddress(req)}`, 120)) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const room = await checkInRoom(req, res);
    // A match check-in asks for the code on the staff screen; the old shared check-in does not.
    if (room) res.json({ expiresAt: room.expires_at, ...(room.match_id ? { match: { label: room.label, game: room.game || null, gameLabel: room.game ? GAME_LABEL[room.game] : '', codeLength: ROOM_CODE_LENGTH, noSignIn: room.no_sign_in === true } } : {}) });
  }));

  // ---------- Match check-in: link + rotating code + school account ----------
  const WRONG_CODE = 'That code is wrong or has changed. Type the 8-digit code on the organizer screen now.';
  /** Checks the code and the caller, then finds the caller's roster seat from their school email. */
  const matchCheckInCaller = async (req: express.Request, res: express.Response, room: RoomRow, code: unknown) => {
    if (!room.match_id || !room.game) { res.status(409).json({ error: 'This check-in link is not for a match. Ask your organizer for the current QR.' }); return; }
    if (tooManyLookups(`checkin-code:${clientAddress(req)}`, 20)) { res.status(429).json({ error: 'Too many tries. Wait a few seconds and type the code again.' }); return; }
    if (typeof code !== 'string' || !roomCodeMatches(room, code, store.now())) { res.status(404).json({ error: WRONG_CODE }); return; }
    const sessions = new Map((await store.sessions(roomMatchId(room))).map(row => [row.id, row]));
    const heldSession = (slot: string) => { const held = room.joined?.[slot]; return held ? sessions.get(held.sessionId) : undefined; };
    const taken = (slot: string) => !!slotBlocked(heldSession(slot), store.now());
    const token = bearer(req.get('authorization'));
    // Staff test switch: no sign-in. Only when staff turned it on for this open room, and only without a token,
    // so a signed-in player always goes through the full account check below. The guest gets no email, cannot
    // reconnect over anyone and can only pick seats that have no roster email.
    if (!token && room.no_sign_in === true) {
      return { guest: true as const, uid: `guest:${clientAddress(req)}`, email: '', seat: undefined, taken, mine: (_slot: string) => false, guestHeld: (_slot: string) => false };
    }
    let caller;
    try { caller = await verifyCaller(token); }
    catch (error) { res.status(error instanceof AuthError ? error.status : 401).json({ error: error instanceof AuthError ? error.message : 'Sign in with your school account to continue.' }); return; }
    if (!caller.campus) { res.status(403).json({ error: 'Use a verified school email account to check in.' }); return; }
    const email = caller.email.trim().toLowerCase(), hash = emailHash(email);
    // A seat held by this same account is not "taken" for them: they may be reconnecting.
    const mine = (slot: string) => !!email && heldSession(slot)?.email === email;
    // A signed-in player may take back a seat that a no-sign-in test check-in is holding.
    const guestHeld = (slot: string) => unsignedSession(heldSession(slot));
    return { guest: false as const, uid: caller.uid, email, seat: room.players.find(player => player.emailHash === hash), taken: (slot: string) => taken(slot) && !mine(slot) && !guestHeld(slot), mine, guestHeld };
  };
  const seatView = (player: RoomRow['players'][number], taken: boolean, rejoin = false) => ({ slot: player.slot, name: player.name, team: player.team, college: player.college, taken, rejoin });
  router.post('/device/checkin/:id/identify', express.json({ limit: '2kb' }), h(async (req, res) => {
    if (!originAllowed(req, env)) { res.status(403).json({ error: 'Open the check-in from your ArenaHub website.' }); return; }
    const room = await checkInRoom(req, res);
    if (!room) return;
    const found = await matchCheckInCaller(req, res, room, req.body?.code);
    if (!found) return;
    const game = room.game as MonitorGame;
    res.json({
      label: room.label, game, gameLabel: GAME_LABEL[game], platforms: GAME_PLATFORMS[game],
      you: found.seat ? seatView(found.seat, found.taken(found.seat.slot), found.mine(found.seat.slot)) : null,
      // Only seats without a roster email can be picked by hand; an emailed seat belongs to that account.
      players: found.seat ? [] : room.players.filter(player => !player.emailHash).map(player => seatView(player, found.taken(player.slot))),
    });
  }));
  const matchCheckIn = async (req: express.Request, res: express.Response, room: RoomRow) => {
    const input = matchCheckInInput.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: 'Type the code and try again.' }); return; }
    const found = await matchCheckInCaller(req, res, room, input.data.code);
    if (!found) return;
    if (tooFast(`checkin:${found.uid}`, 1500)) { res.status(429).json({ error: 'Wait a second and try again.' }); return; }
    const game = room.game as MonitorGame, { platform } = input.data;
    if (!GAME_PLATFORMS[game].includes(platform)) {
      res.status(409).json({ error: game === 'dota2' ? 'Dota 2 is checked on the Windows PC you play on. Open this link on that PC.' : `${GAME_LABEL[game]} is checked on the phone you play on. Open this link on that phone.` }); return;
    }
    let seat = found.seat, emailCheck: 'match' | 'unknown' | 'unsigned' = found.guest ? 'unsigned' : 'match';
    if (!seat) {
      seat = room.players.find(player => player.slot === input.data.slot);
      if (!seat) { res.status(400).json({ error: found.guest ? 'Choose your name from the list.' : 'Your school email is not on this match roster. Choose your name from the list.' }); return; }
      if (seat.emailHash) { res.status(403).json({ error: `${seat.name} is linked to a school email. Sign in with that account, or ask your organizer.` }); return; }
      if (!found.guest) emailCheck = 'unknown';
    }
    // Checking in again from the same account (a dropped connection, a restarted phone) replaces the old session.
    // A signed-in player also replaces a no-sign-in test check-in on their seat. Staff still see both in the log.
    const held = room.joined?.[seat.slot];
    if (held && found.mine(seat.slot)) await store.end(held.sessionId, 'player', 'The player checked in again from the same school account');
    else if (held && found.guestHeld(seat.slot)) await store.end(held.sessionId, 'player', 'A signed-in player took this seat back from a test check-in without sign-in');
    // One school account is one player: checking in as another name moves the account to that seat, so the same
    // person never fills (or passes) two seats.
    if (!found.guest) for (const other of Object.keys(room.joined || {})) {
      if (other !== seat.slot && found.mine(other)) await store.resetRoomSlot(room.id, other, found.uid, `The same school account checked in as ${seat.name} instead`);
    }
    try {
      const pairing = await store.joinRoom(room.id, seat.slot, {
        matchId: room.match_id, matchLabel: room.label, game, platform, flexible: GAME_PLATFORMS[game].length > 1,
        playerName: seat.name, team: seat.team, playerKey: seat.playerKey, rosterVersion: room.roster_version, record: store.recordings && room.record === 1, expectedSteamId: '',
        hours: Math.min(12, Math.max(0.5, (room.expires_at - store.now()) / 3600_000)), email: found.email, college: seat.college, emailCheck,
      });
      res.status(201).json({ code: pairing.code, screenKey: screenCredential(room, pairing.id, defaultScreenKey(room)) });
    } catch (error) {
      if (error instanceof RoomError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  };
  // Signed-in players choose their match from the published schedule. Only the caller's own token reads it,
  // so the Firestore rules decide what they may see.
  router.get('/device/checkin/:id/matches', h(async (req, res) => {
    const room = await checkInRoom(req, res);
    if (!room) return;
    const game = String(req.query.game || '');
    if (!(MONITOR_GAMES as readonly string[]).includes(game)) { res.status(400).json({ error: 'Choose your game first.' }); return; }
    const token = bearer(req.get('authorization'));
    try { await verifyCaller(token); }
    catch (error) { res.status(error instanceof AuthError ? error.status : 401).json({ error: 'Sign in with your school account to continue.' }); return; }
    try { res.json(screenMatches(await published(token || ''), game as MonitorGame)); }
    catch { res.status(503).json({ error: 'The match schedule could not be loaded. Try again.' }); }
  }));
  router.post('/device/checkin/:id', express.json({ limit: '2kb' }), h(async (req, res) => {
    if (!originAllowed(req, env)) { res.status(403).json({ error: 'Open the check-in from your ArenaHub website.' }); return; }
    if (tooManyLookups(`checkin-join:${clientAddress(req)}`, 120)) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const room = await checkInRoom(req, res);
    if (!room) return;
    if (room.match_id) { await matchCheckIn(req, res, room); return; }
    const input = checkInInput.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: 'Enter your in-game name, team and college, then choose your game.' }); return; }
    const token = bearer(req.get('authorization'));
    let caller;
    try { caller = await verifyCaller(token); }
    catch (error) {
      res.status(error instanceof AuthError ? error.status : 401).json({ error: error instanceof AuthError ? error.message : 'Sign in with your school account to continue.' }); return;
    }
    if (!caller.campus) { res.status(403).json({ error: 'Use a verified school email account to check in.' }); return; }
    if (tooFast(`checkin:${caller.uid}`, 1500)) { res.status(429).json({ error: 'Wait a second and try again.' }); return; }
    const { game, platform, name, team, college, matchId } = input.data;
    if (!GAME_PLATFORMS[game].includes(platform)) {
      res.status(409).json({ error: game === 'dota2' ? 'Open this link on the Windows PC you play on.' : 'Open this link on the phone you play on.' }); return;
    }
    let match: { id: string; label: string } | undefined;
    if (matchId) {
      try { match = screenMatches(await published(token || ''), game).find(item => item.id === matchId); }
      catch { res.status(503).json({ error: 'The match schedule could not be loaded. Try again.' }); return; }
      if (!match) { res.status(409).json({ error: 'That match has ended or is not a ' + GAME_LABEL[game] + ' match. Choose your match again.' }); return; }
    }
    try {
      const accountSlot = `account:${sha256(caller.uid)}`;
      const pairing = await store.joinRoom(room.id, accountSlot, {
        matchId: roomMatchId(room), matchLabel: match ? match.label : room.label, game, platform, playerName: name.replace(/\s+/g, ' '), team, college, expectedSteamId: '',
        hours: Math.min(12, Math.max(0.5, (room.expires_at - store.now()) / 3600_000)),
        email: caller.email.trim().toLowerCase(), emailCheck: 'verified', playerKey: accountSlot,
      });
      res.status(201).json({ code: pairing.code, screenKey: screenCredential(room, pairing.id, match ? matchScreenKey(match.id) : roomScreenKey(room.id)) });
    } catch (error) {
      if (error instanceof RoomError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  }));
  router.post('/device/room', express.json({ limit: '2kb' }), h(async (req, res) => {
    if (tooManyLookups(clientAddress(req))) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const room = await findRoom(req.body?.code);
    if (!room) {
      // A match check-in code typed on the short address: send the player to that match's sign-in page.
      // The code goes along so they do not type it twice; the check-in page checks it again.
      const typed = typeof req.body?.code === 'string' ? req.body.code : '', now = store.now();
      const match = typed && (await store.rooms()).find(item => item.verified_checkin && item.match_id && roomOpen(item, now) && roomCodeMatches(item, typed, now));
      const site = match && playerSite(req);
      if (match && site) {
        const url = new URL('/player-check-in', site);
        url.searchParams.set('room', match.id); url.searchParams.set('code', normalizeRoomCode(typed));
        res.json({ checkIn: url.href }); return;
      }
      res.status(404).json({ error: WRONG_ROOM }); return;
    }
    const sessions = new Map((await store.sessions(roomMatchId(room))).map(row => [row.id, row]));
    const taken = (slot: string) => { const held = room.joined?.[slot]; return !!slotBlocked(held ? sessions.get(held.sessionId) : undefined, store.now()); };
    const games = room.game ? [room.game] : MONITOR_GAMES;
    // Never sends roster email hashes, session ids or the room secret.
    res.json({
      label: room.label, game: room.game || null, gameLabel: room.game ? GAME_LABEL[room.game] : null,
      games: games.map(game => ({ id: game, label: GAME_LABEL[game], platforms: GAME_PLATFORMS[game] })),
      players: room.players.map(player => ({ slot: player.slot, name: player.name, team: player.team, college: player.college, taken: taken(player.slot) })),
      typeName: room.players.length === 0, expiresAt: room.expires_at, testRoom: room.test_room === true,
    });
  }));
  router.post('/device/room/join', express.json({ limit: '4kb' }), h(async (req, res) => {
    if (tooFast(`room:${clientAddress(req)}`, 1500)) { res.status(429).json({ error: 'Wait a second and try again.' }); return; }
    const input = joinInput.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: input.error.issues[0].message.startsWith('Type') ? input.error.issues[0].message : 'Fill in your name, email and college.' }); return; }
    const room = await findRoom(input.data.code);
    if (!room) { res.status(404).json({ error: WRONG_ROOM }); return; }
    const { platform } = input.data;
    const email = room.test_room ? '' : input.data.email;
    const college = room.test_room ? '' : input.data.college;
    if (!room.test_room && (!EMAIL.test(email) || college.length < 2)) {
      res.status(400).json({ error: !EMAIL.test(email) ? 'Type your email address, for example juan@wmsu.edu.ph.' : 'Type your college.' }); return;
    }
    let slot: string, playerName: string, team: string, playerKey = '', emailCheck: 'match' | 'mismatch' | 'unknown' = 'unknown';
    if (input.data.slot) {
      const player = room.players.find(entry => entry.slot === input.data.slot);
      if (!player) { res.status(400).json({ error: 'Choose your name from the list.' }); return; }
      slot = player.slot; playerName = player.name; team = player.team; playerKey = player.playerKey;
      if (player.emailHash) emailCheck = emailHash(email) === player.emailHash ? 'match' : 'mismatch';
    } else {
      const name = (input.data.name || '').replace(/\s+/g, ' ');
      if (name.length < 2) { res.status(400).json({ error: 'Type your name as it appears in the game.' }); return; }
      if (room.players.some(player => player.name.trim().toLowerCase() === name.toLowerCase())) { res.status(400).json({ error: `${name} is on the list. Choose your name from the list instead.` }); return; }
      slot = nameSlot(name); playerName = name; team = input.data.team;
    }
    const game = (room.game || input.data.game) as MonitorGame | undefined;
    if (!game) { res.status(400).json({ error: 'Choose the game you are playing.' }); return; }

    const allowed = GAME_PLATFORMS[game];
    if (!allowed.includes(platform)) {
      res.status(409).json({ error: game === 'dota2' ? 'Dota 2 is scanned on the PC you play on. Open this page on that PC.' : `${GAME_LABEL[game]} is scanned on the phone you play on. Open this page on that phone.` }); return;
    }
    const hours = Math.min(12, Math.max(0.5, (room.expires_at - store.now()) / 3600_000));
    try {
      const pairing = await store.joinRoom(room.id, slot, {
        matchId: roomMatchId(room), matchLabel: room.label, game, platform: allowed.length > 1 ? platform : allowed[0], flexible: allowed.length > 1,
        playerName, team, playerKey, rosterVersion: room.roster_version, record: store.recordings && room.record === 1, expectedSteamId: '', hours, email, college, emailCheck,
      });
      res.status(201).json({ code: pairing.code, codeExpiresAt: pairing.codeExpiresAt, platform: PLATFORM_LABEL[platform as MonitorPlatform], screenKey: screenCredential(room, pairing.id, defaultScreenKey(room)) });
    } catch (error) {
      if (error instanceof RoomError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  }));

  // Video playback needs a plain URL for the <video> element (it cannot send the staff token), so staff
  // exchange their token for a short-lived, single-file ticket. Range requests let large recordings seek.
  const tickets = new Map<string, { sessionId: string; mediaId: number; expires: number }>();
  router.get('/media/:ticket', h(async (req, res) => {
    const ticket = tickets.get(String(req.params.ticket));
    if (!ticket || ticket.expires < Date.now()) { res.status(404).json({ error: 'This playback link expired. Open the recording again.' }); return; }
    const file = await store.mediaFile(ticket.sessionId, ticket.mediaId);
    if (!file || !existsSync(file.path)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    res.sendFile(file.path, { headers: { 'Content-Type': file.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }));

  // ---------- Staff routes ----------
  const staff = express.Router();
  staff.use((req, res, next) => {
    if (!originAllowed(req, env)) { res.status(403).json({ error: 'Open the match monitor from your ArenaHub website.' }); return; }
    verifyStaff(req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]).then(async who => {
      const person = typeof who === 'string' ? { uid: who, facilitator: false, email: '' } : who;
      (req as StaffRequest).staffUid = person.uid;
      // A facilitator only reaches the matches they are assigned to.
      if (person.facilitator) (req as StaffRequest).scope = new Set(Object.entries(await store.screenStaff()).filter(([, emails]) => emails.includes(person.email)).map(([key]) => key));
      next();
    })
      .catch(error => res.status(error instanceof AuthError ? error.status : 401).json({ error: error instanceof AuthError ? error.message : 'Sign in as tournament staff.' }));
  });
  staff.use(express.json({ limit: '128kb' }));
  const uidOf = (req: express.Request) => (req as StaffRequest).staffUid || 'staff';
  const scopeOf = (req: express.Request) => (req as StaffRequest).scope;
  /** Full staff reach everything; a facilitator reaches a match or check-in room they are assigned to. */
  const inScope = (req: express.Request, matchId?: string, roomId?: string) => {
    const scope = scopeOf(req);
    return !scope || (!!matchId && scope.has('m-' + matchId)) || (!!roomId && scope.has('r-' + roomId));
  };
  const NOT_ASSIGNED = 'You are not assigned to this match. Ask the organizer.';
  /** Settings that change every match (fingerprints, trusted signatures, scan rules) stay with organizers. */
  const organizerOnly = (req: express.Request, res: express.Response) => {
    if (!scopeOf(req)) return false;
    res.status(403).json({ error: 'Only an organizer can change this.' });
    return true;
  };
  const sessionOr404 = async (req: express.Request, res: express.Response) => {
    const row = await store.session(String(req.params.id));
    if (!row) { res.status(404).json({ error: 'Session not found.' }); return undefined; }
    if (!inScope(req, row.match_id, row.room_id)) { res.status(403).json({ error: NOT_ASSIGNED }); return undefined; }
    return row;
  };
  const staffBearer = (req: express.Request) => req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] || '';
  const scanError = (res: express.Response, error: unknown) => res.status(error instanceof ScanAdmissionError ? error.status : 503).json({ error: error instanceof ScanAdmissionError ? error.message : 'Published rosters could not be checked. Try again before starting the match.' });
  staff.get('/matches/:id/readiness', h(async (req, res) => {
    if (!inScope(req, String(req.params.id))) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    try { res.json(await matchScanReadiness(await published(staffBearer(req)), String(req.params.id), store)); }
    catch (error) { scanError(res, error); }
  }));
  staff.post('/matches/:id/admit', h(async (req, res) => {
    if (!inScope(req, String(req.params.id))) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    try {
      const readiness = await matchScanReadiness(await freshPublished(staffBearer(req)), String(req.params.id), store);
      if (!readiness.canStart) { res.status(409).json({ error: `Anti-cheat scan required: ${readiness.ready} of ${readiness.total} players are ready. Open Anti-cheat and resolve the remaining scans.`, readiness }); return; }
      const validUntil = Math.min(...readiness.players.map(player => player.scan.validUntil!));
      await store.audit(uidOf(req), 'match-scan-admission', readiness.matchId, `${readiness.ready} roster players met the current scan requirements`);
      res.json({ admitted: true, matchId: readiness.matchId, validUntil });
    } catch (error) { scanError(res, error); }
  }));

  staff.get('/server-info', (req, res) => {
    // The online address comes first: it works on any Wi-Fi or mobile data. Wi-Fi addresses stay as a fallback.
    const { urls, publicUrl } = playerAddresses(req);
    res.json({ urls, publicUrl, defaultUrl: defaultPlayerAddress(req), signals: SIGNAL_CATALOG, downloads: available(), recordings: store.recordings, hosted: !!hostedUrl });
  });
  staff.get('/config', h(async (_req, res) => { res.json(await store.config()); }));
  staff.put('/config', h(async (req, res) => {
    if (organizerOnly(req, res)) return;
    try { res.json(await store.saveConfig(req.body, uidOf(req))); }
    catch (error) { res.status(400).json({ error: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500) : 'Invalid settings.' }); }
  }));
  staff.post('/pairings', h(async (req, res) => {
    const input = pairingInput.safeParse(req.body);
    let server = '';
    try { if (typeof req.body?.serverUrl === 'string' && req.body.serverUrl.trim()) server = monitorAddress(req.body.serverUrl); } catch { /* Invalid destinations never enter a player command or game config. */ }
    // No address given: use the best one this server knows, so staff never have to type it.
    if (!server && !(typeof req.body?.serverUrl === 'string' && req.body.serverUrl.trim())) server = defaultPlayerAddress(req);
    if (input.success && !inScope(req, input.data.matchId)) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    if (!input.success || !server) { res.status(400).json({ error: input.success ? 'Choose the laptop address that devices can reach.' : input.error.issues[0].message }); return; }
    let rosterVersion = '';
    if (input.data.playerKey) {
      try {
        const source = scanMatch(await freshPublished(staffBearer(req)), input.data.matchId);
        const player = source.players.find(player => player.playerKey === input.data.playerKey);
        if (!player || source.game !== input.data.game) { res.status(400).json({ error: 'Choose a player and game from the current published match roster.' }); return; }
        input.data.playerName = player.playerName; input.data.team = player.team; rosterVersion = source.rosterVersion;
      } catch (error) { scanError(res, error); return; }
    }
    const allowed = GAME_PLATFORMS[input.data.game as MonitorGame];
    // A game played on one kind of device (Dota 2 on PC) needs no choice even when staff ask for any.
    const flexible = input.data.platform === 'any' && allowed.length > 1;
    const platform = !input.data.platform || input.data.platform === 'any' ? allowed[0] : input.data.platform;
    if (!allowed.includes(platform)) { res.status(400).json({ error: 'That game is not played on that kind of device.' }); return; }
    const pairing = await store.createPairing({ ...input.data, record: store.recordings && input.data.record, platform, flexible, rosterVersion }, uidOf(req));
    const link = pairingLink(server, pairing.code);
    res.status(201).json({ ...pairing, platform: flexible ? 'any' : platform, serverUrl: server, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 280 }), agentCommand: `arenahub-agent.exe --server ${server} --code ${pairing.code}` });
  }));
  staff.get('/sessions', h(async (req, res) => {
    const matchId = typeof req.query.matchId === 'string' ? req.query.matchId : undefined;
    res.json(await Promise.all((await store.sessions(matchId)).filter(row => inScope(req, row.match_id, row.room_id)).map(sessionView)));
  }));
  staff.get('/sessions/:id', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const config = await store.config();
    const listed = new Set((config.pc.blockedFileHashes || []).map(entry => entry.sha256));
    const fingerprintOf = (s: { id: string; evidence: string }) => { const sha256 = row.platform === 'pc' ? reportedFingerprint(s) : undefined; return sha256 ? { fingerprint: { sha256, listed: listed.has(sha256) } } : {}; };
    const [view, signals, media, audit] = await Promise.all([sessionView(row), store.signals(row), store.media(row), store.auditFor(row.id)]);
    res.json({ ...view, signals: signals.map(s => ({ ...s, ...SIGNAL_CATALOG[s.id] && { title: SIGNAL_CATALOG[s.id].title, explain: SIGNAL_CATALOG[s.id].explain, category: SIGNAL_CATEGORY[s.id] }, ...fingerprintOf(s) })), media, audit, lastFacts: row.last_facts ? JSON.parse(row.last_facts) : null });
  }));
  staff.post('/sessions/:id/end', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    await store.end(row.id, uidOf(req), 'Ended by staff'); res.json(await sessionView((await store.session(row.id))!));
  }));
  staff.post('/sessions/:id/review', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (note.length < 5 || note.length > 2000) { res.status(400).json({ error: 'Write a review note of 5 to 2,000 characters.' }); return; }
    await store.review(row.id, uidOf(req), note, req.body?.hold === true); res.json(await sessionView((await store.session(row.id))!));
  }));
  staff.post('/sessions/:id/ios-review', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const input = iosReviewSchema.safeParse(req.body);
    if (!input.success) {
      const foundOne = req.body?.approved === true && req.body?.indicators && typeof req.body.indicators === 'object' && Object.values(req.body.indicators).includes('found');
      res.status(400).json({ error: foundOne ? 'Approval is not possible while a sideload or jailbreak indicator is marked found. Revoke with a note, or have the player remove it and inspect again.' : 'Complete every iPhone inspection check, mark every sideload indicator, and write a note of 10 to 2,000 characters. Revocation also requires a note.' });
      return;
    }
    if (row.platform !== 'ios' || row.game === 'dota2' || (input.data.approved && row.status !== 'active')) { res.status(409).json({ error: 'The player must agree to an active iPhone session before inspection.' }); return; }
    if (input.data.approved && row.player_key && row.email_check !== 'verified') {
      try {
        const source = scanMatch(await freshPublished(staffBearer(req)), row.match_id);
        if (source.rosterVersion !== row.roster_version || source.game !== row.game || !source.players.some(player => player.playerKey === row.player_key)) { res.status(409).json({ error: 'The published roster changed. Create a new code for the current player before inspection.' }); return; }
      } catch (error) { scanError(res, error); return; }
    }
    // Re-read after the published roster lookup in case the session ended while waiting.
    const current = (await store.session(row.id))!;
    if (input.data.approved && current.status !== 'active') { res.status(409).json({ error: 'This iPhone session ended. Create a new code before inspection.' }); return; }
    await store.reviewIos(row.id, uidOf(req), input.data);
    const reviewed = (await store.session(row.id))!;
    await notePassed(reviewed);
    res.json(await sessionView((await store.session(row.id))!));
  }));
  // A referee watched the evidence and saw something from the cheat catalogue. This is the behaviour layer.
  staff.post('/sessions/:id/observations', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const cheat = cheatById(row.game, String(req.body?.cheatId || ''));
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().split(/[ \t\r\n]+/).join(' ') : '';
    const severity = SEVERITIES.find(level => level === req.body?.severity);
    if (!cheat || !severity || severity === 'critical' || note.length < 10 || note.length > 150) { res.status(400).json({ error: 'Choose a cheat type and a level, and describe what you saw and when (10 to 150 characters).' }); return; }
    await store.recordSignals(row.id, [{ id: 'referee-observation', severity, evidence: `${cheat.name}: ${note}` }]);
    await store.audit(uidOf(req), 'observation-recorded', row.id, `${cheat.name} [${severity}] ${note}`);
    res.status(201).json(await sessionView((await store.session(row.id))!));
  }));
  staff.post('/sessions/:id/media/:mediaId/ticket', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const mediaId = Number(req.params.mediaId);
    if (!await store.mediaFile(row.id, mediaId)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    for (const [key, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(key);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { sessionId: row.id, mediaId, expires: Date.now() + TICKET_MS });
    res.json({ url: `/api/integrity/media/${ticket}` });
  }));
  staff.post('/sessions/:id/trust-signature', h(async (req, res) => {
    if (organizerOnly(req, res)) return;
    const row = await sessionOr404(req, res); if (!row) return;
    const cert = typeof req.body?.cert === 'string' ? req.body.cert.toLowerCase() : '';
    if (row.platform !== 'android' || !/^[0-9a-f]{64}$/.test(cert)) { res.status(400).json({ error: 'Choose a game signature reported by an Android companion.' }); return; }
    const config = await store.config(), key = row.game === 'mlbb' ? 'mlbb' : 'codm';
    if (!config.android.games[key].trustedCertSha256.includes(cert)) config.android.games[key].trustedCertSha256.push(cert);
    await store.saveConfig(config, uidOf(req)); await store.audit(uidOf(req), 'signature-trusted', row.id, `${key} ${cert}`);
    res.json(config);
  }));
  // A referee confirmed that a flagged file is a cheat. Its fingerprint joins the PC list, so renamed copies on other PCs are caught too.
  // Only a fingerprint this PC actually reported can be added here; anything else goes through the settings form.
  staff.post('/sessions/:id/block-fingerprint', h(async (req, res) => {
    if (organizerOnly(req, res)) return;
    const row = await sessionOr404(req, res); if (!row) return;
    const sha256 = typeof req.body?.sha256 === 'string' ? req.body.sha256.toLowerCase() : '';
    // "|" separates fields in the settings text box, so it cannot appear in a label.
    const label = typeof req.body?.label === 'string' ? req.body.label.replace(/[|\s]+/g, ' ').trim() : '';
    if (row.platform !== 'pc' || !/^[0-9a-f]{64}$/.test(sha256) || !(await store.signals(row)).some(s => reportedFingerprint(s) === sha256)) { res.status(400).json({ error: 'Choose a file fingerprint reported by this PC.' }); return; }
    if (label.length < 2 || label.length > 80) { res.status(400).json({ error: 'Name the file in 2 to 80 characters, for example "Dota map hack loader".' }); return; }
    const config = await store.config(), list = config.pc.blockedFileHashes || [];
    if (!list.some(entry => entry.sha256 === sha256)) {
      if (list.length >= 300) { res.status(400).json({ error: 'The fingerprint list is full (300). Remove an old entry in the settings first.' }); return; }
      config.pc.blockedFileHashes = [...list, { sha256, label, severity: 'high' }];
      await store.saveConfig(config, uidOf(req));
    }
    await store.audit(uidOf(req), 'fingerprint-blocked', row.id, `${label} ${sha256}`);
    res.json(config);
  }));
  staff.post('/sessions/:id/opendota', h(async (req, res) => {
    const row = await sessionOr404(req, res); if (!row) return;
    const gsi = row.gsi ? JSON.parse(row.gsi) : {};
    const matchId = String(req.body?.matchId || gsi.matchId || '');
    const accountId = steamIdToAccountId(row.expected_steam_id || gsi.steamId || '');
    if (row.game !== 'dota2' || !/^\d{1,20}$/.test(matchId) || !accountId) { res.status(400).json({ error: 'A Dota 2 match ID and the player\'s Steam ID are needed. They come from the PC agent or the pairing form.' }); return; }
    try {
      const get = async (path: string) => { const r = await fetcher(`https://api.opendota.com/api/${path}`, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<any>; };
      const match = await get(`matches/${matchId}`);
      const player = (match.players || []).find((p: any) => String(p.account_id) === accountId);
      if (!player) { res.status(404).json({ error: 'OpenDota has this match, but not this player. The match may not be parsed yet, or the profile is private.' }); return; }
      const history = (await get(`players/${accountId}/matches?limit=25&project=kills&project=last_hits&project=gold_per_min&project=xp_per_min&project=hero_damage`) as any[]).filter(m => String(m.match_id) !== matchId);
      const found = statOutliers(player, history);
      await store.recordSignals(row.id, found); await store.audit(uidOf(req), 'opendota-checked', row.id, `Match ${matchId}: ${found.length} outliers over ${history.length} past games`);
      res.json({ matchId, compared: history.length, outliers: found });
    } catch { res.status(502).json({ error: 'OpenDota could not be reached or has not processed this match yet. Try again in a few minutes.' }); }
  }));
  staff.get('/sessions/:id/media/:mediaId', h(async (req, res) => {
    const file = await store.mediaFile(String(req.params.id), Number(req.params.mediaId));
    if (!file || !existsSync(file.path)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    res.type(file.type); res.set('Cache-Control', 'private, no-store');
    createReadStream(file.path).pipe(res);
  }));

  // ---------- Rooms: the staff side ----------
  /** Where players type the room code: the hosted address on its own, or this server's join page. */
  const joinAddress = (req: express.Request) => hostedUrl ? { joinUrl: `${hostedUrl}/join.html`, shortUrl: `${hostedUrl.replace(/^https:\/\//, '')}/join` } : { joinUrl: `${defaultPlayerAddress(req)}/join.html`, shortUrl: '' };
  type Entry = { slot: string; name: string; team: string; college: string; onRoster: boolean; session: SessionRow | null };
  /** The "Scanned players" list: every roster player (joined or not), plus typed-in names, with proof of each scan. */
  const roomView = async (room: RoomRow, req: express.Request) => {
    const now = store.now(), sessions = await store.sessions(roomMatchId(room));
    const byId = new Map(sessions.map(row => [row.id, row]));
    const latestFor = (playerKey: string) => sessions.find(row => row.player_key && row.player_key === playerKey && row.status !== 'declined') || sessions.find(row => row.player_key === playerKey) || null;
    // Accounts that hold a seat now. An older session of that account on another seat is a seat they moved away from.
    const seated = new Set(Object.values(room.joined || {}).map(held => byId.get(held.sessionId)?.email).filter(Boolean));
    const entries: Entry[] = room.players.map(player => {
      const held = room.joined?.[player.slot];
      // A roster player also counts when staff made their code by hand outside the room.
      const earlier = held ? null : latestFor(player.playerKey);
      return { slot: player.slot, name: player.name, team: player.team, college: player.college, onRoster: true, session: (held && byId.get(held.sessionId)) || (earlier?.email && seated.has(earlier.email) ? null : earlier) };
    });
    for (const [slot, held] of Object.entries(room.joined || {})) if (slot.startsWith('name:') || slot.startsWith('account:')) {
      const row = byId.get(held.sessionId) || null;
      if (!row && slot.startsWith('account:')) continue;
      entries.push({ slot, name: row?.player_name || slot.slice(5), team: row?.team || '', college: row?.college || '', onRoster: room.players.length === 0, session: row });
    }
    const emails = new Map<string, Set<string>>();
    for (const entry of entries) if (entry.session?.email) emails.set(entry.session.email, (emails.get(entry.session.email) || new Set()).add(entry.slot));
    const players = await Promise.all(entries.map(async entry => {
      const row = entry.session, scan = row ? await store.scan(row) : null, connection = row ? store.connection(row) : null;
      const result = !row ? 'not-registered' : row.status === 'declined' ? 'declined' : unsignedSession(row) && (scan!.status === 'ready' || row.status === 'ended') ? 'test-unsigned' : scan!.status === 'ready' ? 'passed' : scan!.status === 'blocked' ? 'flagged' : connection === 'lost' ? 'not-reporting' : row.status === 'ended' ? (row.passed_at ? 'passed-earlier' : 'ended') : 'waiting';
      const flags: string[] = [];
      if (unsignedSession(row)) flags.push('Test check-in without sign-in: nobody verified who this is, so it never counts as a pass');
      if (row?.email_check === 'mismatch') flags.push('Email does not match the school email on the roster');
      if (row?.email_check === 'unknown' && room.verified_checkin && entry.onRoster) flags.push('Picked their own name: the roster has no school email for this player');
      if (!entry.onRoster) flags.push('Not on the published roster');
      const sameEmail = row?.email ? [...(emails.get(row.email) || [])].filter(slot => slot !== entry.slot) : [];
      if (sameEmail.length) flags.push(`Same email as ${sameEmail.map(slot => entries.find(e => e.slot === slot)?.name || slot).join(', ')}`);
      const resets = (room.resets || []).filter(reset => reset.slot === entry.slot);
      if (resets.length) flags.push(`Reset by staff ${resets.length === 1 ? 'once' : `${resets.length} times`}, last ${new Date(resets[resets.length - 1].at).toISOString()}`);
      const device = row?.device ? JSON.parse(row.device) as { model?: string; os?: string } : null;
      return { slot: entry.slot, name: entry.name, team: entry.team || row?.team || '', college: row?.college || entry.college, onRoster: entry.onRoster, result, flags, resets,
        sessionId: row?.id || null, email: row?.email || '', emailCheck: row?.email_check || '', gameLabel: row ? GAME_LABEL[row.game] : '', platform: row?.platform || null, device: device ? `${device.model || ''} ${device.os || ''}`.trim() : '',
        joinedAt: row?.created_at || null, passedAt: row?.passed_at ?? null, scanLabel: scan?.label || '', checkedAt: scan?.checkedAt ?? null,
        iphoneSetupAt: null as number | null };
    }));
    // iPhone players whose PRISM stream the relay has already received: set up once, ready for every match.
    if (relay) {
      const ids = new Map(entries.flatMap(entry => entry.session?.platform === 'ios' ? [[entry.slot, iphonePlayerId(relay, entry.session)] as const] : []));
      const setups = new Map((await store.iphoneSetups([...ids.values()])).map(setup => [setup.player_id, setup.verified_at]));
      for (const player of players) player.iphoneSetupAt = setups.get(ids.get(player.slot) || '') ?? null;
    }
    const { code, changesAt } = currentRoomCode(room, now);
    return {
      id: room.id, label: room.label, matchId: room.match_id, game: room.game || null, gameLabel: room.game ? GAME_LABEL[room.game] : 'Player chooses', record: room.record === 1,
      testRoom: room.test_room === true, verifiedCheckIn: room.verified_checkin === true, noSignIn: room.no_sign_in === true,
      createdAt: room.created_at, expiresAt: room.expires_at, open: roomOpen(room, now), closedAt: room.closed_at,
      ...(roomOpen(room, now) ? { code: room.verified_checkin && !room.match_id ? null : code, changesAt: room.verified_checkin && !room.match_id ? room.expires_at : changesAt } : { code: null, changesAt: null }), windowMs: ROOM_WINDOW_MS, ...joinAddress(req),
      passed: players.filter(p => p.result === 'passed' || p.result === 'passed-earlier').length, total: players.length, players,
      serverNow: now,
    };
  };
  staff.get('/rooms', h(async (req, res) => {
    const rooms = (await store.rooms()).filter(room => inScope(req, room.match_id, room.id) && (req.query.verified !== '1' || room.verified_checkin)
      && (roomOpen(room, store.now()) || store.now() - (room.closed_at || room.expires_at) < 12 * 3600_000));
    res.json(await Promise.all(rooms.map(room => roomView(room, req))));
  }));
  staff.get('/rooms/:id', h(async (req, res) => {
    const room = await store.room(String(req.params.id));
    if (!room) { res.status(404).json({ error: 'Room not found.' }); return; }
    if (!inScope(req, room.match_id, room.id)) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    res.json(await roomView(room, req));
  }));
  staff.post('/rooms', h(async (req, res) => {
    const input = roomInput.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: input.error.issues[0].message }); return; }
    // Facilitators open check-in for their own matches; scrims and test rooms stay with organizers.
    if (scopeOf(req) && !(input.data.matchId && inScope(req, input.data.matchId))) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    let room: RoomRow;
    if (input.data.verifiedCheckIn && (input.data.testRoom || (!input.data.matchId && input.data.game))) {
      res.status(400).json({ error: 'A check-in QR is either for one match or shared across games.' }); return;
    }
    if (input.data.noSignIn && !(input.data.matchId && input.data.verifiedCheckIn)) {
      res.status(400).json({ error: 'Check-in without sign-in is only for a match check-in.' }); return;
    }
    if (input.data.testRoom && (input.data.matchId || input.data.game)) {
      res.status(400).json({ error: 'Test rooms let players choose a game and stay separate from matches.' }); return;
    }
    if (input.data.matchId) {
      let source: ReturnType<typeof scanMatch>;
      try { source = scanMatch(await freshPublished(staffBearer(req)), input.data.matchId); } catch (error) { scanError(res, error); return; }
      const emails = await rosterEmails(source.tournamentId, staffBearer(req));
      const players = source.players.map((player, i) => {
        const seat = source.seats[i], hash = emails?.get(seat.teamId)?.get(seat.ign.toLowerCase());
        return { slot: `p${i + 1}`, name: player.playerName, team: player.team, playerKey: player.playerKey, college: seat.college, ...(hash ? { emailHash: hash } : {}) };
      });
      // One code per match: opening a new room closes the old one.
      for (const old of await store.rooms()) if (old.match_id === input.data.matchId && roomOpen(old, store.now())) await store.closeRoom(old.id, uidOf(req));
      room = await store.createRoom({ label: scanMatchLabel(source.match), matchId: input.data.matchId, game: source.game, rosterVersion: source.rosterVersion, players, record: store.recordings && input.data.record, hours: input.data.hours, verifiedCheckIn: input.data.verifiedCheckIn, noSignIn: input.data.noSignIn }, uidOf(req));
    } else {
      const label = input.data.label || 'Scrim';
      if (label.length < 2) { res.status(400).json({ error: 'Name the scrim in 2 to 80 characters.' }); return; }
      room = await store.createRoom({ label, matchId: '', game: input.data.game, rosterVersion: '', players: [], record: store.recordings && input.data.record, hours: input.data.hours, testRoom: input.data.testRoom, verifiedCheckIn: input.data.verifiedCheckIn }, uidOf(req));
    }
    res.status(201).json(await roomView(room, req));
  }));
  staff.post('/rooms/:id/close', h(async (req, res) => {
    const room = await store.room(String(req.params.id));
    if (!room) { res.status(404).json({ error: 'Room not found.' }); return; }
    if (!inScope(req, room.match_id, room.id)) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    await store.closeRoom(room.id, uidOf(req));
    res.json(await roomView((await store.room(room.id))!, req));
  }));
  staff.post('/rooms/:id/new-code', h(async (req, res) => {
    const room = await store.room(String(req.params.id));
    if (!room || !roomOpen(room, store.now())) { res.status(404).json({ error: 'Check-in is not open for this match.' }); return; }
    if (!inScope(req, room.match_id, room.id)) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    if (room.test_room) { res.status(400).json({ error: 'A test room keeps one code.' }); return; }
    await store.newRoomCode(room.id, uidOf(req));
    res.json(await roomView((await store.room(room.id))!, req));
  }));
  staff.post('/rooms/:id/reset', h(async (req, res) => {
    const room = await store.room(String(req.params.id)), slot = typeof req.body?.slot === 'string' ? req.body.slot : '';
    if (!room || !room.joined?.[slot]) { res.status(404).json({ error: 'That player has not joined this room.' }); return; }
    if (!inScope(req, room.match_id, room.id)) { res.status(403).json({ error: NOT_ASSIGNED }); return; }
    await store.resetRoomSlot(room.id, slot, uidOf(req));
    res.json(await roomView((await store.room(room.id))!, req));
  }));
  router.use(staff);
  router.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) { res.destroy(); return; }
    // Body parser errors carry a 4xx status; anything else is the server or its database failing.
    if (error?.status === 413) { res.status(413).json({ error: 'Upload too large.' }); return; }
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) { res.status(400).json({ error: 'The request could not be read.' }); return; }
    if (store instanceof IntegrityStore) { res.status(400).json({ error: 'The request could not be read.' }); return; }
    res.status(503).json({ error: 'The tournament server could not finish that. Try again in a moment.' });
  });
  return router;
}
