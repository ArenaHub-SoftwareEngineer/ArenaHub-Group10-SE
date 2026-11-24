// The hosted match monitor (FirestoreIntegrityStore) against the Firestore emulator, through the real router.
// Run inside the emulator (npm run test:emulators). It is skipped when FIRESTORE_EMULATOR_HOST is not set.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createIntegrityRouter } from '../server/integrity';
import { FirestoreIntegrityStore, HOSTED_HEARTBEAT_SECONDS } from '../server/firestoreIntegrityStore';
import { ROOM_GRACE_MS, ROOM_WINDOW_MS, emailHash } from '../server/monitorStore';
import type { PublishedData } from '../server/data';

const skip = !process.env.FIRESTORE_EMULATOR_HOST && 'needs the Firestore emulator (npm run test:emulators)';
const signer = 'c'.repeat(64);
const fixture = () => ({ brackets: [{ id: 'tournament', gameId: 'game-mlbb', matches: [{ id: 'match', matchNumber: 'QF1', status: 'upcoming', gameId: 'game-mlbb',
  team1: { id: 'alpha', name: 'ALPHA', collegeCode: 'CAL', players: [{ id: 'alpha-p', ign: 'alpha ace' }] }, team2: { id: 'bravo', name: 'BRAVO', collegeCode: 'CBR', players: [{ id: 'bravo-p', ign: 'bravo ace' }] } }] }], revision: '1', checkedAt: '' }) as unknown as PublishedData;

async function setup(t: any) {
  const db = getFirestore(initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-arenahub' }, `monitor-${Math.random()}`));
  // Each run gets its own collections' worth of data by clearing them first.
  for (const name of ['monitorSessions', 'monitorRooms', 'monitorAudit', 'monitorSettings']) for (const doc of (await db.collection(name).get()).docs) await doc.ref.delete();
  let now = Math.floor(Date.now() / ROOM_WINDOW_MS) * ROOM_WINDOW_MS + 2 * ROOM_GRACE_MS;
  const store = new FirestoreIntegrityStore(db, () => now);
  const config = await store.config(); config.android.games.mlbb.trustedCertSha256 = [signer]; await store.saveConfig(config, 'fixture');
  const app = express();
  app.use('/api/integrity', createIntegrityRouter({}, { store, published: async () => fixture(), verifyStaff: async () => 'staff-uid',
    rosterEmails: async () => new Map([['alpha', new Map([['alpha ace', emailHash('alpha@wmsu.edu.ph')]])]]) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await db.terminate(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity`;
  const call = async (path: string, body?: unknown, token = 'staff') => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  return { db, store, call, tick: (ms: number) => { now += ms; } };
}

test('hosted monitor: room join, claim, heartbeat, pass, reset and the staff list, all in Firestore', { skip }, async t => {
  const { db, store, call, tick } = await setup(t);
  const info = (await call('/server-info')).body;
  assert.equal(info.recordings, false);
  const room = (await call('/rooms', { matchId: 'match', record: true })).body;
  assert.equal(room.record, false, 'no recordings on the hosted server');
  const secret = (await db.collection('monitorRooms').doc(room.id).get()).get('secret');
  assert.ok(secret && !JSON.stringify(room).includes(secret), 'the room secret stays in Firestore');

  const joined = await call('/device/room/join', { code: room.code, slot: 'p1', email: 'alpha@wmsu.edu.ph', college: 'CAL', platform: 'android' });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  await sleep(1600);
  assert.equal((await call('/device/room/join', { code: room.code, slot: 'p1', email: 'x@y.com', college: 'CAL', platform: 'android' })).status, 409);

  const claimed = await call('/device/claim', { code: joined.body.code, device: { model: 'Pixel 8', os: 'Android 15', agent: 'android 3.3' } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.heartbeatSeconds, HOSTED_HEARTBEAT_SECONDS);
  await sleep(1600);
  assert.equal((await call('/device/claim', { code: joined.body.code, device: { agent: 'android' } })).status, 404, 'single use');
  const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, certificates: true, overlays: false }, scan: claimed.body.monitor.scan };
  const beat = await call('/device/heartbeat', facts, claimed.body.token);
  assert.equal(beat.status, 200, JSON.stringify(beat.body)); assert.equal(beat.body.scan.status, 'ready');
  assert.equal((await call('/device/media', {}, claimed.body.token)).status, 403, 'uploads are refused');

  await sleep(1600);
  let view = (await call(`/rooms/${room.id}`)).body;
  assert.equal(view.passed, 1); assert.equal(view.players[0].result, 'passed'); assert.equal(view.players[0].emailCheck, 'match'); assert.ok(view.players[0].passedAt);
  assert.equal((await call('/matches/match/readiness')).body.ready, 1);

  // A flagged report adds a signal by field update; a second identical report only counts it.
  const rooted = { ...facts, rootIndicators: ['su binary'] };
  tick(10_000); await sleep(4100);
  await call('/device/heartbeat', rooted, claimed.body.token);
  tick(10_000); await sleep(4100);
  await call('/device/heartbeat', rooted, claimed.body.token);
  const detail = (await call(`/sessions/${claimed.body.sessionId}`)).body;
  const root = detail.signals.find((s: any) => s.evidence.includes('su binary'));
  assert.ok(root, JSON.stringify(detail.signals)); assert.equal(root.count, 2);
  assert.ok(detail.audit.some((a: any) => a.action === 'device-paired'));
  // The list stays in sync from changed documents only.
  await sleep(1600);
  const listed = (await call('/sessions?matchId=match')).body;
  assert.equal(listed.length, 1); assert.equal(listed[0].email, 'alpha@wmsu.edu.ph');

  view = (await call(`/rooms/${room.id}/reset`, { slot: 'p1' })).body;
  assert.equal(view.players[0].resets.length, 1);
  assert.equal((await call('/device/heartbeat', facts, claimed.body.token)).status, 410, 'the reset session can no longer report');
  assert.equal((await store.session(claimed.body.sessionId))!.status, 'ended');
});

test('hosted monitor: decline, staff codes, Dota telemetry and expiry', { skip }, async t => {
  const { call, tick } = await setup(t);
  const made = (await call('/pairings', { matchId: 'scrim', matchLabel: 'Scrim', game: 'dota2', playerName: 'Solo', serverUrl: 'https://arenahub.example' })).body;
  assert.equal(made.platform, 'pc');
  assert.equal((await call(`/device/pairing/${made.code}`)).body.folderCheck !== undefined, true);
  const pc = await call('/device/claim', { code: made.code, device: { agent: 'pc-agent 3.3' } });
  assert.equal(pc.status, 200); assert.ok(pc.body.gsiToken);
  const gsi = { auth: { token: pc.body.gsiToken }, provider: { appid: 570 }, map: { matchid: '123' }, player: { steamid: '76561198000000000' } };
  // Telemetry with a device token is refused; with the GSI token it is accepted.
  assert.equal((await call('/dota/gsi', { ...gsi, auth: { token: pc.body.token } })).status, 410);
  assert.equal((await call('/dota/gsi', gsi)).status, 200);

  const declined = (await call('/pairings', { matchId: 'scrim', matchLabel: 'Scrim', game: 'mlbb', platform: 'any', playerName: 'No', serverUrl: 'https://arenahub.example' })).body;
  await sleep(1600);
  assert.equal((await call('/device/decline', { code: declined.code })).status, 200);
  const sessions = (await call('/sessions?matchId=scrim')).body;
  assert.deepEqual(sessions.map((s: any) => s.connection).sort(), ['declined', 'online']);

  tick(5 * 3600_000);
  assert.equal((await call('/sessions?matchId=scrim')).body.find((s: any) => s.playerName === 'Solo').status, 'ended', 'the match window closed');
});
