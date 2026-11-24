// Room codes: one fixed join address, a code only staff can see that changes every 5 minutes,
// registration (name, email, college) and the staff "Scanned players" list.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createIntegrityRouter } from '../server/integrity';
import { IntegrityStore } from '../server/integrityStore';
import { AuthError } from '../server/staffAuth';
import { ROOM_GRACE_MS, ROOM_WINDOW_MS, currentRoomCode, emailHash, roomCodeAt, roomCodeMatches } from '../server/monitorStore';
import type { PublishedData } from '../server/data';
import type { RosterEmails } from '../server/privateRoster';
import { liveScreensFromEnv, parseState, type LiveScreens } from '../server/liveScreens';
import { TokenVerifier } from 'livekit-server-sdk';

const signer = 'c'.repeat(64);
function fixture(): PublishedData {
  const team = (id: string) => ({ id, name: id.toUpperCase(), collegeCode: `C${id.slice(0, 2).toUpperCase()}`, players: [{ id: `${id}-p`, ign: `${id} ace`, name: 'Private name' }] });
  return { brackets: [{ id: 'tournament', gameId: 'game-mlbb', matches: [{ id: 'match', matchNumber: 'QF1', status: 'upcoming', gameId: 'game-mlbb', team1: team('alpha'), team2: team('bravo') }] }], revision: '1', checkedAt: '' } as unknown as PublishedData;
}
const rosterEmails = async (tournamentId: string): Promise<RosterEmails> => {
  assert.equal(tournamentId, 'tournament');
  return new Map([['alpha', new Map([['alpha ace', emailHash('Alpha.Ace@wmsu.edu.ph')]])], ['bravo', new Map([['bravo ace', emailHash('bravo@wmsu.edu.ph')]])]]);
};

async function setup(t: any, screens?: LiveScreens | null) {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-rooms-'));
  // Start inside a window, past the grace period, so the previous code is not accepted by accident.
  let now = Math.floor(Date.now() / ROOM_WINDOW_MS) * ROOM_WINDOW_MS + 2 * ROOM_GRACE_MS;
  const store = new IntegrityStore(dir, () => now);
  const config = store.config(); config.android.games.mlbb.trustedCertSha256 = [signer]; store.saveConfig(config, 'fixture');
  const app = express();
  app.use('/api/integrity', createIntegrityRouter({}, { ...(screens !== undefined ? { screens } : {}), store, published: async () => fixture(), rosterEmails,
    verifyCaller: async token => {
      if (!token || !['staff', 'ref', 'other', 'student', 'visitor'].includes(token)) throw new AuthError(401, 'Sign in');
      const campus = token !== 'visitor', staff = ['staff', 'ref', 'other'].includes(token);
      return { uid: token, email: token + (campus ? '@wmsu.edu.ph' : '@example.com'), campus, admitted: true, staff, role: token === 'staff' ? 'admin' : staff ? 'moderator' : 'student' };
    },
    verifyStaff: async token => { if (token !== 'staff') throw new AuthError(token ? 403 : 401, 'Staff required'); return 'staff-uid'; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); for (const file of await readdir(dir)) if (file.startsWith('integrity.db')) await unlink(join(dir, file)); await rmdir(join(dir, 'recordings')); await rmdir(dir); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity`;
  const call = async (path: string, body?: unknown, token: string | null = 'staff') => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  // Joins are limited to one every 1.5 s per address, like a real phone.
  const join_ = async (body: Record<string, unknown>) => { await sleep(1600); return call('/device/room/join', body, null); };
  const scanPhone = async (code: string) => {
    const claimed = await call('/device/claim', { code, device: { model: 'Pixel 8', os: 'Android 15', agent: 'android 3.3' } }, null);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, certificates: true, overlays: false }, scan: claimed.body.monitor.scan };
    const beat = await call('/device/heartbeat', facts, claimed.body.token);
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
    return { beat: beat.body, token: claimed.body.token as string, sessionId: claimed.body.sessionId as string };
  };
  return { base, store, call, join: join_, scanPhone, tick: (ms: number) => { now += ms; }, now: () => now };
}

test('one QR admits only verified campus accounts and runs the device scan under their verified identity', async t => {
  const { store, call, scanPhone } = await setup(t);
  const details = { name: 'Student IGN', team: 'Phoenix', college: 'CCS', game: 'mlbb', platform: 'android' };
  assert.equal((await call('/rooms', { verifiedCheckIn: true }, 'student')).status, 403);
  const opened = await call('/rooms', { verifiedCheckIn: true, label: 'Player check-in' });
  assert.equal(opened.status, 201);
  const room = opened.body;
  const path = '/device/checkin/' + room.id;
  assert.equal(room.code, null);
  assert.deepEqual((await call(path, undefined, null)).body, { expiresAt: room.expiresAt });
  assert.equal((await call(path, details, null)).status, 401);
  assert.equal((await call(path, details, 'visitor')).status, 403);
  assert.equal((await call('/device/room', { code: currentRoomCode(store.room(room.id)!, store.now()).code }, null)).status, 404);
  const joined = await call(path, { ...details, email: 'someone-else@wmsu.edu.ph' }, 'student');
  assert.equal(joined.status, 201);
  const { beat, sessionId } = await scanPhone(joined.body.code);
  assert.equal(beat.scan.status, 'ready');
  assert.equal((await call('/device/pov/info', {}, joined.body.screenKey)).body.name, details.name);
  const current = (await call('/rooms/' + room.id)).body;
  assert.equal(current.passed, 1);
  assert.equal(current.players[0].sessionId, sessionId);
  assert.equal(current.players[0].email, 'student@wmsu.edu.ph');
  assert.equal(current.players[0].emailCheck, 'verified');
  assert.equal(current.players[0].gameLabel, 'Mobile Legends');
  await sleep(1550);
  assert.equal((await call(path, { ...details, name: 'Second name' }, 'student')).status, 409);
  await call('/rooms/' + room.id + '/close', {});
  assert.equal((await call(path, undefined, null)).status, 404);
  assert.equal((await call(path, details, 'other')).status, 404);
});

test('live screens: match-bound sharing keys, per-match facilitators, watch access and the referee pause', async t => {
  const calls: { kind: string; key: string; detail: unknown }[] = [];
  const screens: LiveScreens = {
    url: 'wss://live.example',
    publisherToken: async (key, player) => { calls.push({ kind: 'publish', key, detail: player }); return 'pub.' + key + '.' + player.sessionId; },
    viewerToken: async (key, staff) => { calls.push({ kind: 'view', key, detail: staff }); return 'view.' + key; },
    live: async () => ({ 'm-match': { publishers: 1, state: { paused: false } }, 'm-other': { publishers: 3, state: { paused: false } } }),
    setState: async (key, state) => { calls.push({ kind: 'state', key, detail: state }); return state; },
  };
  const { store, call, join } = await setup(t, screens);
  const room = (await call('/rooms', { matchId: 'match' })).body;
  assert.equal((await call('/screenwall/status', undefined, null)).status, 401);
  assert.equal((await call('/screenwall/status', undefined, 'student')).status, 403);
  // A facilitator sees nothing until assigned.
  assert.deepEqual((await call('/screenwall/status', undefined, 'ref')).body, { configured: true, liveError: '', manage: false, email: 'ref@wmsu.edu.ph', staff: {}, live: {}, scrims: [] });

  const entered = await join({ code: room.code, slot: 'p1', email: 'alpha.ace@wmsu.edu.ph', college: 'CAL', platform: 'android' });
  const key: string = entered.body.screenKey;
  assert.equal(key.split('.')[2], 'm-match', 'a room made for one match shares into that match');
  const info = (await call('/device/pov/info', {}, key)).body;
  assert.deepEqual([info.name, info.team, info.gameLabel, info.ready], ['alpha ace', 'ALPHA', 'Mobile Legends', true]);
  assert.equal((await call('/device/pov/info', {}, room.code)).status, 401);
  const parts = key.split('.');
  assert.equal((await call('/device/pov/token', {}, [parts[0], parts[1], 'm-other', parts[3]].join('.'))).status, 403, 'the key cannot be pointed at another match');
  const sessionId = store.room(room.id)!.joined.p1.sessionId;
  const access = (await call('/device/pov/token', {}, key)).body;
  assert.deepEqual(access, { url: 'wss://live.example', token: 'pub.m-match.' + sessionId, name: 'alpha ace', match: room.label });
  assert.deepEqual(calls.at(-1), { kind: 'publish', key: 'm-match', detail: { sessionId, name: 'alpha ace', team: 'ALPHA', platform: 'android', game: 'mlbb' } });
  assert.equal((await call('/device/pov/token', {}, key)).status, 429, 'one token a second per player');

  assert.equal((await call('/screenwall/m-match/watch', {}, 'ref')).status, 403);
  assert.equal((await call('/screenwall/m-match/pause', { paused: true }, 'ref')).status, 403);
  assert.equal((await call('/screenwall/m-match/staff', { emails: ['ref@wmsu.edu.ph'] }, 'ref')).status, 403, 'only organizers assign');
  assert.equal((await call('/screenwall/m-match/staff', { emails: ['ref@example.com'] })).status, 400, 'staff school emails only');
  assert.equal((await call('/screenwall/m-match/staff', { emails: ['a@wmsu.edu.ph', 'b@wmsu.edu.ph', 'c@wmsu.edu.ph', 'd@wmsu.edu.ph', 'e@wmsu.edu.ph'] })).status, 400);
  assert.equal((await call('/screenwall/bad%20key/watch', {}, 'staff')).status, 400);
  assert.deepEqual((await call('/screenwall/m-match/staff', { emails: [' Ref@wmsu.edu.ph ', 'ref@wmsu.edu.ph'] })).body, { emails: ['ref@wmsu.edu.ph'] });
  assert.deepEqual((await call('/screenwall/m-match/watch', {}, 'ref')).body, { url: 'wss://live.example', token: 'view.m-match', manage: false });
  assert.equal((await call('/screenwall/m-other/watch', {}, 'ref')).status, 403, 'only assigned matches');
  const status = (await call('/screenwall/status', undefined, 'ref')).body;
  assert.deepEqual(status.staff, { 'm-match': ['ref@wmsu.edu.ph'] });
  assert.deepEqual(Object.keys(status.live), ['m-match'], 'facilitators see only their own matches live');
  assert.equal(Object.keys((await call('/screenwall/status')).body.live).length, 2, 'organizers see every match');

  assert.deepEqual((await call('/screenwall/m-match/pause', { paused: true, note: 'Checking a screen' }, 'ref')).body, { paused: true, by: 'ref', at: store.now(), note: 'Checking a screen' });
  assert.deepEqual((await call('/screenwall/m-match/pause', { paused: false }, 'ref')).body, { paused: false });
  assert.deepEqual(calls.filter(c => c.kind === 'state').map(c => (c.detail as { paused: boolean }).paused), [true, false]);

  // Scrim rooms without a scheduled match are their own screen rooms.
  const scrim = (await call('/rooms', { label: 'Scrim night', game: 'mlbb' })).body;
  assert.deepEqual((await call('/screenwall/status')).body.scrims.map((r: { key: string; label: string }) => [r.key, r.label]), [['r-' + scrim.id, 'Scrim night']]);

  await call('/screenwall/m-match/staff', { emails: [] });
  assert.equal((await call('/screenwall/m-match/watch', {}, 'ref')).status, 403, 'removing the assignment ends access');
  await call('/rooms/' + room.id + '/reset', { slot: 'p1' });
  assert.equal((await call('/device/pov/token', {}, key)).status, 403, 'a reset slot cannot share');
  await call('/rooms/' + room.id + '/close', {});
  assert.equal((await call('/device/pov/info', {}, key)).status, 410);
});

test('signed-in check-in binds the screen to the match the player chose', async t => {
  const screens: LiveScreens = { url: 'wss://live.example', publisherToken: async key => key, viewerToken: async key => key, live: async () => ({}), setState: async (_key, state) => state };
  const { call } = await setup(t, screens);
  const room = (await call('/rooms', { verifiedCheckIn: true, label: 'Player check-in' })).body;
  const path = '/device/checkin/' + room.id;
  assert.equal((await call(path + '/matches?game=mlbb', undefined, null)).status, 401);
  assert.equal((await call(path + '/matches?game=chess', undefined, 'student')).status, 400);
  assert.deepEqual((await call(path + '/matches?game=mlbb', undefined, 'student')).body, [{ id: 'match', label: 'QF1 · ALPHA vs BRAVO', date: '', time: '', live: false }]);
  assert.deepEqual((await call(path + '/matches?game=dota2', undefined, 'student')).body, []);
  const details = { name: 'Student IGN', team: 'ALPHA', college: 'CCS', game: 'mlbb', platform: 'android' };
  assert.equal((await call(path, { ...details, matchId: 'not-a-match' }, 'student')).status, 409);
  await sleep(1550);
  const joined = await call(path, { ...details, matchId: 'match' }, 'student');
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  assert.equal(joined.body.screenKey.split('.')[2], 'm-match');
  assert.equal((await call('/device/pov/info', {}, joined.body.screenKey)).body.match, 'QF1 · ALPHA vs BRAVO');
  assert.equal((await call('/device/pov/token', {}, joined.body.screenKey)).body.token, 'm-match');
});

test('without LiveKit settings players are told live screens are off', async t => {
  const { call, join } = await setup(t, null);
  const room = (await call('/rooms', { matchId: 'match' })).body;
  const key = (await join({ code: room.code, slot: 'p1', email: 'alpha.ace@wmsu.edu.ph', college: 'CAL', platform: 'android' })).body.screenKey;
  assert.equal((await call('/device/pov/info', {}, key)).body.ready, false);
  assert.equal((await call('/device/pov/token', {}, key)).status, 503);
  assert.equal((await call('/screenwall/status')).body.configured, false);
  assert.equal((await call('/screenwall/m-match/watch', {})).status, 503);
});

test('LiveKit tokens: players publish only their screen and cannot watch; staff watch hidden and cannot publish', async () => {
  const secret = 'secret-that-is-long-enough-for-hs256';
  const screens = liveScreensFromEnv({ LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: secret })!;
  const verifier = new TokenVerifier('devkey', secret);
  const player = await verifier.verify(await screens.publisherToken('m-match', { sessionId: 's1', name: 'alpha ace', team: 'ALPHA', platform: 'android', game: 'mlbb' }));
  assert.equal(player.sub, 'p-s1');
  assert.equal(player.name, 'alpha ace');
  assert.deepEqual(player.attributes, { team: 'ALPHA', platform: 'android', game: 'mlbb' });
  assert.equal(player.video?.room, 'arenahub-m-match');
  assert.equal(player.video?.canSubscribe, false);
  assert.equal(player.video?.canPublishData, false);
  assert.deepEqual(player.video?.canPublishSources, ['screen_share']);
  const staff = await verifier.verify(await screens.viewerToken('m-match', { uid: 'uid-1', name: 'ref' }));
  assert.match(String(staff.sub), /^s-uid-1-/);
  assert.equal(staff.video?.canPublish, false);
  assert.equal(staff.video?.canSubscribe, true);
  assert.equal(staff.video?.hidden, true);
  assert.equal(liveScreensFromEnv({}), null);
  assert.throws(() => liveScreensFromEnv({ LIVEKIT_URL: 'https://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }));
  assert.deepEqual(parseState('{"paused":true,"by":"ref","note":"x"}'), { paused: true, by: 'ref', at: undefined, note: 'x' });
  assert.deepEqual(parseState('not json'), { paused: false });
});

test('the room code changes every 5 minutes and the previous one works for one more minute', () => {
  const room = { secret: 'fixture-secret' }, start = 1_000 * ROOM_WINDOW_MS;
  const first = currentRoomCode(room, start + 10);
  assert.match(first.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(first.changesAt, start + ROOM_WINDOW_MS);
  assert.equal(first.code, roomCodeAt(room.secret, 1000));
  const next = currentRoomCode(room, start + ROOM_WINDOW_MS + 1).code;
  assert.notEqual(next, first.code);
  assert.ok(roomCodeMatches(room, first.code.toLowerCase(), start + 60_000), 'typing in lower case still works');
  assert.ok(roomCodeMatches(room, `${first.code.slice(0, 3)} ${first.code.slice(3)}`, start + 60_000), 'a space in the middle still works');
  assert.ok(roomCodeMatches(room, first.code, start + ROOM_WINDOW_MS + ROOM_GRACE_MS - 1), 'grace period');
  assert.ok(!roomCodeMatches(room, first.code, start + ROOM_WINDOW_MS + ROOM_GRACE_MS), 'gone after the grace period');
  assert.ok(!roomCodeMatches({ secret: 'another room' }, first.code, start + 10));
});

test('the phone test room keeps one code and uses the normal phone check-in without personal details', async t => {
  const { call, join, tick } = await setup(t);
  const opened = await call('/rooms', { testRoom: true, label: 'Phone test', hours: 12 });
  assert.equal(opened.status, 201);
  const room = opened.body;
  assert.equal(room.testRoom, true);
  assert.equal(room.changesAt, room.expiresAt);
  tick(ROOM_WINDOW_MS * 2);
  assert.equal((await call(`/rooms/${room.id}`)).body.code, room.code);
  const lookup = await call('/device/room', { code: room.code }, null);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.testRoom, true);
  assert.deepEqual(lookup.body.games.map((game: { id: string }) => game.id).sort(), ['codm-br', 'codm-mp', 'dota2', 'mlbb']);
  const joined = await join({ code: room.code, name: 'iPhone QA', game: 'codm-mp', platform: 'ios' });
  assert.equal(joined.status, 201);
  const pairing = await call(`/device/pairing/${joined.body.code}`, undefined, null);
  assert.equal(pairing.body.playerName, 'iPhone QA');
  const view = (await call(`/rooms/${room.id}`)).body;
  assert.equal(view.players[0].email, '');
  assert.equal(view.players[0].college, '');
  assert.equal(view.passed, 0);
});

test('a player joins a match room with the code, registers, scans, and shows as passed', async t => {
  const { call, join, scanPhone } = await setup(t);
  assert.equal((await call('/rooms', { matchId: 'match' }, null)).status, 401);
  const opened = await call('/rooms', { matchId: 'match' });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const room = opened.body;
  assert.equal(room.label, 'QF1 - ALPHA vs BRAVO'); assert.equal(room.game, 'mlbb'); assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.equal(room.passed, 0); assert.equal(room.total, 2);
  assert.deepEqual(room.players.map((p: any) => p.result), ['not-registered', 'not-registered']);

  assert.equal((await call('/device/room', { code: 'WRONG1' }, null)).status, 404);
  const lookup = await call('/device/room', { code: room.code }, null);
  assert.equal(lookup.status, 200);
  assert.deepEqual(lookup.body.players.map((p: any) => [p.slot, p.name, p.college, p.taken]), [['p1', 'alpha ace', 'CAL', false], ['p2', 'bravo ace', 'CBR', false]]);
  const raw = JSON.stringify(lookup.body);
  for (const secret of ['emailHash', 'secret', 'playerKey', emailHash('alpha.ace@wmsu.edu.ph')]) assert.ok(!raw.includes(secret), `the join page never sees ${secret}`);

  // Wrong device for the game: a PC cannot be scanned for Mobile Legends.
  const onPc = await join({ code: room.code, slot: 'p1', email: 'alpha.ace@wmsu.edu.ph', college: 'CAL', platform: 'pc' });
  assert.equal(onPc.status, 409); assert.match(onPc.body.error, /phone you play on/);
  assert.equal((await join({ code: room.code, slot: 'p1', email: 'not-an-email', college: 'CAL', platform: 'android' })).status, 400);

  const joined = await join({ code: room.code, slot: 'p1', email: ' Alpha.Ace@WMSU.edu.ph ', college: 'College of Arts', platform: 'android' });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  assert.match(joined.body.code, /^[A-Z2-9]{8}$/);
  // The issued code is an ordinary single-use pairing code, so the existing apps work unchanged.
  const pairing = await call(`/device/pairing/${joined.body.code}`, undefined, null);
  assert.equal(pairing.body.playerName, 'alpha ace'); assert.equal(pairing.body.platform, 'any');
  const { beat } = await scanPhone(joined.body.code);
  assert.equal(beat.scan.status, 'ready');

  const view = (await call(`/rooms/${room.id}`)).body;
  assert.equal(view.passed, 1);
  const alpha = view.players[0];
  assert.equal(alpha.result, 'passed'); assert.equal(alpha.email, 'alpha.ace@wmsu.edu.ph'); assert.equal(alpha.emailCheck, 'match');
  assert.equal(alpha.college, 'College of Arts'); assert.equal(alpha.device, 'Pixel 8 Android 15'); assert.ok(alpha.passedAt > 0);
  assert.deepEqual(alpha.flags, []);
  assert.equal(view.players[1].result, 'not-registered');
  // The room's session counts toward match readiness like any roster scan.
  assert.equal((await call('/matches/match/readiness')).body.ready, 1);
});

test('one join per roster player until staff reset, and suspicious registrations are flagged', async t => {
  const { call, join, scanPhone } = await setup(t);
  const room = (await call('/rooms', { matchId: 'match' })).body;
  const first = await join({ code: room.code, slot: 'p1', email: 'alpha.ace@wmsu.edu.ph', college: 'CAL', platform: 'android' });
  assert.equal(first.status, 201);
  // Joining is in progress on the first phone: nobody else can take that player.
  const second = await join({ code: room.code, slot: 'p1', email: 'someone@else.com', college: 'CAL', platform: 'android' });
  assert.equal(second.status, 409); assert.match(second.body.error, /joining on another device/);
  await scanPhone(first.body.code);
  const third = await join({ code: room.code, slot: 'p1', email: 'someone@else.com', college: 'CAL', platform: 'ios' });
  assert.equal(third.status, 409); assert.match(third.body.error, /already joined/);
  assert.equal((await call('/device/room', { code: room.code }, null)).body.players[0].taken, true);

  // A different player registers with the first player's email, which also differs from their roster email.
  const bravo = await join({ code: room.code, slot: 'p2', email: 'alpha.ace@wmsu.edu.ph', college: 'CBR', platform: 'ios' });
  assert.equal(bravo.status, 201);
  let view = (await call(`/rooms/${room.id}`)).body;
  assert.equal(view.players[1].emailCheck, 'mismatch');
  assert.ok(view.players[1].flags.includes('Email does not match the school email on the roster'));
  assert.ok(view.players[1].flags.includes('Same email as alpha ace'));
  assert.ok(view.players[0].flags.includes('Same email as bravo ace'));

  // Staff reset the first player; the old session ends and the reset stays visible.
  assert.equal((await call(`/rooms/${room.id}/reset`, { slot: 'p1' }, null)).status, 401);
  view = (await call(`/rooms/${room.id}/reset`, { slot: 'p1' })).body;
  assert.equal(view.players[0].resets.length, 1); assert.equal(view.players[0].resets[0].by, 'staff-uid');
  assert.match(view.players[0].flags.join(' '), /Reset by staff once/);
  assert.equal((await join({ code: room.code, slot: 'p1', email: 'alpha.ace@wmsu.edu.ph', college: 'CAL', platform: 'android' })).status, 201);
});

test('typed names, scrim rooms where the player picks the game, and closing or expiring codes', async t => {
  const { call, join, tick } = await setup(t);
  const match = (await call('/rooms', { matchId: 'match' })).body;
  // A roster name must be picked from the list, so nobody can register as a listed player by typing.
  const typedRoster = await join({ code: match.code, name: 'Alpha  Ace', email: 'x@y.com', college: 'CAL', platform: 'android' });
  assert.equal(typedRoster.status, 400); assert.match(typedRoster.body.error, /Choose your name from the list/);
  const unlisted = await join({ code: match.code, name: 'Sub Player', team: 'ALPHA', email: 'sub@wmsu.edu.ph', college: 'CAL', platform: 'android' });
  assert.equal(unlisted.status, 201);
  let view = (await call(`/rooms/${match.id}`)).body;
  assert.equal(view.total, 3);
  assert.deepEqual(view.players[2].flags, ['Not on the published roster']);

  const scrim = (await call('/rooms', { label: 'Friday scrim' })).body;
  assert.equal(scrim.gameLabel, 'Player chooses');
  const lookup = (await call('/device/room', { code: scrim.code }, null)).body;
  assert.equal(lookup.typeName, true); assert.equal(lookup.games.length, 4);
  assert.equal((await join({ code: scrim.code, name: 'Solo', email: 'solo@x.com', college: 'CCS', platform: 'pc' })).status, 400, 'the game is required');
  const dota = await join({ code: scrim.code, name: 'Solo', email: 'solo@x.com', college: 'CCS', team: 'Pickup', game: 'dota2', platform: 'pc' });
  assert.equal(dota.status, 201);
  assert.equal((await call(`/device/pairing/${dota.body.code}`, undefined, null)).body.platform, 'pc');
  view = (await call(`/rooms/${scrim.id}`)).body;
  assert.deepEqual([view.players[0].name, view.players[0].team, view.players[0].flags], ['Solo', 'Pickup', []]);

  // A new room for the same match replaces the old code.
  const again = (await call('/rooms', { matchId: 'match' })).body;
  assert.equal((await call('/device/room', { code: match.code }, null)).status, 404);
  // Codes change every window; after the grace period the old one stops working.
  // The clock starts two grace periods into a window; move to 30 s after the code changes.
  tick(ROOM_WINDOW_MS - 2 * ROOM_GRACE_MS + 30_000);
  assert.equal((await call('/device/room', { code: again.code }, null)).status, 200, 'still inside the grace period');
  tick(ROOM_GRACE_MS);
  assert.equal((await call('/device/room', { code: again.code }, null)).status, 404);
  const fresh = (await call(`/rooms/${again.id}`)).body.code;
  assert.notEqual(fresh, again.code);
  assert.equal((await call(`/rooms/${again.id}/close`, {})).body.open, false);
  assert.equal((await call('/device/room', { code: fresh }, null)).status, 404);
  assert.equal((await call(`/rooms/${again.id}`)).body.code, null, 'a closed room shows no code');
});
