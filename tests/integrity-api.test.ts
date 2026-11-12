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
const facts = (over: Record<string, unknown> = {}) => ({ platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [OFFICIAL] }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: true, ...over });
const pause = (ms = 1600) => new Promise(r => setTimeout(r, ms));
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32)]);

async function setup(t: any, fetcher?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-integrity-'));
  let clock = 1_800_000_000_000;
  const store = new IntegrityStore(dir, () => clock);
  const verifyStaff = async (token?: string) => { if (token === 'staff') return 'staff-uid'; throw new AuthError(token ? 403 : 401, 'no'); };
  const app = express(); app.use('/api/integrity', createIntegrityRouter({}, { store, verifyStaff, fetcher }));
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

test('pair, report, score, record, review and end an Android session', async t => {
  const { call, tick } = await setup(t);
  const created = await call('/pairings', { token: 'staff', body: pairing });
  assert.equal(created.status, 201);
  const pair = await created.json() as any;
  assert.match(pair.code, /^[A-Z2-9]{8}$/); assert.match(pair.qr, /^data:image\/png;base64,/);
  assert.equal(pair.link, `arenahub://pair?s=${encodeURIComponent(pairing.serverUrl)}&c=${pair.code}`);

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
  assert.equal((await call('/device/heartbeat', { token: claimed.token, body: facts({ games: [{ packageName: 'com.mobile.legends', certSha256: [MODDED] }], recording: false }) })).status, 200);
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
  const gsi = { provider: { appid: 570 }, map: { matchid: '7412345678', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 60 }, player: { steamid: '76561198000000009' }, hero: { name: 'npc_dota_hero_lina' }, auth: { token: claimed.token } };
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

test('iPhone sessions: web pairing link, chunked upload, playback ticket and missing-recording signal', async t => {
  const { call } = await setup(t);
  assert.equal((await call('/pairings', { token: 'staff', body: { ...pairing, game: 'dota2', platform: 'ios' } })).status, 400, 'Dota 2 is not an iPhone game');
  const pair = await (await call('/pairings', { token: 'staff', body: { ...pairing, platform: 'ios', team: 'CCS Phoenix' } })).json() as any;
  assert.equal(pair.platform, 'ios');
  assert.equal(pair.link, `http://192.168.1.5:3000/proctor.html?c=${pair.code}`);
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

  // A second iPhone that never uploads is flagged once its session ends.
  await pause();
  const quiet = await (await call('/pairings', { token: 'staff', body: { ...pairing, platform: 'ios', playerName: 'Bee' } })).json() as any;
  await call('/device/claim', { body: { code: quiet.code } });
  await call(`/sessions/${quiet.id}/end`, { token: 'staff', body: {} });
  view = await (await call(`/sessions/${quiet.id}`, { token: 'staff' })).json() as any;
  assert.deepEqual(view.risk.reasons.map((r: any) => r.id), ['recording-missing']);
  assert.equal(view.risk.categories.connection, 15);
});

function fetchChunk(call: any, token: string, id: string, index: number, total: number, raw: Buffer) {
  return call('/device/upload', { token, raw, type: 'application/octet-stream', headers: { 'X-Upload-Id': id, 'X-Chunk-Index': String(index), 'X-Chunk-Total': String(total) } }) as Promise<Response>;
}
