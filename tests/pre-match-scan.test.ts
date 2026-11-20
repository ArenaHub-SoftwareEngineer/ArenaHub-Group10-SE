import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MONITOR_CONFIG } from '../src/lib/integrityRisk';
import { preMatchScan, SCAN_FRESH_MS } from '../src/lib/preMatchScan';
import { scanMatch } from '../server/scanAdmission';
import { createPlacementEvent } from '../src/lib/formats/placement';
import { fromDocs, toRosterDoc, toTournamentDoc } from '../src/lib/data/tournamentDocs';

const now = 1_800_000_000_000, challenge = 'a'.repeat(48), policyVersion = 'b'.repeat(64);
const stamp = { challenge, policyVersion };
const config = () => structuredClone(DEFAULT_MONITOR_CONFIG);
const pc = (over: Record<string, unknown> = {}) => ({ platform: 'pc', processes: [], installedApplications: [], dota: { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] }, gameRunning: false, screenshotOk: false, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' }, scan: stamp, ...over });
const input = (over: Record<string, unknown> = {}) => ({ platform: 'pc' as const, game: 'dota2' as const, status: 'active', lastSeen: now, expiresAt: now + 3600_000, facts: pc(), challenge, policyVersion, config: config(), now, ...over });

test('pairing and check-in alone never clear a required scan', () => {
  assert.equal(preMatchScan(input({ status: 'pending', facts: null })).status, 'required');
  assert.equal(preMatchScan(input({ facts: null })).status, 'scanning');
  assert.equal(preMatchScan(input({ platform: 'ios', game: 'mlbb' })).status, 'required');
});
test('a basic PC scan passes before the game launches and does not require screenshots', () => {
  const result = preMatchScan(input());
  assert.equal(result.status, 'ready'); assert.equal(result.validUntil, now + SCAN_FRESH_MS);
});
test('registered restricted software blocks admission even when it is not running', () => {
  const result = preMatchScan(input({ facts: pc({ installedApplications: [{ name: 'Cheat Engine 7.5' }] }) }));
  assert.equal(result.status, 'blocked'); assert.match(result.blockers[0], /execution not established/);
});
test('current observations can clear a resolved tool without rewriting historical evidence', () => {
  assert.equal(preMatchScan(input({ facts: pc({ processes: [{ name: 'cheatengine.exe' }] }) })).status, 'blocked');
  assert.equal(preMatchScan(input({ facts: pc() })).status, 'ready');
});
test('missing essential checks fail closed, including configured hashes', () => {
  for (const check of ['processes', 'installedApplications']) assert.equal(preMatchScan(input({ facts: pc({ checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', [check]: 'failed' } }) })).status, 'incomplete');
  const c = config(); c.pc.blockedFileHashes = [{ sha256: 'c'.repeat(64), label: 'Harmless fixture', severity: 'high' }];
  assert.equal(preMatchScan(input({ config: c, facts: pc({ checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'partial', dotaFiles: 'complete', fileSweep: 'complete' } }) })).status, 'incomplete');
});
test('old clients, another session challenge and outdated policy cannot claim readiness', () => {
  for (const scan of [undefined, { ...stamp, challenge: 'c'.repeat(48) }, { ...stamp, policyVersion: 'd'.repeat(64) }]) assert.equal(preMatchScan(input({ facts: pc({ scan }) })).status, 'scanning');
});
test('stopped, expired, declined and stale scans cannot admit a player', () => {
  assert.equal(preMatchScan(input({ status: 'ended' })).status, 'ended');
  assert.equal(preMatchScan(input({ expiresAt: now })).status, 'ended');
  assert.equal(preMatchScan(input({ status: 'declined' })).status, 'declined');
  assert.equal(preMatchScan(input({ lastSeen: now - SCAN_FRESH_MS })).status, 'stale');
});
test('Android requires configured regional game trust and complete installed-app inspection', () => {
  const c = config(), signer = 'c'.repeat(64);
  const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, overlays: false, certificates: true }, scan: stamp };
  const base = input({ platform: 'android', game: 'mlbb', facts, config: c });
  assert.equal(preMatchScan(base).status, 'incomplete');
  c.android.games.mlbb.trustedCertSha256 = [signer];
  assert.equal(preMatchScan(base).status, 'ready');
  assert.ok(preMatchScan(base).warnings.some(warning => /Overlay inspection/.test(warning)));
  assert.equal(preMatchScan({ ...base, facts: { ...facts, checks: { ...facts.checks, installedApps: false } } }).status, 'incomplete');
  assert.equal(preMatchScan({ ...base, facts: { ...facts, games: [{ ...facts.games[0], certSha256: ['d'.repeat(64)] }] } }).status, 'blocked');
});
test('dual-use low severity installed tools do not silently become cheating verdicts', () => {
  const result = preMatchScan(input({ facts: pc({ installedApplications: [{ name: 'AutoHotkey v2' }] }) }));
  assert.equal(result.status, 'ready');
});

test('running Dota requires complete configured module inspection and restricted libraries block admission', () => {
  const running = pc({ gameRunning: true });
  assert.equal(preMatchScan(input({ facts: running })).status, 'incomplete');
  const checked = { ...running, checks: { ...running.checks, modules: 'complete' } };
  assert.equal(preMatchScan(input({ facts: checked })).status, 'ready');
  assert.equal(preMatchScan(input({ facts: { ...checked, loadedModules: [{ name: 'speedhack-x86_64.dll', process: 'dota2.exe' }] } })).status, 'blocked');
  assert.equal(preMatchScan(input({ facts: { ...checked, checks: { ...checked.checks, modules: 'not-running' } } })).status, 'incomplete');
});

test('an Android game without a certificate cannot pass by claiming signature coverage', () => {
  const c = config(); c.android.games.mlbb.trustedCertSha256 = ['c'.repeat(64)];
  const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [] }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, overlays: true, certificates: true }, scan: stamp };
  const result = preMatchScan(input({ game: 'mlbb', platform: 'android', config: c, facts }));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.label, 'Game certificate missing');
});
test('device-state indicators are visible warnings and do not invent a restricted-software match', () => {
  const c = config(), signer = 'c'.repeat(64);
  c.android.games.mlbb.trustedCertSha256 = [signer];
  const facts = { platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: ['test-keys'], emulatorIndicators: ['emulator build'], accessibilityServices: [], overlayPackages: [], developerOptions: true, usbDebugging: true, recording: false, checks: { installedApps: true, gameSignatures: true, overlays: true, certificates: true }, scan: stamp };
  const result = preMatchScan(input({ platform: 'android', game: 'mlbb', facts, config: c }));
  assert.equal(result.status, 'ready');
  assert.ok(result.warnings.some(warning => warning.includes('test-keys')));
  assert.ok(result.warnings.some(warning => warning.includes('debugging')));
});
test('Battle Royale public rosters survive storage hydration and include every squad in scanning', () => {
  const event = createPlacementEvent({ title: 'BR scan fixture', teams: [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }], games: 1, config: { pointsTable: [10, 6, 5], killPoints: 1 }, now });
  const empty = fromDocs(toTournamentDoc(event, 1));
  assert.equal(empty.rosterTeams!.length, 3);
  event.rosterTeams = empty.rosterTeams!.map((team, i) => ({ ...team, players: Array.from({ length: 4 }, (_, j) => ({ id: `p-${i}-${j}`, ign: `Player ${i}-${j}`, name: 'Private name', role: 'Player', isVerified: true, collegeId: '' })) }));
  const roster = toRosterDoc(event);
  assert.equal(roster.teams.length, 3);
  assert.ok(!JSON.stringify(roster).includes('Private name'));
  const hydrated = fromDocs(toTournamentDoc(event, 1), roster);
  const resolved = scanMatch({ brackets: [hydrated], revision: '1', checkedAt: '' }, event.placement!.games[0].id);
  assert.equal(resolved.game, 'codm-br'); assert.equal(resolved.players.length, 12);
  assert.throws(() => scanMatch({ brackets: [empty], revision: '1', checkedAt: '' }, event.placement!.games[0].id), /named players/);
});

test('practice verdict uses the official rules but never clears anyone', async () => {
  const { practiceVerdict } = await import('../src/lib/practiceScan');
  const { scan: _, ...unstamped } = pc();
  const clean = practiceVerdict('dota2', unstamped, config(), now);
  assert.equal(clean.status, 'ready'); assert.equal(clean.label, 'No cheats found'); assert.equal(clean.validUntil, null);
  const sha = 'd'.repeat(64);
  const found = practiceVerdict('dota2', { ...unstamped, fileFindings: [{ name: 'loader.exe', folder: 'Downloads', reason: 'Unsigned program that targets dota2.exe', sha256: sha, severity: 'high' }] }, config(), now);
  assert.equal(found.status, 'blocked');
  assert.deepEqual(found.blockers, ['Downloads: loader.exe - Unsigned program that targets dota2.exe'], 'players see the file and reason, not the fingerprint');
});
