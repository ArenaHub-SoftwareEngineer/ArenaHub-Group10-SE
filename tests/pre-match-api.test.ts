import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createIntegrityRouter } from '../server/integrity';
import { IntegrityStore } from '../server/integrityStore';
import { AuthError } from '../server/staffAuth';
import { rosterPlayerKey } from '../src/lib/preMatchScan';
import { scanMatch } from '../server/scanAdmission';
import { createPlacementEvent } from '../src/lib/formats/placement';
import { fromDocs, toTournamentDoc, toRosterDoc } from '../src/lib/data/tournamentDocs';
import type { PublishedData } from '../server/data';
import type { MonitorGame } from '../src/lib/integrityRisk';
import { IOS_CLEARANCE_MS, IOS_INDICATOR_KEYS, IOS_INSPECTION_CHECKS } from '../src/lib/iosAntiCheat';

const signer = 'c'.repeat(64);
function fixture(game: MonitorGame = 'dota2'): PublishedData {
  const team = (id: string) => ({ id, name: id.toUpperCase(), players: [{ id: `${id}-p`, ign: `${id} ace`, name: 'Private name' }] });
  return { brackets: [{ id: 'tournament', gameId: `game-${game}`, matches: [{ id: 'match', matchNumber: 'QF1', status: 'upcoming', gameId: `game-${game}`, gameMode: game.startsWith('codm') ? game.slice(5) : undefined, team1: team('alpha'), team2: team('bravo') }] }], revision: '1', checkedAt: '' } as unknown as PublishedData;
}
async function setup(t: any, initial = fixture()) {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-pre-match-'));
  let now = Date.now(), data = initial;
  const store = new IntegrityStore(dir, () => now);
  const config = store.config(); config.android.games.mlbb.trustedCertSha256 = [signer]; config.android.games.codm.trustedCertSha256 = [signer]; store.saveConfig(config, 'fixture');
  const app = express(); app.use('/api/integrity', createIntegrityRouter({}, { store, published: async () => data, verifyStaff: async token => { if (token !== 'staff') throw new AuthError(token ? 403 : 401, 'Staff required'); return 'staff'; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); for (const file of await readdir(dir)) if (file.startsWith('integrity.db')) await unlink(join(dir, file)); await rmdir(join(dir, 'recordings')); await rmdir(dir); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity`;
  const call = (path: string, body?: unknown, token: string | null = 'staff') => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const observe = (id: string, over: Record<string, unknown> = {}) => {
    const row = store.session(id)!;
    const scan = { challenge: row.scan_challenge, policyVersion: store.policyVersion() };
    const facts = row.platform === 'pc' ? { platform: 'pc', processes: [], installedApplications: [], dota: { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] }, gameRunning: false, screenshotOk: false, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' }, scan, ...over }
      : { platform: 'android', games: [{ packageName: row.game === 'mlbb' ? 'com.mobile.legends' : 'com.activision.callofduty.shooter', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, certificates: true, overlays: false }, scan, ...over };
    store.heartbeat(row, facts, []); return facts;
  };
  const pair = (playerKey: string, game: MonitorGame = 'dota2', matchId = 'match') => {
    const created = store.createPairing({ matchId, matchLabel: 'Fixture', playerKey, rosterVersion: scanMatch(data, matchId).rosterVersion, game, platform: game === 'dota2' ? 'pc' : 'android', playerName: playerKey, expectedSteamId: '', record: false, hours: 1 }, 'staff');
    const claimed = store.claim(created.code, {})!;
    return { id: created.id, token: claimed.token };
  };
  return { store, call, pair, observe, tick: (ms: number) => { now += ms; }, setData: (value: PublishedData) => { data = value; } };
}

test('server admission requires every real roster player, not a supplied ready flag', async t => {
  const { call, pair, observe, tick } = await setup(t);
  assert.equal((await call('/matches/match/readiness', undefined, null)).status, 401);
  assert.equal((await call('/matches/match/admit', { ready: true, players: [] })).status, 409);
  const one = pair(rosterPlayerKey('alpha', 'alpha-p')); observe(one.id);
  let readiness = await (await call('/matches/match/readiness')).json() as any;
  assert.equal(readiness.total, 2); assert.equal(readiness.ready, 1);
  assert.equal((await call('/matches/match/admit', {})).status, 409);
  const two = pair(rosterPlayerKey('bravo', 'bravo-p')); observe(two.id);
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  tick(45_000);
  assert.equal((await call('/matches/match/admit', {})).status, 409);
});
test('claim and heartbeat carry the current scan challenge and return an actionable result', async t => {
  const { call, store } = await setup(t);
  const key = rosterPlayerKey('alpha', 'alpha-p');
  const input = { matchId: 'match', matchLabel: 'Test', game: 'dota2', playerName: 'Invented name', team: 'Invented team', playerKey: key, record: false, serverUrl: 'https://api.example.test' };
  assert.equal((await call('/pairings', { ...input, playerKey: 'unknown' })).status, 400);
  assert.equal((await call('/pairings', { ...input, game: 'mlbb' })).status, 400);
  const pair = await (await call('/pairings', input)).json() as any;
  assert.equal(store.session(pair.id)!.player_name, 'alpha ace');
  const claimed = await (await call('/device/claim', { code: pair.code }, null)).json() as any;
  assert.match(claimed.monitor.scan.challenge, /^[a-f0-9]{48}$/);
  assert.equal(claimed.monitor.scan.policyVersion, store.policyVersion());
  const report = await call('/device/heartbeat', { platform: 'pc', processes: [{ name: 'cheatengine.exe' }], installedApplications: [], dota: { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] }, gameRunning: false, screenshotOk: false, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' }, scan: claimed.monitor.scan }, claimed.token);
  assert.equal(report.status, 200); assert.equal((await report.json() as any).scan.status, 'blocked');
});
test('fixed findings clear on rescan; policy changes, old clients and a replacement session invalidate readiness', async t => {
  const { store, call, pair, observe } = await setup(t);
  const key = rosterPlayerKey('alpha', 'alpha-p'), first = pair(key);
  observe(first.id, { processes: [{ name: 'cheatengine.exe' }] });
  assert.equal(store.scan(store.session(first.id)!).status, 'blocked');
  observe(first.id); assert.equal(store.scan(store.session(first.id)!).status, 'ready');
  const policy = store.config(); policy.pc.blockedApplications!.push({ match: 'another test tool', label: 'Fixture', severity: 'high' }); store.saveConfig(policy, 'staff');
  assert.equal(store.scan(store.session(first.id)!).status, 'scanning');
  observe(first.id); assert.equal(store.scan(store.session(first.id)!).status, 'ready');
  observe(first.id, { scan: undefined }); assert.equal(store.scan(store.session(first.id)!).status, 'scanning');
  observe(first.id);
  // Same timestamp: a newer pairing must supersede the old pass deterministically.
  store.createPairing({ matchId: 'match', matchLabel: 'New device', game: 'dota2', platform: 'pc', playerName: 'Same player', playerKey: key, expectedSteamId: '', hours: 1 }, 'staff');
  const readiness = await (await call('/matches/match/readiness')).json() as any;
  assert.equal(readiness.players[0].scan.status, 'required');
});

test('missing Android signer evidence locks the whole match until the game is successfully reverified', async t => {
  const { call, pair, observe } = await setup(t, fixture('mlbb'));
  const first = pair(rosterPlayerKey('alpha', 'alpha-p'), 'mlbb'); observe(first.id);
  const second = pair(rosterPlayerKey('bravo', 'bravo-p'), 'mlbb');
  observe(second.id, { games: [{ packageName: 'com.mobile.legends', certSha256: [] }] });
  const rejected = await call('/matches/match/admit', {});
  assert.equal(rejected.status, 409);
  const { readiness } = await rejected.json() as any;
  assert.equal(readiness.ready, 1);
  assert.ok(readiness.players.some((player: any) => player.scan.label === 'Game certificate missing'));
  observe(second.id);
  assert.equal((await call('/matches/match/admit', {})).status, 200);
});
for (const game of ['mlbb', 'codm-br', 'codm-mp', 'dota2'] as MonitorGame[]) test(`${game}: all matching current scans admit the match and a changed roster is checked again`, async t => {
  const data = fixture(game), { call, pair, observe, setData } = await setup(t, data);
  for (const player of scanMatch(data, 'match').players) { const session = pair(player.playerKey, game); observe(session.id); }
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  const changed = structuredClone(data); changed.brackets[0].matches[0].team2!.players.push({ id: 'new-player', ign: 'Late addition', name: 'Late addition' } as any); setData(changed);
  const denied = await call('/matches/match/admit', {}); assert.equal(denied.status, 409);
  assert.equal((await denied.json() as any).readiness.total, 3);
});
test('a real CODM BR lobby requires every squad, including the last squad', async t => {
  const event = createPlacementEvent({ title: 'BR fixture', teams: [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }], games: 1, config: { pointsTable: [10, 6, 5], killPoints: 1 }, now: Date.now() });
  event.rosterTeams = fromDocs(toTournamentDoc(event, 1)).rosterTeams!.map((team, i) => ({ ...team, players: Array.from({ length: 4 }, (_, j) => ({ id: `p-${i}-${j}`, ign: `Ace ${i}-${j}`, name: 'Ace', role: 'Player', isVerified: true, collegeId: '' })) }));
  const data: PublishedData = { brackets: [fromDocs(toTournamentDoc(event, 1), toRosterDoc(event))], revision: '1', checkedAt: '' };
  const id = event.placement!.games[0].id, { call, pair, observe } = await setup(t, data);
  const sessions = scanMatch(data, id).players.map(player => pair(player.playerKey, 'codm-br', id));
  for (const session of sessions) observe(session.id);
  assert.equal((await call(`/matches/${id}/admit`, {})).status, 200);
  observe(sessions[11].id, { installedFlagged: ['com.gameguardian.fixture'] });
  const denied = await call(`/matches/${id}/admit`, {}); assert.equal(denied.status, 409);
  const readiness = (await denied.json() as any).readiness;
  assert.equal(readiness.total, 12); assert.equal(readiness.ready, 11);
});

test('a replacement player reusing a roster slot cannot inherit the earlier scan', async t => {
  const data = fixture(), { call, pair, observe, setData } = await setup(t, data);
  for (const player of scanMatch(data, 'match').players) { const session = pair(player.playerKey); observe(session.id); }
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  const changed = structuredClone(data); changed.brackets[0].matches[0].team1!.players[0].ign = 'Replacement player'; setData(changed);
  const denied = await call('/matches/match/admit', { ready: true });
  assert.equal(denied.status, 409);
  const readiness = (await denied.json() as any).readiness;
  assert.equal(readiness.ready, 0); assert.equal(readiness.players[0].scan.label, 'Roster changed: rescan');
});

const iosApproval = { approved: true, checks: Object.fromEntries(Object.keys(IOS_INSPECTION_CHECKS).map(key => [key, true])), indicators: Object.fromEntries(IOS_INDICATOR_KEYS.map(key => [key, 'clear'])), note: 'Physical iPhone and roster account checked. Referee A supervising with observer recording on event laptop.' };
async function pairIphone(call: Awaited<ReturnType<typeof setup>>['call'], playerKey: string, game: MonitorGame = 'mlbb') {
  const response = await call('/pairings', { matchId: 'match', matchLabel: 'iPhone fixture', game, playerKey, playerName: 'ignored', platform: 'ios', record: false, serverUrl: 'https://api.example.test' });
  assert.equal(response.status, 201);
  return await response.json() as { id: string; code: string };
}

for (const game of ['mlbb', 'codm-br', 'codm-mp'] as MonitorGame[]) test(`${game}: mixed iPhone and Android admission clears on check-in, a referee check is optional and only a problem blocks`, async t => {
  const { call, pair, observe, store, tick } = await setup(t, fixture(game));
  const android = pair(rosterPlayerKey('bravo', 'bravo-p'), game); observe(android.id);
  const iphone = await pairIphone(call, rosterPlayerKey('alpha', 'alpha-p'), game);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 409);
  const claimed = store.claim(iphone.code, { model: 'iPhone' })!;
  // The player's own confirmation at check-in is enough; no referee is needed.
  assert.equal(store.scan(store.session(iphone.id)!).label, 'iPhone checked in');
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval, null)).status, 401);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval, claimed.token)).status, 403);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, { ...iosApproval, checks: { ...iosApproval.checks, supervision: false } })).status, 400);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, { ...iosApproval, checks: {} })).status, 400);
  const approved = await call(`/sessions/${iphone.id}/ios-review`, iosApproval);
  assert.equal(approved.status, 200);
  const detail = await approved.json() as any;
  assert.equal(detail.scan.status, 'ready'); assert.equal(detail.scan.label, 'iPhone supervised clearance');
  assert.equal(detail.scan.validUntil, store.now() + IOS_CLEARANCE_MS);
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  const lastSeen = store.session(iphone.id)!.last_seen;
  const status = await (await call('/device/status', undefined, claimed.token)).json() as any;
  assert.equal(status.scan.status, 'ready'); assert.equal(status.record, false);
  assert.equal(store.session(iphone.id)!.last_seen, lastSeen);
  assert.equal(store.auditFor(iphone.id).filter((row: any) => row.action === 'ios-inspection-approved').length, 1);
  // An expired referee check falls back to the player's confirmation instead of blocking.
  tick(IOS_CLEARANCE_MS); observe(android.id);
  assert.equal(store.scan(store.session(iphone.id)!).label, 'iPhone checked in');
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 200);
  assert.equal((await call('/matches/match/admit', {})).status, 200);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, { approved: false, note: 'Player changed device and referee supervision stopped.' })).status, 200);
  assert.equal((await call('/matches/match/admit', {})).status, 409);
  assert.equal(store.scan(store.session(iphone.id)!).status, 'blocked');
});

test('iPhone clearance is invalidated by policy, roster, device stop and a newer pairing', async t => {
  const data = fixture('mlbb'), { call, store, setData } = await setup(t, data);
  const key = rosterPlayerKey('alpha', 'alpha-p'), iphone = await pairIphone(call, key);
  const claimed = store.claim(iphone.code, {})!;
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 200);
  const policy = store.config(); policy.android.blockedPackages.push({ match: 'test.fixture', label: 'Fixture', severity: 'high' }); store.saveConfig(policy, 'staff');
  assert.equal(store.scan(store.session(iphone.id)!).label, 'iPhone checked in');
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 200);
  const changed = structuredClone(data); changed.brackets[0].matches[0].team1!.players[0].ign = 'Replacement'; setData(changed);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 409);
  assert.equal((await (await call('/matches/match/readiness')).json() as any).ready, 0);
  setData(data);
  await pairIphone(call, key);
  assert.equal((await (await call('/matches/match/readiness')).json() as any).players[0].scan.status, 'required');
  assert.equal((await call('/device/stop', {}, claimed.token)).status, 200);
  assert.equal((await call(`/sessions/${iphone.id}/ios-review`, iosApproval)).status, 409);
  assert.equal((await call('/device/status', undefined, claimed.token)).status, 410);
});

test('iPhone approval cannot be applied to Windows and client supplied clearance cannot grant readiness', async t => {
  const { call, pair, store } = await setup(t);
  const pc = pair(rosterPlayerKey('alpha', 'alpha-p'));
  assert.equal((await call(`/sessions/${pc.id}/ios-review`, iosApproval)).status, 409);
  assert.equal((await call('/device/status', undefined, null)).status, 410);
  assert.equal((await call('/matches/match/admit', { approved: true, iosClearance: iosApproval })).status, 409);
  assert.equal(store.scan(store.session(pc.id)!).status, 'scanning');
});
