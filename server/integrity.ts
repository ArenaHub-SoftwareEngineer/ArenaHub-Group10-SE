// /api/integrity: the Match Integrity Monitor API.
// Staff routes need a verified staff Firebase token. Device routes (Android companion, PC agent,
// Dota 2 Game State Integration) use a session token issued once through a single-use pairing code.
import express from 'express';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { cheatById } from '../src/lib/cheatCatalog.ts';
import QRCode from 'qrcode';
import { z } from 'zod';
import { deviceFactsSchema, evaluateFacts, evaluateGsi, GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, SEVERITIES, SIGNAL_CATEGORY, pairingLink, parseGsi, statOutliers, steamIdToAccountId, SIGNAL_CATALOG, type MonitorGame } from '../src/lib/integrityRisk.ts';
import { HEARTBEAT_SECONDS, IntegrityStore, type SessionRow } from './integrityStore.ts';
import { AuthError, verifyStaffToken } from './staffAuth.ts';
import { clientAddress } from './publicAccess.ts';
import { inspectionCoverage, reportedFingerprint } from '../src/lib/integrityRisk.ts';
import { PRACTICE_NOTE, practicePlatform, practiceVerdict } from '../src/lib/practiceScan.ts';
import { monitorAddress } from '../src/lib/monitorAddress.ts';
import { originAllowed } from './cors.ts';
import { publishedReader, type PublishedReader } from './data.ts';
import { matchScanReadiness, scanMatch, ScanAdmissionError } from './scanAdmission.ts';
import { iosReviewSchema } from '../src/lib/iosAntiCheat.ts';

// Player downloads, served from dist-agent/ by exact name only.
export const DOWNLOADS: Record<string, string> = { 'arenahub-companion.apk': 'application/vnd.android.package-archive', 'arenahub-agent.exe': 'application/octet-stream' };
const CHUNK_BYTES = 8 * 1024 * 1024, MAX_CHUNKS = 1024, TICKET_MS = 10 * 60_000;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024, MAX_IMAGE_BYTES = 3 * 1024 * 1024, MAX_SESSION_BYTES = 4 * 1024 ** 3;
const pairingInput = z.object({
  matchId: z.string().trim().min(1).max(160),
  matchLabel: z.string().trim().min(1).max(200),
  game: z.enum(MONITOR_GAMES),
  playerName: z.string().trim().min(1).max(80),
  team: z.string().trim().max(80).default(''),
  playerKey: z.string().max(400).default(''),
  platform: z.enum(['android', 'ios', 'pc']).optional(),
  expectedSteamId: z.string().trim().regex(/^(\d{17})?$/, 'Steam ID must be the 17-digit SteamID64.').default(''),
  hours: z.number().min(0.5).max(12).default(4),
  record: z.boolean().default(true),
});
const claimInput = z.object({ code: z.string().trim().min(6).max(12), device: z.object({ model: z.string().max(80).default(''), os: z.string().max(80).default(''), agent: z.string().max(40).default('') }).default({ model: '', os: '', agent: '' }) });

type Deps = { store?: IntegrityStore; dataDir?: string; verifyStaff?: (token: string | undefined) => Promise<string>; fetcher?: typeof fetch; published?: PublishedReader };
type StaffRequest = express.Request & { staffUid?: string };

function lanUrls(port: number) {
  const real: string[] = [], virtual: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) for (const net of list || []) {
    if (net.family !== 'IPv4' || net.internal) continue;
    if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address)) continue;
    // Virtual machine adapters (VirtualBox, VMware, Hyper-V, WSL) have private addresses that phones cannot reach, so they go last.
    const isVirtual = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:15:5d)/i.test(net.mac) || /virtual|vmware|vethernet|wsl|hyper-v/i.test(name) || net.address.startsWith('192.168.56.');
    (isVirtual ? virtual : real).push(`http://${net.address}:${port}`);
  }
  return [...real, ...virtual];
}

export function createIntegrityRouter(env: Record<string, string | undefined>, deps: Deps = {}) {
  const hostedUrl = env.INTEGRITY_HOSTED_URL ? monitorAddress(env.INTEGRITY_HOSTED_URL) : '';
  if (hostedUrl && !hostedUrl.startsWith('https://')) throw new Error('INTEGRITY_HOSTED_URL must be an HTTPS origin.');
  if (hostedUrl && env.INTEGRITY_PUBLIC_URL) throw new Error('Choose hosted service mode or player-only tunnel mode, not both.');
  const store = deps.store || new IntegrityStore(env.INTEGRITY_DATA_DIR || deps.dataDir || 'data');
  const fetcher = deps.fetcher || fetch;
  const verifyStaff = deps.verifyStaff || ((token: string | undefined) => verifyStaffToken(env, token, fetcher));
  const published = deps.published || publishedReader(env, { fetcher });
  const freshPublished = deps.published || publishedReader(env, { fetcher, ttlMs: 0 });
  if (!deps.store) { store.cleanup(); setInterval(() => store.cleanup(), 3600_000).unref(); }
  const router = express.Router();
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); next(); });
  const lastCall = new Map<string, number>();
  // Code lookups allow short bursts (a page reload, Chrome's app fallback) but still stop guessing: 10 per 10 seconds per address.
  const lookups = new Map<string, number[]>();
  const tooManyLookups = (ip: string) => {
    const now = Date.now();
    if (lookups.size >= 5000) for (const [key, times] of lookups) if (times[times.length - 1] < now - 10_000) lookups.delete(key);
    if (!lookups.has(ip) && lookups.size >= 5000) return true;
    const recent = (lookups.get(ip) || []).filter(t => now - t < 10_000);
    if (recent.length >= 10) { lookups.set(ip, recent); return true; }
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
  const deviceLists = (platform: 'android' | 'pc', game: MonitorGame) => {
    const config = store.config();
    return platform === 'android'
      ? { gamePackages: game === 'mlbb' ? config.android.games.mlbb.packages : config.android.games.codm.packages, blockedPackages: config.android.blockedPackages.map(e => e.match), blockedCertificates: (config.android.blockedCertificates || []).map(e => e.sha256) }
      : { blockedProcesses: config.pc.blockedProcesses.map(e => e.match), blockedApplications: (config.pc.blockedApplications || []).map(e => e.match), blockedFileHashes: (config.pc.blockedFileHashes || []).map(e => e.sha256), blockedModules: (config.pc.blockedModules || []).map(e => e.match), fileSweep: config.pc.fileSweep === true };
  };
  const deviceConfig = (row: SessionRow) => row.platform === 'ios' ? {} : { ...deviceLists(row.platform, row.game), scan: { challenge: row.scan_challenge, policyVersion: store.policyVersion() } };
  const sessionView = (row: SessionRow) => ({
    id: row.id, matchId: row.match_id, matchLabel: row.match_label, game: row.game, gameLabel: GAME_LABEL[row.game], platform: row.platform, playerName: row.player_name, team: row.team, record: row.record === 1,
    expectedSteamId: row.expected_steam_id, status: row.status, connection: store.connection(row), createdAt: row.created_at, expiresAt: row.expires_at, claimedAt: row.claimed_at,
    endedAt: row.ended_at, lastSeen: row.last_seen, device: row.device ? JSON.parse(row.device) : null, gsi: row.gsi ? JSON.parse(row.gsi) : null,
    reviewNote: row.review_note, hold: row.hold === 1, mediaBytes: row.media_bytes, risk: store.risk(row),
    inspection: inspectionCoverage(row.platform, row.last_facts ? JSON.parse(row.last_facts) : null), scan: store.scan(row), playerKey: row.player_key, iosClearance: row.platform === 'ios' ? store.iosClearance(row.id) : null,
  });

  // Players fetch the Android app and the PC agent from the event laptop, so no store or sign-in is needed.
  const downloadDir = resolve(env.INTEGRITY_DOWNLOAD_DIR || 'dist-agent');
  const available = () => Object.keys(DOWNLOADS).filter(name => existsSync(resolve(downloadDir, name)));
  router.get('/downloads/:name', (req, res) => {
    const name = String(req.params.name);
    if (!Object.hasOwn(DOWNLOADS, name) || !available().includes(name)) { res.status(404).type('text/plain').send('This download is not on the laptop yet. Ask the referee.'); return; }
    // ?code= names the agent arenahub-scan-<CODE>.exe, so double-clicking the download already knows the
    // player's scan code. The file itself is identical; only the saved name changes.
    const code = typeof req.query.code === 'string' ? req.query.code.toUpperCase() : '';
    const saveAs = name === 'arenahub-agent.exe' && /^[A-Z2-9]{8}$/.test(code) ? `arenahub-scan-${code}.exe` : name;
    res.download(resolve(downloadDir, name), saveAs, { headers:{ 'Content-Type': DOWNLOADS[name], 'X-Content-Type-Options': 'nosniff' } });
  });

  // ---------- Device routes ----------
  const device: express.RequestHandler = (req, res, next) => {
    const token = req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    const row = token ? store.byToken(token) : undefined;
    if (!row) { res.status(410).json({ active: false, error: 'This monitoring session has ended or the pairing is no longer valid.' }); return; }
    res.locals.session = row; next();
  };
  router.post('/device/claim', express.json({ limit: '8kb' }), (req, res) => {
    const input = claimInput.safeParse(req.body);
    if (tooFast(`claim:${clientAddress(req)}`, 1500)) { res.status(429).json({ error: 'Wait a second before trying the code again.' }); return; }
    if (!input.success) { res.status(400).json({ error: 'Enter the 8-character pairing code from the referee screen.' }); return; }
    const claimed = store.claim(input.data.code, input.data.device);
    if (!claimed) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    const row = claimed.session;
    res.json({ token: claimed.token, ...(claimed.gsiToken ? { gsiToken: claimed.gsiToken } : {}), sessionId: row.id, game: row.game, gameLabel: GAME_LABEL[row.game], platform: row.platform, playerName: row.player_name, matchLabel: row.match_label, expiresAt: row.expires_at, heartbeatSeconds: HEARTBEAT_SECONDS, record: row.record === 1, monitor: deviceConfig(row) });
  });
  // ---------- Practice scan (no code) ----------
  // Players check their own device before match day. Nothing here is stored or linked to a match.
  const practiceGame = (value: unknown) => typeof value === 'string' && (MONITOR_GAMES as readonly string[]).includes(value) && practicePlatform(value as MonitorGame) ? value as MonitorGame : null;
  router.post('/practice/policy', express.json({ limit: '1kb' }), (req, res) => {
    const game = practiceGame(req.body?.game);
    if (!game) { res.status(400).json({ error: 'Choose Mobile Legends, CODM or Dota 2.' }); return; }
    if (tooManyLookups(clientAddress(req))) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const platform = practicePlatform(game)!;
    // The PC agent judges its practice scan on the PC itself, so it needs the rules, not just the lists.
    res.json({ game, gameLabel: GAME_LABEL[game], platform, monitor: deviceLists(platform, game), ...(platform === 'pc' ? { config: store.config() } : {}), note: PRACTICE_NOTE });
  });
  // The Android app cannot run the TypeScript rules, so it sends its findings once and gets the verdict back.
  router.post('/practice/check', express.json({ limit: '64kb' }), (req, res) => {
    if (tooFast(`practice:${clientAddress(req)}`, 3000)) { res.status(429).json({ error: 'Wait a few seconds before checking again.' }); return; }
    const game = practiceGame(req.body?.game);
    const facts = deviceFactsSchema.safeParse(req.body?.facts);
    if (!game || !facts.success || facts.data.platform !== practicePlatform(game)) { res.status(400).json({ error: 'Update the app and try the practice scan again.' }); return; }
    const verdict = practiceVerdict(game, facts.data, store.config());
    res.json({ ...verdict, note: PRACTICE_NOTE });
  });
  // The join page reads what a code is for (device type, game, player) before the player decides. The code stays unused.
  router.get('/device/pairing/:code', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tooManyLookups(clientAddress(req))) { res.status(429).json({ error: 'Wait a moment and try again.' }); return; }
    const code = String(req.params.code);
    const row = /^[A-Za-z0-9]{8}$/.test(code) ? store.pending(code) : undefined;
    if (!row) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    // folderCheck lets the PC agent ask for consent once, covering the folder check too.
    res.json({ platform: row.platform, game: row.game, gameLabel: GAME_LABEL[row.game], playerName: row.player_name, matchLabel: row.match_label, record: row.record === 1, codeExpiresAt: row.code_expires_at, ...(row.platform === 'pc' ? { folderCheck: store.config().pc.fileSweep === true } : {}) });
  });
  router.post('/device/decline', express.json({ limit: '2kb' }), (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (tooFast(`claim:${clientAddress(req)}`, 1500)) { res.status(429).json({ error: 'Wait a second and try again.' }); return; }
    const row = /^[A-Za-z0-9]{8}$/.test(code) ? store.decline(code) : undefined;
    if (!row) { res.status(404).json({ error: 'That pairing code is wrong, already used or expired. Ask the referee for a new one.' }); return; }
    res.json({ declined: true });
  });
  router.post('/device/heartbeat', device, express.json({ limit: '64kb' }), (req, res) => {
    const row = res.locals.session as SessionRow;
    if (tooFast(`hb:${row.id}`, 4000)) { res.status(429).json({ error: 'Reporting too often.' }); return; }
    const facts = deviceFactsSchema.safeParse(req.body);
    if (!facts.success || facts.data.platform !== row.platform) { res.status(400).json({ error: 'The device report was not in the expected format. Update the companion.' }); return; }
    store.heartbeat(row, facts.data, evaluateFacts(facts.data, store.config(), row.game, { recordingRequired: row.record === 1 }));
    res.json({ active: true, heartbeatSeconds: HEARTBEAT_SECONDS, expiresAt: row.expires_at, monitor: deviceConfig(row), scan: store.scan(store.session(row.id)!) });
  });
  // Reading clearance never refreshes a device scan or grants referee approval.
  router.get('/device/status', device, (_req, res) => {
    const row = res.locals.session as SessionRow;
    res.json({ active: true, expiresAt: row.expires_at, record: row.record === 1, scan: store.scan(row) });
  });
  const recordingAllowed: express.RequestHandler = (_req, res, next) => {
    if ((res.locals.session as SessionRow).record !== 1) { res.status(403).json({ error: 'Recording is disabled for this match.' }); return; }
    next();
  };
  router.post('/device/media', device, recordingAllowed, express.raw({ type: ['video/mp4', 'image/jpeg'], limit: MAX_VIDEO_BYTES }), (req, res) => {
    const row = res.locals.session as SessionRow;
    const data = req.body as Buffer;
    const kind = req.get('content-type') === 'video/mp4' ? 'video' : 'image';
    const valid = Buffer.isBuffer(data) && data.length > 12 && (kind === 'video' ? data.subarray(4, 8).toString('latin1') === 'ftyp' : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data.length <= MAX_IMAGE_BYTES);
    if (!valid) { res.status(400).json({ error: 'Send an MP4 recording segment or a JPEG screenshot.' }); return; }
    if (tooFast(`media:${row.id}`, 2000)) { res.status(429).json({ error: 'Uploading too often.' }); return; }
    if (row.media_bytes + data.length > MAX_SESSION_BYTES) { res.status(507).json({ error: 'This session reached its recording limit.' }); return; }
    res.json({ id: store.addMedia(row, kind, data) });
  });
  // Chunked upload for full-match recordings (iPhone). Chunks must arrive in order; the first one must look like MP4/MOV.
  const uploads = new Map<string, { sessionId: string; file: string; next: number; total: number; bytes: number; touched: number }>();
  router.post('/device/upload', device, recordingAllowed, express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES }), (req, res) => {
    const row = res.locals.session as SessionRow;
    const data = req.body as Buffer;
    const id = String(req.get('x-upload-id') || ''), index = Number(req.get('x-chunk-index')), total = Number(req.get('x-chunk-total'));
    if (!/^[a-z0-9]{12,40}$/.test(id) || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || index < 0 || index >= total || !Buffer.isBuffer(data) || !data.length) { res.status(400).json({ error: 'The upload was not in the expected format. Reload the page and try again.' }); return; }
    for (const [key, entry] of uploads) if (Date.now() - entry.touched > 30 * 60_000) { const owner = store.session(entry.sessionId); if (owner) store.abortUpload(owner, entry.file); uploads.delete(key); }
    const key = `${row.id}:${id}`;
    let upload = uploads.get(key);
    if (index === 0 && !upload) {
      if (data.length < 12 || data.subarray(4, 8).toString('latin1') !== 'ftyp') { res.status(400).json({ error: 'Choose the screen recording video from your Photos.' }); return; }
      // One upload per session: starting again replaces an unfinished attempt.
      for (const [other, entry] of uploads) if (entry.sessionId === row.id) { store.abortUpload(row, entry.file); uploads.delete(other); }
      upload = { sessionId: row.id, file: store.beginUpload(row, data.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4'), next: 0, total, bytes: 0, touched: Date.now() };
      uploads.set(key, upload);
    }
    if (!upload || upload.total !== total || upload.next !== index) { res.status(409).json({ error: 'Upload out of order.', next: upload?.next ?? 0 }); return; }
    if (row.media_bytes + upload.bytes + data.length > MAX_SESSION_BYTES) { store.abortUpload(row, upload.file); uploads.delete(key); res.status(507).json({ error: 'This session reached its recording limit.' }); return; }
    store.appendUpload(row, upload.file, data);
    upload.next++; upload.bytes += data.length; upload.touched = Date.now();
    if (upload.next < total) { res.json({ next: upload.next }); return; }
    uploads.delete(key);
    res.json({ done: true, id: store.finishUpload(row, upload.file) });
  });
  router.post('/device/stop', device, (req, res) => {
    const row = res.locals.session as SessionRow;
    store.end(row.id, 'player', 'The player stopped monitoring on the device');
    res.json({ active: false });
  });
  // Dota receives a separate, telemetry-only token. Never accept a device-control token here.
  router.post('/dota/gsi', express.json({ limit: '256kb', type: () => true }), (req, res) => {
    const row = typeof req.body?.auth?.token === 'string' && req.body.auth.token.length <= 128 ? store.byGsiToken(req.body.auth.token) : undefined;
    if (!row || row.game !== 'dota2') { res.status(410).end(); return; }
    if (tooFast(`gsi:${row.id}`, 250)) { res.status(429).end(); return; }
    const summary = parseGsi(req.body);
    if (summary) store.saveGsi(row, summary, evaluateGsi(summary, row.expected_steam_id));
    res.status(200).end();
  });

  // Video playback needs a plain URL for the <video> element (it cannot send the staff token), so staff
  // exchange their token for a short-lived, single-file ticket. Range requests let large recordings seek.
  const tickets = new Map<string, { sessionId: string; mediaId: number; expires: number }>();
  router.get('/media/:ticket', (req, res) => {
    const ticket = tickets.get(String(req.params.ticket));
    if (!ticket || ticket.expires < Date.now()) { res.status(404).json({ error: 'This playback link expired. Open the recording again.' }); return; }
    const file = store.mediaFile(ticket.sessionId, ticket.mediaId);
    if (!file || !existsSync(file.path)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    res.sendFile(file.path, { headers: { 'Content-Type': file.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  });

  // ---------- Staff routes ----------
  const staff = express.Router();
  staff.use((req, res, next) => {
    if (!originAllowed(req, env)) { res.status(403).json({ error: 'Open the match monitor from your ArenaHub website.' }); return; }
    verifyStaff(req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]).then(uid => { (req as StaffRequest).staffUid = uid; next(); })
      .catch(error => res.status(error instanceof AuthError ? error.status : 401).json({ error: error instanceof AuthError ? error.message : 'Sign in as tournament staff.' }));
  });
  staff.use(express.json({ limit: '128kb' }));
  const uidOf = (req: express.Request) => (req as StaffRequest).staffUid || 'staff';
  const sessionOr404 = (req: express.Request, res: express.Response) => { const row = store.session(String(req.params.id)); if (!row) res.status(404).json({ error: 'Session not found.' }); return row; };
  const staffBearer = (req: express.Request) => req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] || '';
  const scanError = (res: express.Response, error: unknown) => res.status(error instanceof ScanAdmissionError ? error.status : 503).json({ error: error instanceof ScanAdmissionError ? error.message : 'Published rosters could not be checked. Try again before starting the match.' });
  staff.get('/matches/:id/readiness', async (req, res) => {
    try { res.json(matchScanReadiness(await published(staffBearer(req)), String(req.params.id), store)); }
    catch (error) { scanError(res, error); }
  });
  staff.post('/matches/:id/admit', async (req, res) => {
    try {
      const readiness = matchScanReadiness(await freshPublished(staffBearer(req)), String(req.params.id), store);
      if (!readiness.canStart) { res.status(409).json({ error: `Anti-cheat scan required: ${readiness.ready} of ${readiness.total} players are ready. Open Anti-cheat and resolve the remaining scans.`, readiness }); return; }
      const validUntil = Math.min(...readiness.players.map(player => player.scan.validUntil!));
      store.audit(uidOf(req), 'match-scan-admission', readiness.matchId, `${readiness.ready} roster players met the current scan requirements`);
      res.json({ admitted: true, matchId: readiness.matchId, validUntil });
    } catch (error) { scanError(res, error); }
  });

  staff.get('/server-info', (req, res) => {
    const port = req.socket.localPort || Number(env.PORT || 3210);
    // The online address comes first: it works on any Wi-Fi or mobile data. Wi-Fi addresses stay as a fallback.
    // Wi-Fi addresses are listed only when the server listens beyond this laptop (LAN mode, HOST=0.0.0.0).
    const publicUrl = hostedUrl || env.INTEGRITY_PUBLIC_URL || '', lan = !!env.HOST && !/^(127\.|localhost$|::1$)/.test(env.HOST);
    res.json({ urls: [...(publicUrl ? [publicUrl] : []), ...(lan ? lanUrls(port) : [])], publicUrl, signals: SIGNAL_CATALOG, downloads: available() });
  });
  staff.get('/config', (_req, res) => { res.json(store.config()); });
  staff.put('/config', (req, res) => {
    try { res.json(store.saveConfig(req.body, uidOf(req))); }
    catch (error) { res.status(400).json({ error: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500) : 'Invalid settings.' }); }
  });
  staff.post('/pairings', async (req, res) => {
    const input = pairingInput.safeParse(req.body);
    let server = '';
    try { if (typeof req.body?.serverUrl === 'string') server = monitorAddress(req.body.serverUrl); } catch { /* Invalid destinations never enter a player command or game config. */ }
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
    const platform = input.data.platform || allowed[0];
    if (!allowed.includes(platform)) { res.status(400).json({ error: 'That game is not played on that kind of device.' }); return; }
    const pairing = store.createPairing({ ...input.data, platform, rosterVersion }, uidOf(req));
    const link = pairingLink(server, pairing.code);
    res.status(201).json({ ...pairing, platform, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 280 }), agentCommand: `arenahub-agent.exe --server ${server} --code ${pairing.code}` });
  });
  staff.get('/sessions', (req, res) => {
    const matchId = typeof req.query.matchId === 'string' ? req.query.matchId : undefined;
    res.json(store.sessions(matchId).map(sessionView));
  });
  staff.get('/sessions/:id', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const listed = new Set((store.config().pc.blockedFileHashes || []).map(entry => entry.sha256));
    const fingerprintOf = (s: { id: string; evidence: string }) => { const sha256 = row.platform === 'pc' ? reportedFingerprint(s) : undefined; return sha256 ? { fingerprint: { sha256, listed: listed.has(sha256) } } : {}; };
    res.json({ ...sessionView(row), signals: store.signals(row.id).map(s => ({ ...s, ...SIGNAL_CATALOG[s.id] && { title: SIGNAL_CATALOG[s.id].title, explain: SIGNAL_CATALOG[s.id].explain, category: SIGNAL_CATEGORY[s.id] }, ...fingerprintOf(s) })), media: store.media(row.id), audit: store.auditFor(row.id), lastFacts: row.last_facts ? JSON.parse(row.last_facts) : null });
  });
  staff.post('/sessions/:id/end', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    store.end(row.id, uidOf(req), 'Ended by staff'); res.json(sessionView(store.session(row.id)!));
  });
  staff.post('/sessions/:id/review', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (note.length < 5 || note.length > 2000) { res.status(400).json({ error: 'Write a review note of 5 to 2,000 characters.' }); return; }
    store.review(row.id, uidOf(req), note, req.body?.hold === true); res.json(sessionView(store.session(row.id)!));
  });
  staff.post('/sessions/:id/ios-review', async (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const input = iosReviewSchema.safeParse(req.body);
    if (!input.success) {
      const foundOne = req.body?.approved === true && req.body?.indicators && typeof req.body.indicators === 'object' && Object.values(req.body.indicators).includes('found');
      res.status(400).json({ error: foundOne ? 'Approval is not possible while a sideload or jailbreak indicator is marked found. Revoke with a note, or have the player remove it and inspect again.' : 'Complete every iPhone inspection check, mark every sideload indicator, and write a note of 10 to 2,000 characters. Revocation also requires a note.' });
      return;
    }
    if (row.platform !== 'ios' || row.game === 'dota2' || (input.data.approved && row.status !== 'active')) { res.status(409).json({ error: 'The player must agree to an active iPhone session before inspection.' }); return; }
    if (input.data.approved && row.player_key) {
      try {
        const source = scanMatch(await freshPublished(staffBearer(req)), row.match_id);
        if (source.rosterVersion !== row.roster_version || source.game !== row.game || !source.players.some(player => player.playerKey === row.player_key)) { res.status(409).json({ error: 'The published roster changed. Create a new code for the current player before inspection.' }); return; }
      } catch (error) { scanError(res, error); return; }
    }
    // Re-read after the published roster lookup in case the session ended while waiting.
    const current = store.session(row.id)!;
    if (input.data.approved && current.status !== 'active') { res.status(409).json({ error: 'This iPhone session ended. Create a new code before inspection.' }); return; }
    store.reviewIos(row.id, uidOf(req), input.data);
    res.json(sessionView(store.session(row.id)!));
  });
  // A referee watched the evidence and saw something from the cheat catalogue. This is the behaviour layer.
  staff.post('/sessions/:id/observations', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const cheat = cheatById(row.game, String(req.body?.cheatId || ''));
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().split(/[ \t\r\n]+/).join(' ') : '';
    const severity = SEVERITIES.find(level => level === req.body?.severity);
    if (!cheat || !severity || severity === 'critical' || note.length < 10 || note.length > 150) { res.status(400).json({ error: 'Choose a cheat type and a level, and describe what you saw and when (10 to 150 characters).' }); return; }
    store.recordSignals(row.id, [{ id: 'referee-observation', severity, evidence: `${cheat.name}: ${note}` }]);
    store.audit(uidOf(req), 'observation-recorded', row.id, `${cheat.name} [${severity}] ${note}`);
    res.status(201).json(sessionView(store.session(row.id)!));
  });
  staff.post('/sessions/:id/media/:mediaId/ticket', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const mediaId = Number(req.params.mediaId);
    if (!store.mediaFile(row.id, mediaId)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    for (const [key, entry] of tickets) if (entry.expires < Date.now()) tickets.delete(key);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { sessionId: row.id, mediaId, expires: Date.now() + TICKET_MS });
    res.json({ url: `/api/integrity/media/${ticket}` });
  });
  staff.post('/sessions/:id/trust-signature', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const cert = typeof req.body?.cert === 'string' ? req.body.cert.toLowerCase() : '';
    if (row.platform !== 'android' || !/^[0-9a-f]{64}$/.test(cert)) { res.status(400).json({ error: 'Choose a game signature reported by an Android companion.' }); return; }
    const config = store.config(), key = row.game === 'mlbb' ? 'mlbb' : 'codm';
    if (!config.android.games[key].trustedCertSha256.includes(cert)) config.android.games[key].trustedCertSha256.push(cert);
    store.saveConfig(config, uidOf(req)); store.audit(uidOf(req), 'signature-trusted', row.id, `${key} ${cert}`);
    res.json(config);
  });
  // A referee confirmed that a flagged file is a cheat. Its fingerprint joins the PC list, so renamed copies on other PCs are caught too.
  // Only a fingerprint this PC actually reported can be added here; anything else goes through the settings form.
  staff.post('/sessions/:id/block-fingerprint', (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
    const sha256 = typeof req.body?.sha256 === 'string' ? req.body.sha256.toLowerCase() : '';
    // "|" separates fields in the settings text box, so it cannot appear in a label.
    const label = typeof req.body?.label === 'string' ? req.body.label.replace(/[|\s]+/g, ' ').trim() : '';
    if (row.platform !== 'pc' || !/^[0-9a-f]{64}$/.test(sha256) || !store.signals(row.id).some(s => reportedFingerprint(s) === sha256)) { res.status(400).json({ error: 'Choose a file fingerprint reported by this PC.' }); return; }
    if (label.length < 2 || label.length > 80) { res.status(400).json({ error: 'Name the file in 2 to 80 characters, for example "Dota map hack loader".' }); return; }
    const config = store.config(), list = config.pc.blockedFileHashes || [];
    if (!list.some(entry => entry.sha256 === sha256)) {
      if (list.length >= 300) { res.status(400).json({ error: 'The fingerprint list is full (300). Remove an old entry in the settings first.' }); return; }
      config.pc.blockedFileHashes = [...list, { sha256, label, severity: 'high' }];
      store.saveConfig(config, uidOf(req));
    }
    store.audit(uidOf(req), 'fingerprint-blocked', row.id, `${label} ${sha256}`);
    res.json(config);
  });
  staff.post('/sessions/:id/opendota', async (req, res) => {
    const row = sessionOr404(req, res); if (!row) return;
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
      store.recordSignals(row.id, found); store.audit(uidOf(req), 'opendota-checked', row.id, `Match ${matchId}: ${found.length} outliers over ${history.length} past games`);
      res.json({ matchId, compared: history.length, outliers: found });
    } catch { res.status(502).json({ error: 'OpenDota could not be reached or has not processed this match yet. Try again in a few minutes.' }); }
  });
  staff.get('/sessions/:id/media/:mediaId', (req, res) => {
    const file = store.mediaFile(String(req.params.id), Number(req.params.mediaId));
    if (!file || !existsSync(file.path)) { res.status(404).json({ error: 'Recording not found or already deleted.' }); return; }
    res.type(file.type); res.set('Cache-Control', 'private, no-store');
    createReadStream(file.path).pipe(res);
  });
  router.use(staff);
  router.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error?.status === 413 ? 413 : 400).json({ error: error?.status === 413 ? 'Upload too large.' : 'The request could not be read.' }));
  return router;
}
