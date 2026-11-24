import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, readdirSync, rmdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createIntegrityRouter } from '../server/integrity';
import { IntegrityStore, RETENTION_MS } from '../server/integrityStore';
import { AuthError } from '../server/staffAuth';

function removeTree(path: string) { if (!existsSync(path)) return; if (statSync(path).isDirectory()) { for (const e of readdirSync(path)) removeTree(join(path, e)); rmdirSync(path); } else unlinkSync(path); }
const OFFICIAL = 'a'.repeat(64), MODDED = 'b'.repeat(64);
const facts = (over: Record<string, unknown> = {}) => ({ platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [OFFICIAL], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: true, ...over });
const pause = (ms = 1600) => new Promise(r => setTimeout(r, ms));
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32)]);

async function setup(t: any, fetcher?: typeof fetch, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-integrity-'));
  let clock = 1_800_000_000_000;
  const store = new IntegrityStore(dir, () => clock);
  const verifyStaff = async (token?: string) => { if (token === 'staff') return 'staff-uid'; throw new AuthError(token ? 403 : 401, 'no'); };
  const { corsPolicy } = await import('../server/cors');
  const { publicAccessGuard } = await import('../server/publicAccess');
  const app = express(); app.use(publicAccessGuard(env)); app.use('/api/integrity', corsPolicy(env), createIntegrityRouter(env, { store, verifyStaff, fetcher }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.on('listening', r));
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); store.close(); removeTree(dir); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity`;
  const call = (path: string, init: { method?: string; token?: string; body?: unknown; raw?: Buffer; type?: string; origin?: string; headers?: Record<string, string> } = {}) => fetch(base + path, {
    method: init.method || (init.body !== undefined || init.raw ? 'POST' : 'GET'),
    headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.origin ? { Origin: init.origin } : {}), 'Content-Type': init.type || 'application/json', ...init.headers },
    body: init.raw ? new Uint8Array(init.raw) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { store, call, tick: (ms: number) => { clock += ms; } };
}
const pairing = { matchId: 'm-1', matchLabel: 'QF1 CCS vs COE', game: 'mlbb', playerName: 'Ace', serverUrl: 'http://192.168.1.5:3000' };

test('staff routes require staff and same origin', async t => {
  const { call } = await setup(t);
  assert.equal((await call('/sessions')).status, 401);
  assert.equal((await call('/sessions', { token: 'player' })).status, 403);
  assert.equal((await call('/sessions', { token: 'staff', origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/sessions', { token: 'staff' })).status, 200);
});

test('hosted monitor allows the configured website origin while preserving staff authorization', async t => {
  const site = 'https://arenahub.example.test', host = 'https://api.example.test';
  const { call } = await setup(t, undefined, { CORS_ORIGINS: site, INTEGRITY_HOSTED_URL: host });
  const preflight = await call('/config', { method: 'OPTIONS', origin: site });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods')!, /PUT/);
  assert.equal((await call('/sessions', { origin: site })).status, 401);
  const info = await call('/server-info', { token: 'staff', origin: site });
  assert.equal(info.status, 200);
  assert.equal(info.headers.get('access-control-allow-origin'), site);
  assert.equal((await info.json() as any).urls[0], host);
  const config = await (await call('/config', { token: 'staff', origin: site })).json();
  assert.equal((await call('/config', { method: 'PUT', token: 'staff', origin: site, body: config })).status, 200);
  assert.equal((await call('/sessions', { token: 'staff', origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/sessions', { token: 'staff', origin: site, headers: { 'CF-Ray': 'hosted-proxy' } })).status, 200, 'a public hosted API remains available behind Cloudflare');
});

test('pair, report, score, record, review and end an Android session', async t => {
  const { call, tick } = await setup(t);
  const created = await call('/pairings', { token: 'staff', body: pairing });
  assert.equal(created.status, 201);
  const pair = await created.json() as any;
  assert.match(pair.code, /^[A-Z2-9]{8}$/); assert.match(pair.qr, /^data:image\/png;base64,/);
  assert.equal(pair.link, `${pairing.serverUrl}/join.html?c=${pair.code}`, 'one QR link for every device type');

  assert.equal((await call('/device/claim', { body: { code: 'WRONG123' } })).status, 404);
  assert.equal((await call('/device/claim', { body: { code: pair.code } })).status, 429, 'guessing codes is throttled');
  await pause();
  const claimed = await (await call('/device/claim', { body: { code: pair.code.toLowerCase(), device: { model: 'Pixel 7', os: 'Android 15' } } })).json() as any;
  assert.ok(claimed.token); assert.equal(claimed.platform, 'android');
  assert.deepEqual(claimed.monitor.gamePackages, ['com.mobile.legends']);
  await pause();
  assert.equal((await call('/device/claim', { body: { code: pair.code } })).status, 404, 'codes are single use');

  // Staff trust the official signature, then a clean report keeps the player clear.
  const config = await (await call('/config', { token: 'staff' })).json() as any;
  config.android.games.mlbb.trustedCertSha256 = [OFFICIAL];
  assert.equal((await call('/config', { method: 'PUT', token: 'staff', body: config })).status, 200);
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts() })).status, 200);
  let list = await (await call('/sessions?matchId=m-1', { token: 'staff' })).json() as any[];
  assert.equal(list[0].risk.level, 'clear'); assert.equal(list[0].connection, 'online');

  // Wrong platform payload and flooding are refused.
  await new Promise(r => setTimeout(r, 4100));
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: { platform: 'pc', processes: [], gameRunning: true, screenshotOk: true } })).status, 400);
  await new Promise(r => setTimeout(r, 4100));
  tick(60_000);
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts({ games: [{ packageName: 'com.mobile.legends', certSha256: [MODDED], installer: 'com.android.vending' }], recording: false }) })).status, 200);
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts() })).status, 429);

  const detail = await (await call(`/sessions/${claimed.sessionId}`, { token: 'staff' })).json() as any;
  assert.deepEqual(detail.signals.map((s: any) => s.id).sort(), ['game-signature-mismatch', 'heartbeat-lost', 'recording-stopped']);
  assert.equal(detail.risk.level, 'urgent');
  assert.ok(detail.signals[0].explain);

  // Recording upload: only real MP4/JPEG bytes.
  assert.equal((await call('/device/media', { token: claimed.token, raw: Buffer.from('not a video at all'), type: 'video/mp4' })).status, 400);
  const media = await (await call('/device/media', { token: claimed.token, raw: mp4(), type: 'video/mp4' })).json() as any;
  const file = await call(`/sessions/${claimed.sessionId}/media/${media.id}`, { token: 'staff' });
  assert.equal(file.headers.get('content-type'), 'video/mp4'); assert.equal((await file.arrayBuffer()).byteLength, mp4().length);
  assert.equal((await call(`/sessions/${claimed.sessionId}/media/${media.id}`)).status, 401);

  assert.equal((await call(`/sessions/${claimed.sessionId}/review`, { token: 'staff', body: { note: 'ok' } })).status, 400);
  const reviewed = await (await call(`/sessions/${claimed.sessionId}/review`, { token: 'staff', body: { note: 'Attached to case 123', hold: true } })).json() as any;
  assert.equal(reviewed.hold, true);

  assert.equal((await call(`/sessions/${claimed.sessionId}/end`, { token: 'staff', body: {} })).status, 200);
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts() })).status, 410, 'ended sessions stop accepting reports');
  list = await (await call('/sessions', { token: 'staff' })).json() as any[];
  assert.equal(list[0].connection, 'ended');
});

test('pairing codes expire, sessions close at their window and old data is deleted', async t => {
  const { call, tick, store } = await setup(t);
  const stale = await (await call('/pairings', { token: 'staff', body: pairing })).json() as any;
  tick(6 * 60_000);
  assert.equal((await call('/device/claim', { body: { code: stale.code } })).status, 404);

  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, hours: 1 } })).json() as any;
  await pause();
  const claimed = await (await call('/device/claim', { body: { code: pair.code } })).json() as any;
  await call('/device/media', { token: claimed.token, raw: mp4(), type: 'video/mp4' });
  tick(2 * 3600_000);
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts() })).status, 410);
  assert.equal(store.media(claimed.sessionId).length, 1);
  tick(RETENTION_MS);
  assert.equal(store.cleanup(), 2);
  assert.equal(store.session(claimed.sessionId), undefined);
  assert.equal(existsSync(join(store.mediaRoot, claimed.sessionId)), false);
});

test('Dota 2 GSI and OpenDota checks on a PC session', async t => {
  const history = Array.from({ length: 10 }, (_, i) => ({ match_id: 100 + i, kills: 5 + (i % 3), last_hits: 150, gold_per_min: 450 + i, xp_per_min: 500 + i, hero_damage: 15000 + i * 100 }));
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('/matches/7412345678')) return new Response(JSON.stringify({ players: [{ account_id: 39734273, kills: 30, last_hits: 151, gold_per_min: 452, xp_per_min: 503, hero_damage: 15200 }] }));
    if (url.includes('/players/39734273/matches')) return new Response(JSON.stringify(history));
    return new Response('{}', { status: 404 });
  };
  const { call } = await setup(t, fetcher);
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2', expectedSteamId: '76561198000000001' } })).json() as any;
  assert.equal(pair.platform, 'pc'); assert.match(pair.agentCommand, /^arenahub-agent\.exe --server http:\/\/192\.168\.1\.5:3000 --code [A-Z2-9]{8}$/);
  const claimed = await (await call('/device/claim', { body: { code: pair.code } })).json() as any;
  assert.deepEqual(claimed.monitor.blockedProcesses.slice(0, 1), ['cheatengine*']);

  assert.equal((await call('/dota/gsi', { body: { provider: { appid: 570 }, auth: { token: 'forged' } } })).status, 410);
  const gsi = { provider: { appid: 570 }, map: { matchid: '7412345678', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 60 }, player: { steamid: '76561198000000009' }, hero: { name: 'npc_dota_hero_lina' }, auth: { token: claimed.gsiToken } };
  assert.equal((await call('/dota/gsi', { body: gsi, type: 'text/plain' })).status, 200);
  const result = await (await call(`/sessions/${claimed.sessionId}/opendota`, { token: 'staff', body: {} })).json() as any;
  assert.equal(result.compared, 10); assert.equal(result.outliers[0].id, 'stat-outlier');
  const detail = await (await call(`/sessions/${claimed.sessionId}`, { token: 'staff' })).json() as any;
  assert.equal(detail.gsi.hero, 'lina');
  assert.deepEqual(detail.signals.map((s: any) => s.id).sort(), ['stat-outlier', 'steam-account-mismatch']);
  assert.equal(detail.risk.categories.behaviour, 40, 'Steam mismatch 35 + outlier 5 land in the behaviour category');
  assert.equal(detail.risk.categories['cheat-tools'], 0);

  // Referee observations come from the cheat catalogue for this game only.
  const observe = (body: unknown) => call(`/sessions/${claimed.sessionId}/observations`, { token: 'staff', body });
  assert.equal((await observe({ cheatId: 'wall-hack', severity: 'high', note: 'Tracked enemy through wall at 12:40' })).status, 400, 'wall hack is not a Dota 2 cheat type');
  assert.equal((await observe({ cheatId: 'map-hack', severity: 'critical', note: 'Clicked on fogged enemy at 12:40' })).status, 400, 'a person cannot record a critical signal');
  assert.equal((await observe({ cheatId: 'map-hack', severity: 'high', note: 'short' })).status, 400);
  assert.equal((await observe({ cheatId: 'map-hack', severity: 'high', note: 'Clicked on fogged   enemy at 12:40' })).status, 201);
  const after = await (await call(`/sessions/${claimed.sessionId}`, { token: 'staff' })).json() as any;
  const seen = after.signals.find((s: any) => s.id === 'referee-observation');
  assert.equal(seen.evidence, 'Map hack or vision script: Clicked on fogged enemy at 12:40');
  assert.equal(seen.category, 'behaviour');
  assert.ok(after.audit.some((a: any) => a.action === 'observation-recorded' && a.actor === 'staff-uid'));
});

test('iPhone sessions: check-in, optional chunked upload and playback ticket', async t => {
  const { call } = await setup(t);
  assert.equal((await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2', platform: 'ios' } })).status, 400, 'Dota 2 is not an iPhone game');
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, platform: 'ios', team: 'CCS Phoenix' } })).json() as any;
  assert.equal(pair.platform, 'ios');
  assert.equal(pair.link, `http://192.168.1.5:3000/join.html?c=${pair.code}`);
  const claimed = await (await call('/device/claim', { body: { code: pair.code, device: { model: 'iPhone', os: 'iOS 18.1', agent: 'web 1.0.0' } } })).json() as any;
  assert.deepEqual(claimed.monitor, {});
  let view = (await (await call('/sessions', { token: 'staff' })).json() as any[])[0];
  assert.equal(view.connection, 'paired'); assert.equal(view.team, 'CCS Phoenix'); assert.equal(view.risk.score, 0, 'a silent iPhone is not "lost"');

  const video = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(3000, 7)]);
  const parts = [video.subarray(0, 1000), video.subarray(1000, 2000), video.subarray(2000)];
  const chunk = (id: string, index: number, raw: Buffer, token = claimed.token) => fetchChunk(call, token, id, index, parts.length, raw);
  assert.equal((await chunk('../../etc/passwd', 0, parts[0])).status, 400, 'upload ids cannot carry paths');
  assert.equal((await chunk('abcdefabcdef', 0, Buffer.from('this is not a video file'))).status, 400);
  assert.equal((await chunk('abcdefabcdef', 0, parts[0], 'forged-token')).status, 410);
  assert.equal((await chunk('abcdefabcdef', 0, parts[0])).status, 200);
  const skipped = await chunk('abcdefabcdef', 2, parts[2]);
  assert.equal(skipped.status, 409); assert.equal((await skipped.json() as any).next, 1);
  assert.equal((await chunk('abcdefabcdef', 1, parts[1])).status, 200);
  const done = await (await chunk('abcdefabcdef', 2, parts[2])).json() as any;
  assert.equal(done.done, true);

  // Playback: staff exchange their token for a short-lived link that supports seeking.
  assert.equal((await call(`/sessions/${view.id}/media/${done.id}/ticket`, { body: {} })).status, 401);
  const { url } = await (await call(`/sessions/${view.id}/media/${done.id}/ticket`, { token: 'staff', body: {} })).json() as any;
  const base = `/media/${url.split('/').pop()}`;
  const whole = await call(base);
  assert.equal(whole.headers.get('content-type'), 'video/quicktime');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), video, 'chunks are stored in order, byte for byte');
  const ranged = await call(base, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 100);
  assert.equal((await call('/media/not-a-real-ticket')).status, 404);

  // The referee records iPhones from the observer slot, so an iPhone that checks in and never uploads is not flagged.
  await pause();
  const quiet = await (await call('/pairings', { token: 'staff', body: { ...pairing, platform: 'ios', playerName: 'Bee' } })).json() as any;
  await call('/device/claim', { body: { code: quiet.code } });
  await call(`/sessions/${quiet.id}/end`, { token: 'staff', body: {} });
  view = await (await call(`/sessions/${quiet.id}`, { token: 'staff' })).json() as any;
  assert.deepEqual(view.risk.reasons, []);
});

test('join page info, decline, and the per-match recording switch', async t => {
  const { call, store } = await setup(t);
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, record: false } })).json() as any;
  const info = await call(`/device/pairing/${pair.code}`);
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { platform: 'android', platforms: ['android', 'ios'], game: 'mlbb', gameLabel: 'Mobile Legends', playerName: 'Ace', matchLabel: pairing.matchLabel, record: false, codeExpiresAt: pair.codeExpiresAt });
  assert.equal(store.session(pair.id)!.status, 'pending', 'reading the info does not use the code');
  assert.equal((await call('/device/pairing/short')).status, 404, 'malformed codes are not looked up');
  assert.equal((await call('/device/pairing/ZZZZZZZZ')).status, 404);
  for (let i = 0; i < 7; i++) await call('/device/pairing/ZZZZZZZZ');
  assert.equal((await call('/device/pairing/ZZZZZZZZ')).status, 429, 'more than 10 lookups in 10 seconds are refused');

  // Recording off: a phone with no recording raises nothing about recording.
  const claimed = await (await call('/device/claim', { body: { code: pair.code } })).json() as any;
  assert.equal(claimed.record, false);
  assert.equal((await call('/device/media', { token: claimed.token, raw: mp4(), type: 'video/mp4' })).status, 403, 'the API enforces the recording-off policy');
  assert.equal((await fetchChunk(call, claimed.token, 'abcdefabcdef', 0, 1, mp4())).status, 403, 'chunk uploads cannot bypass recording being off');
  assert.equal(store.media(claimed.sessionId).length, 0);
  const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: ['a'.repeat(64)], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false };
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts })).status, 200);
  let view = (await (await call('/sessions', { token: 'staff' })).json() as any[])[0];
  assert.equal(view.record, false);
  assert.ok(!view.risk.reasons.some((r: any) => r.id.startsWith('recording')));

  // Decline: the code is used up, staff see "declined" with a signal, and the session cannot be claimed.
  await pause();
  const second = await (await call('/pairings', { token: 'staff', body: { ...pairing, playerName: 'Bee', team: 'COE Titans' } })).json() as any;
  assert.equal((await call('/device/decline', { body: { code: 'WRONG123' } })).status, 404);
  await pause();
  const declined = await call('/device/decline', { body: { code: second.code.toLowerCase() } });
  assert.equal(declined.status, 200);
  await pause();
  assert.equal((await call('/device/claim', { body: { code: second.code } })).status, 404, 'a declined code cannot be used');
  view = await (await call(`/sessions/${second.id}`, { token: 'staff' })).json() as any;
  assert.equal(view.status, 'declined'); assert.equal(view.connection, 'declined');
  assert.deepEqual(view.risk.reasons.map((r: any) => r.id), ['monitoring-declined']);
  assert.ok(view.audit.some((a: any) => a.action === 'player-declined'));
  assert.equal((await call(`/sessions/${second.id}/end`, { token: 'staff', body: {} })).status, 200);
  assert.equal(store.session(second.id)!.status, 'declined', 'ending does not hide a decline');
});

function fetchChunk(call: any, token: string, id: string, index: number, total: number, raw: Buffer) {
  return call('/device/upload', { token, raw, type: 'application/octet-stream', headers: { 'X-Upload-Id': id, 'X-Chunk-Index': String(index), 'X-Chunk-Total': String(total) } }) as Promise<Response>;
}

test('GSI credentials are isolated and telemetry cannot conceal a stopped scanner', async t => {
  const { call, store, tick } = await setup(t);
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2' } })).json() as any;
  const response = await call('/device/claim', { body: { code: pair.code } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const claimed = await response.json() as any;
  assert.ok(claimed.gsiToken && claimed.gsiToken !== claimed.token);
  assert.equal(store.session(pair.id)!.token_hash?.includes(claimed.token), false);
  assert.equal(store.session(pair.id)!.gsi_token_hash?.includes(claimed.gsiToken), false);
  assert.equal((await call('/device/heartbeat', { token: claimed.gsiToken, body: { platform: 'pc', processes: [], gameRunning: true, screenshotOk: true } })).status, 410);
  assert.equal((await call('/device/stop', { token: claimed.gsiToken, body: {} })).status, 410);
  const payload = { provider: { appid: 570 }, map: { matchid: '7412345678' }, hero: { name: 'npc_dota_hero_lina' }, auth: { token: claimed.token } };
  assert.equal((await call('/dota/gsi', { body: payload })).status, 410, 'a device token has no GSI capability');
  tick(60_000);
  payload.auth.token = claimed.gsiToken;
  assert.equal((await call('/dota/gsi', { body: payload })).status, 200);
  assert.equal(store.connection(store.session(pair.id)!), 'lost', 'game telemetry does not refresh device-check liveness');
  assert.equal((await call('/device/media', { token: claimed.token, raw: Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(20)]), type: 'image/jpeg' })).status, 200);
  assert.equal(store.connection(store.session(pair.id)!), 'lost', 'recordings do not refresh device-check liveness either');
  await call(`/sessions/${pair.id}/end`, { token: 'staff', body: {} });
  assert.equal((await call('/dota/gsi', { body: payload })).status, 410, 'ending revokes the scoped credential');
  assert.equal((await call('/device/stop', { token: claimed.token, method: 'POST' })).status, 410);
});

test('pairing rejects credentials and injected game-config destinations', async t => {
  const { call } = await setup(t);
  for (const serverUrl of ['https://user:password@example.test', 'https://example.test/path', 'https://example.test?redirect=evil', 'http://host"auth"token"evil', 'https://example.test/#fragment', 'https://safe&calc.test', 'https://safe%26calc.test', 'https://safe%25PATH%25.test', 'https://' + 'a'.repeat(600)]) {
    assert.equal((await call('/pairings', { token: 'staff', body: { ...pairing, serverUrl } })).status, 400);
  }
});

test('online mode: the public tunnel reaches only player routes, and rate limits use the player address', async t => {
  const { publicAccessGuard, playerPathAllowed } = await import('../server/publicAccess');
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-online-'));
  const store = new IntegrityStore(dir);
  const env = { INTEGRITY_PUBLIC_URL: 'https://quiet-river.trycloudflare.com' };
  const app = express(); app.set('trust proxy', 'loopback'); app.use(publicAccessGuard(env));
  app.use('/api/integrity', createIntegrityRouter(env, { store, verifyStaff: async () => 'staff-uid' }));
  app.get('/join.html', (_q, r) => { r.send('join'); });
  app.get('*', (_q, r) => { r.send('site'); });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.on('listening', r));
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); store.close(); removeTree(dir); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const viaTunnel = (path: string, ip = '203.0.113.7', init: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...init, headers: { 'CF-Ray': 'abc', 'CF-Connecting-IP': ip, ...(init.headers as Record<string, string> || {}) } });

  // Staff pages, staff API, recordings and other APIs are closed through the tunnel...
  for (const path of ['/index.html', '/dashboard', '/api/integrity/sessions', '/api/integrity/server-info', '/api/integrity/media/x', '/api/ai/chat', '/api/fair-play/x', '/api/integrity/device/../sessions'])
    assert.equal((await viaTunnel(path)).status, 404, path);
  // ...the bare address sends players to the join page...
  const root = await viaTunnel('/');
  assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/join.html');
  assert.equal(await (await viaTunnel('/join.html')).text(), 'join');
  assert.equal((await viaTunnel('/api/integrity/device/pairing/ABCD2345', '192.0.2.1')).status, 404); // allowed route, unknown code
  // ...and the laptop itself still reaches everything.
  assert.equal(await (await fetch(base + '/dashboard')).text(), 'site');
  const info = await (await fetch(base + '/api/integrity/server-info', { headers: { Authorization: 'Bearer x' } })).json();
  assert.deepEqual(info.urls, ['https://quiet-river.trycloudflare.com']); assert.equal(info.publicUrl, 'https://quiet-river.trycloudflare.com');

  // Two players behind the same tunnel get separate limits; one player bursting is still stopped.
  for (let i = 0; i < 10; i++) assert.equal((await viaTunnel('/api/integrity/device/pairing/ABCD2345', '203.0.113.7')).status, 404);
  assert.equal((await viaTunnel('/api/integrity/device/pairing/ABCD2345', '203.0.113.7')).status, 429);
  assert.equal((await viaTunnel('/api/integrity/device/pairing/ABCD2345', '198.51.100.9')).status, 404);

  assert.equal(playerPathAllowed('/api/integrity/downloads/arenahub-companion.apk'), true);
  assert.equal(playerPathAllowed('/api/integrity/dota/gsi'), true);
  assert.equal(playerPathAllowed('/api/integrity/sessions/abc/end'), false);
});

test('a referee turns a confirmed cheat file into a PC fingerprint', async t => {
  const { call } = await setup(t);
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2' } })).json() as any;
  const claimed = await (await call('/device/claim', { body: { code: pair.code } })).json() as any;
  const loader = 'c'.repeat(64), other = 'd'.repeat(64);
  // A long name and reason must not push the fingerprint past the 200-character evidence limit.
  const finding = { name: `${'very-long-folder-name-'.repeat(4)}loader.exe`, folder: 'Downloads', reason: 'Unsigned program that references dota2.exe and contains DLL-injection functions', sha256: loader, severity: 'high' };
  const report = { platform: 'pc', processes: [], gameRunning: true, screenshotOk: true, fileFindings: [finding] };
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: report })).status, 200);
  const session = `/sessions/${claimed.sessionId}`;
  const flagged = (await (await call(session, { token: 'staff' })).json() as any).signals.find((s: any) => s.id === 'cheat-file-found');
  assert.ok(flagged.evidence.length <= 200);
  assert.deepEqual(flagged.fingerprint, { sha256: loader, listed: false });

  const block = (body: unknown) => call(`${session}/block-fingerprint`, { token: 'staff', body });
  assert.equal((await block({ sha256: other, label: 'Not reported here' })).status, 400, 'only fingerprints this PC reported');
  assert.equal((await block({ sha256: loader, label: 'x' })).status, 400);
  assert.equal((await call(`${session}/block-fingerprint`, { body: { sha256: loader, label: 'Map hack loader' } })).status, 401);
  assert.equal((await block({ sha256: loader.toUpperCase(), label: ' Map | hack\nloader ' })).status, 200);
  assert.equal((await block({ sha256: loader, label: 'Map hack loader' })).status, 200, 'adding twice is harmless');

  const config = await (await call('/config', { token: 'staff' })).json() as any;
  assert.deepEqual(config.pc.blockedFileHashes, [{ sha256: loader, label: 'Map hack loader', severity: 'high' }]);
  const after = await (await call(session, { token: 'staff' })).json() as any;
  assert.equal(after.signals.find((s: any) => s.id === 'cheat-file-found').fingerprint.listed, true);
  assert.ok(after.audit.some((a: any) => a.action === 'fingerprint-blocked' && a.actor === 'staff-uid'));

  // The next PC to claim receives the fingerprint in its policy.
  const next = await (await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2', playerName: 'Bolt' } })).json() as any;
  await pause();
  const nextClaim = await (await call('/device/claim', { body: { code: next.code } })).json() as any;
  assert.deepEqual(nextClaim.monitor.blockedFileHashes, [loader]);
});

test('practice scan returns findings without creating a match session', async t => {
  const { call, store } = await setup(t);
  const policy = await (await call('/practice/policy', { body: { game: 'mlbb' } })).json() as any;
  assert.equal(policy.platform, 'android');
  assert.ok(policy.monitor.blockedPackages.length > 0); assert.ok(policy.monitor.gamePackages.includes('com.mobile.legends'));
  assert.equal(policy.config, undefined, 'phones get lists; only the PC agent needs the rules');
  const pc = await (await call('/practice/policy', { body: { game: 'dota2' } })).json() as any;
  assert.equal(pc.platform, 'pc'); assert.ok(pc.config.pc.blockedProcesses.length > 0);
  assert.equal((await call('/practice/policy', { body: { game: 'chess' } })).status, 400);

  // A trusted game signature lets a clean phone pass, exactly as it would in the official scan.
  const config = store.config(); config.android.games.mlbb.trustedCertSha256 = [OFFICIAL]; store.saveConfig(config, 'staff');
  const check = (facts: unknown, game = 'mlbb') => call('/practice/check', { body: { game, facts } });
  const clean = await (await check({ ...facts(), checks: { installedApps: true, gameSignatures: true, overlays: true, certificates: true } })).json() as any;
  assert.equal(clean.status, 'ready'); assert.equal(clean.label, 'Practice scan complete'); assert.match(clean.note, /does not clear you/);
  await pause(3100);
  const flagged = await (await check({ ...facts({ installedFlagged: ['com.topjohnwu.magisk'] }), checks: { installedApps: true, gameSignatures: true, overlays: true, certificates: true } })).json() as any;
  assert.equal(flagged.status, 'blocked'); assert.ok(flagged.blockers.some((b: string) => /magisk/i.test(b)));
  assert.equal((await check(facts())).status, 429, 'one check every few seconds per address');
  await pause(3100);
  assert.equal((await check(facts(), 'dota2')).status, 400, 'Android facts cannot be judged as a PC');
  assert.equal(store.sessions().length, 0, 'practice creates no session');
});

test('one-click PC scan: the code lookup states the folder check and the download carries the code', async t => {
  const { call } = await setup(t);
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2' } })).json() as any;
  const info = await (await call(`/device/pairing/${pair.code}`)).json() as any;
  assert.equal(info.platform, 'pc'); assert.equal(info.folderCheck, true, 'one consent question can cover the folder check');
  const phone = await (await call('/pairings', { token: 'staff', body: pairing })).json() as any;
  assert.equal((await (await call(`/device/pairing/${phone.code}`)).json() as any).folderCheck, undefined);

  const named = async (query: string) => (await call(`/downloads/arenahub-agent.exe${query}`, { method: 'HEAD' })).headers.get('content-disposition') || '';
  if (!(await call('/downloads/arenahub-agent.exe', { method: 'HEAD' })).ok) { t.skip('dist-agent/arenahub-agent.exe is not built'); return; }
  assert.match(await named(`?code=${pair.code.toLowerCase()}`), new RegExp(`filename="arenahub-scan-${pair.code}\.exe"`));
  assert.match(await named('?code=../../x'), /filename="arenahub-agent\.exe"/, 'anything but a code keeps the normal name');
  assert.match(await named(''), /filename="arenahub-agent\.exe"/);
});

test('one-click codes: no device or address needed; the phone that claims decides, and a PC cannot take a phone code', async t => {
  const { call } = await setup(t);
  // Only the match, game and player: the server picks its own address and leaves the device open.
  const created = await call('/pairings', { token: 'staff', body: { matchId: 'm-quick', matchLabel: 'Quick pair', game: 'mlbb', playerName: 'Ace', platform: 'any', record: false } });
  assert.equal(created.status, 201);
  const pair = await created.json() as any;
  assert.equal(pair.platform, 'any');
  assert.match(pair.link, /^http:\/\/127\.0\.0\.1:\d+\/join\.html\?c=[A-Z2-9]{8}$/, 'falls back to the address staff are using');
  const lookup = await (await call(`/device/pairing/${pair.code}`)).json() as any;
  assert.equal(lookup.platform, 'any');
  assert.deepEqual(lookup.platforms, ['android', 'ios']);
  const pending = (await (await call('/sessions', { token: 'staff' })).json() as any[]).find(s => s.id === pair.id);
  assert.equal(pending.anyDevice, true);

  // A PC agent is refused and the code stays usable for the player's phone.
  const wrong = await call('/device/claim', { body: { code: pair.code, device: { model: 'Desktop', agent: 'pc-agent 3.3.0' } } });
  assert.equal(wrong.status, 409);
  assert.match((await wrong.json() as any).error, /phone you will play on/);
  await pause();
  const iphone = await (await call('/device/claim', { body: { code: pair.code, device: { model: 'iPhone', agent: 'web 2.1.0' } } })).json() as any;
  assert.equal(iphone.platform, 'ios', 'Safari check-in makes it an iPhone session');
  const claimedView = (await (await call('/sessions', { token: 'staff' })).json() as any[]).find(s => s.id === pair.id);
  assert.equal(claimedView.platform, 'ios');
  assert.equal(claimedView.anyDevice, false);

  // The Android app claims an any-phone code as Android.
  const second = await (await call('/pairings', { token: 'staff', body: { matchId: 'm-quick', matchLabel: 'Quick pair', game: 'codm-mp', playerName: 'Bolt', platform: 'any' } })).json() as any;
  await pause();
  assert.equal((await (await call('/device/claim', { body: { code: second.code, device: { agent: 'android 3.3.0' } } })).json() as any).platform, 'android');

  // Dota 2 is PC only, so "any" simply means PC; a configured address still wins.
  const dota = await (await call('/pairings', { token: 'staff', body: { matchId: 'm-dota', matchLabel: 'Dota quick', game: 'dota2', playerName: 'Cid', platform: 'any', serverUrl: 'http://192.168.1.5:3000' } })).json() as any;
  assert.equal(dota.platform, 'pc');
  assert.equal(dota.link, `http://192.168.1.5:3000/join.html?c=${dota.code}`);
  assert.equal((await (await call(`/device/pairing/${dota.code}`)).json() as any).platform, 'pc');
  // A typed address that is not valid is still an error, not silently replaced.
  assert.equal((await call('/pairings', { token: 'staff', body: { matchId: 'm', matchLabel: 'x', game: 'mlbb', playerName: 'D', platform: 'any', serverUrl: 'not a url' } })).status, 400);
});

test('a dev server started with --host puts the Wi-Fi address in the QR, not localhost', async t => {
  // Vite runs the router without HOST set. Before this fix the QR said localhost, which a phone resolves to itself.
  const lan = Object.entries((await import('node:os')).networkInterfaces()).flatMap(([name, list]) => (list || []).filter(n => n.family === 'IPv4' && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)).map(n => ({ name, ...n })));
  if (!lan.length) { t.skip('this machine has no private network address'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-integrity-'));
  const store = new IntegrityStore(dir);
  const app = express(); app.use('/api/integrity', createIntegrityRouter({}, { store, verifyStaff: async () => 'staff-uid' }));
  const server = app.listen(0, '0.0.0.0'); await new Promise<void>(r => server.on('listening', r));
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); store.close(); removeTree(dir); });
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://localhost:${port}/api/integrity/pairings`, { method: 'POST', headers: { Authorization: 'Bearer staff', 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: 'quick', matchLabel: 'Quick', game: 'mlbb', playerName: 'Test device', platform: 'any' }) });
  assert.equal(res.status, 201);
  const { link } = await res.json();
  assert.ok(lan.some(n => link.startsWith(`http://${n.address}:${port}/join.html?c=`)), `expected a Wi-Fi address, got ${link}`);
  // A VPN tunnel address is never first when a real adapter exists.
  const real = lan.filter(n => !/vpn|proton|wireguard|nordlynx|tap-|tun|zerotier|virtual|vmware|vethernet|wsl|hyper-v/i.test(n.name) && !n.address.startsWith('192.168.56.') && n.mac !== '00:00:00:00:00:00' && !/^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:15:5d)/i.test(n.mac));
  if (real.length) assert.ok(real.some(n => link.startsWith(`http://${n.address}:`)), `expected a real adapter, got ${link}`);
});
