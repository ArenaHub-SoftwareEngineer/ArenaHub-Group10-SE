import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWindowsScanner, executableHash, listedApplications, parseInventory } from '../tools/integrity-agent/windowsScan';
import { DEFAULT_MONITOR_CONFIG, evaluateFacts, inspectionCoverage, monitorConfigSchema, pcFactsSchema, type PcFacts } from '../src/lib/integrityRisk';
import { monitorAddress } from '../src/lib/monitorAddress';
import { groupScanSessions, latestScanSessions, type ScanChartSession } from '../src/lib/monitorScanCounts';
import { gsiConfig } from '../tools/integrity-agent/agentCore';

test('scan chart counts recent players by game and team without counting retries twice', () => {
  const session: ScanChartSession = {
    id: 'first', matchId: 'match-1', matchLabel: 'Round 1', playerKey: 'player-1', playerName: 'Ace',
    team: 'Phoenix', game: 'mlbb', gameLabel: 'Mobile Legends', platform: 'android', createdAt: 1,
  };
  const players = latestScanSessions([
    session,
    { ...session, id: 'retry', createdAt: 2, inspection: { status: 'limited' } },
    { ...session, id: 'phone', playerKey: 'player-2', platform: 'ios', iosClearance: { reviewedAt: 2 } },
    { ...session, id: 'pending', playerKey: 'player-3', platform: 'ios', inspection: { status: 'reported' }, team: 'Titans' },
    { ...session, id: 'other-match', matchId: 'match-2', platform: 'pc', passedAt: 2 },
    { ...session, id: 'other-game', game: 'dota2', gameLabel: 'Dota 2', platform: 'pc' },
  ]);
  assert.deepEqual(players.map(player => player.id), ['retry', 'phone', 'pending', 'other-match', 'other-game']);
  assert.deepEqual(groupScanSessions(players, false).map(group => [group.label, group.counts]), [
    ['Dota 2', { scanned: 0, inspected: 0, awaiting: 1 }],
    ['Mobile Legends', { scanned: 2, inspected: 1, awaiting: 1 }],
  ]);
  assert.deepEqual(groupScanSessions(players.filter(player => player.game === 'mlbb' && player.matchId === 'match-1'), true)
    .map(group => [group.label, group.counts]), [
    ['Phoenix', { scanned: 1, inspected: 1, awaiting: 0 }],
    ['Titans', { scanned: 0, inspected: 0, awaiting: 1 }],
  ]);
});

test('installed software is distinct from execution and unrelated inventory never leaves the scanner', async () => {
  const scanner = createWindowsScanner({ processes: async () => [{ name: 'dota2.exe', pid: 10 }, { name: 'personal-tool.exe', pid: 11 }], applications: async () => [{ name: 'Private mail client' }, { name: 'Cheat Engine 7.5', version: '7.5' }], hash: async () => { throw new Error('Hashing must be opt-in.'); } });
  const facts = await scanner({ blockedProcesses: ['cheatengine*'], blockedApplications: ['cheat engine*'], blockedFileHashes: [] });
  assert.deepEqual(facts.processes, []);
  assert.deepEqual(facts.installedApplications, [{ name: 'Cheat Engine 7.5', version: '7.5' }]);
  assert.equal(facts.checks.fileHashes, 'not-configured');
  const signals = evaluateFacts({ ...facts, platform: 'pc', screenshotOk: true }, DEFAULT_MONITOR_CONFIG, 'dota2');
  assert.deepEqual(signals.map(s => s.id), ['blocked-application-installed']);
  assert.match(signals[0].evidence, /execution not established/);
  assert.ok(!JSON.stringify(facts).includes('Private mail'));
});

test('a renamed executable is matched by its real bytes and rechecked after file changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-hash-'));
  const path = join(dir, 'ordinary-name.exe');
  t.after(async () => { await unlink(path); await rmdir(dir); });
  await writeFile(path, 'harmless detection fixture');
  const sha256 = await executableHash(path);
  assert.equal(sha256, createHash('sha256').update('harmless detection fixture').digest('hex'));
  const scanner = createWindowsScanner({ processes: async () => [{ name: 'ordinary-name.exe', pid: 10, path }], applications: async () => [], hash: executableHash });
  const policy = { blockedProcesses: [], blockedApplications: [], blockedFileHashes: [sha256] };
  const observed = await scanner(policy);
  assert.equal(observed.processes[0].sha256, sha256);
  const config = structuredClone(DEFAULT_MONITOR_CONFIG);
  config.pc.blockedFileHashes = [{ sha256, label: 'Harmless test fixture', severity: 'high' }];
  const signals = evaluateFacts({ ...observed, platform: 'pc', screenshotOk: true }, config, 'dota2', { recordingRequired: false });
  assert.ok(signals.some(s => s.id === 'blocked-file-hash'));
  await writeFile(path, 'a different harmless file with different bytes');
  assert.deepEqual((await scanner(policy)).processes, []);
});

test('collector failures remain visible and unknown hashes cannot manufacture findings', async () => {
  const scanner = createWindowsScanner({ processes: async () => { throw new Error('Access denied'); }, applications: async () => { throw new Error('Registry unavailable'); }, hash: executableHash });
  const result = await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [] });
  assert.equal(result.checks.processes, 'failed');
  assert.equal(result.checks.installedApplications, 'failed');
  assert.equal(inspectionCoverage('pc', result).status, 'limited');
  const signals = evaluateFacts({ ...result, platform: 'pc', screenshotOk: true }, DEFAULT_MONITOR_CONFIG, 'dota2');
  assert.ok(signals.some(signal => signal.id === 'checks-incomplete'));
  assert.equal(evaluateFacts({ platform: 'pc', processes: [{ name: 'normal.exe', sha256: 'a'.repeat(64) }], gameRunning: true, screenshotOk: true }, DEFAULT_MONITOR_CONFIG, 'dota2').length, 0);
});

test('installed-name parsing handles single records, de-duplicates and does not match substrings', () => {
  assert.deepEqual(parseInventory('{"name":"Cheat Engine 7.5"}', row => typeof row.name === 'string' ? { name: row.name } : null), [{ name: 'Cheat Engine 7.5' }]);
  assert.deepEqual(listedApplications([{ name: 'Cheat Engine 7.5' }, { name: 'cheat engine 7.5' }, { name: 'My Cheat Engine notes' }], ['cheat engine*']), [{ name: 'Cheat Engine 7.5' }]);
  assert.throws(() => parseInventory('invalid JSON', () => null));
});

test('new blocklists migrate old configurations and reject malformed fingerprints', () => {
  const old = structuredClone(DEFAULT_MONITOR_CONFIG);
  delete old.pc.blockedApplications; delete old.pc.blockedFileHashes; delete old.pc.blockedModules; delete old.android.blockedCertificates;
  const migrated = monitorConfigSchema.parse(old);
  assert.ok(migrated.pc.blockedApplications.length > 0);
  assert.deepEqual(migrated.pc.blockedFileHashes, []);
  assert.ok(migrated.pc.blockedModules.some(entry => entry.match === 'speedhack-x86_64.dll'));
  assert.deepEqual(migrated.android.blockedCertificates, []);
  assert.equal(monitorConfigSchema.safeParse({ ...old, pc: { ...old.pc, blockedFileHashes: [{ sha256: '../file', label: 'Bad', severity: 'high' }] } }).success, false);
  assert.equal(pcFactsSchema.safeParse({ platform: 'pc', processes: [{ name: 'x', sha256: 'invalid' }], gameRunning: true, screenshotOk: true }).success, false);
});

test('game module checks report configured matches while full paths and unrelated libraries stay local', async () => {
  const scanner = createWindowsScanner({
    processes: async () => [{ name: 'dota2.exe', pid: 10 }], applications: async () => [], hash: executableHash,
    modules: async () => ({ failed: 0, modules: [{ name: 'speedhack-x86_64.dll', path: 'C:/private/path/speedhack-x86_64.dll' }, { name: 'ordinary-library.dll', path: 'C:/private/path/ordinary-library.dll' }] }),
  });
  const observation = await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [], blockedModules: ['speedhack-x86_64.dll'] });
  assert.equal(observation.checks.modules, 'complete');
  assert.deepEqual(observation.loadedModules, [{ name: 'speedhack-x86_64.dll', process: 'dota2.exe' }]);
  assert.ok(!JSON.stringify(observation).includes('private/path'));
  assert.ok(!JSON.stringify(observation).includes('ordinary-library'));
  assert.ok(evaluateFacts({ ...observation, platform: 'pc', screenshotOk: true }, DEFAULT_MONITOR_CONFIG, 'dota2').some(signal => signal.id === 'blocked-module'));
});

test('inaccessible game modules and truncated installed-software matches retain incomplete coverage', async () => {
  let running = true, moduleCalls = 0;
  const scanner = createWindowsScanner({
    processes: async () => running ? [{ name: 'dota2.exe', pid: 10 }] : [],
    applications: async () => Array.from({ length: 101 }, (_, i) => ({ name: `Fixture Tool ${i}` })), hash: executableHash,
    modules: async () => { moduleCalls++; throw new Error('Access denied'); },
  });
  const policy = { blockedProcesses: [], blockedApplications: ['fixture tool*'], blockedFileHashes: [], blockedModules: ['restricted.dll'] };
  const active = await scanner(policy);
  assert.equal(active.checks.modules, 'failed');
  assert.equal(active.checks.installedApplications, 'partial');
  assert.equal(active.installedApplications.length, 100);
  running = false;
  assert.equal((await scanner(policy)).checks.modules, 'not-running');
  assert.equal(moduleCalls, 1);
});

test('renamed game libraries can be matched against configured byte fingerprints without loading them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-module-hash-')), path = join(dir, 'ordinary-name.dll');
  t.after(async () => { await unlink(path); await rmdir(dir); });
  await writeFile(path, 'harmless library fingerprint fixture');
  const sha256 = await executableHash(path);
  const scanner = createWindowsScanner({ processes: async () => [{ name: 'dota2.exe', pid: 10 }], applications: async () => [], hash: executableHash, modules: async () => ({ failed: 0, modules: [{ name: 'ordinary-name.dll', path }] }) });
  const observed = await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [sha256], blockedModules: [] });
  assert.equal(observed.loadedModules[0].sha256, sha256);
  const config = structuredClone(DEFAULT_MONITOR_CONFIG); config.pc.blockedFileHashes = [{ sha256, label: 'Harmless DLL fixture', severity: 'high' }];
  assert.ok(evaluateFacts({ ...observed, platform: 'pc', screenshotOk: true }, config, 'dota2').some(signal => signal.id === 'blocked-file-hash'));
});

test('Android certificate matches are revalidated against the server policy', () => {
  const config = structuredClone(DEFAULT_MONITOR_CONFIG), hash = 'b'.repeat(64);
  config.android.blockedCertificates = [{ sha256: hash, label: 'Verified tool certificate', severity: 'high' }];
  const facts = { platform: 'android' as const, games: [], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, blockedCertificateMatches: [{ packageName: 'renamed.package', sha256: hash }], checks: { installedApps: true, gameSignatures: true, overlays: false, certificates: true } };
  assert.ok(evaluateFacts(facts, config, 'mlbb', { recordingRequired: false }).some(s => s.id === 'blocked-app-certificate'));
  assert.ok(evaluateFacts(facts, config, 'mlbb', { recordingRequired: false }).some(s => s.id === 'checks-incomplete'));
  assert.ok(!evaluateFacts(facts, DEFAULT_MONITOR_CONFIG, 'mlbb').some(s => s.id === 'blocked-app-certificate'));
});

test('coverage distinguishes uninspected, legacy, incomplete and reported devices', () => {
  assert.equal(inspectionCoverage('ios', {}).status, 'unavailable');
  assert.equal(inspectionCoverage('android', null).status, 'not-reported');
  assert.equal(inspectionCoverage('pc', { processes: [] }).status, 'limited');
  assert.equal(inspectionCoverage('android', { checks: { installedApps: true } }).status, 'limited');
  assert.equal(inspectionCoverage('pc', { checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured' } }).status, 'reported');
});

test('pairing origins cannot inject GSI credentials or configuration', () => {
  assert.equal(monitorAddress('https://referee.example/'), 'https://referee.example');
  assert.equal(monitorAddress('http://192.168.1.5:3210'), 'http://192.168.1.5:3210');
  assert.equal(monitorAddress('http://[::1]:3210'), 'http://[::1]:3210');
  for (const address of ['https://safe&calc.test', 'https://safe%26calc.test', 'https://safe%25PATH%25.test', 'https://' + 'a'.repeat(600)]) assert.throws(() => monitorAddress(address));
  for (const address of ['https://user:pass@host.test', 'file:///tmp', 'https://host.test/path', 'http://host"auth"token"injected', 'https://host.test\\evil', 'https://host.test?next=evil', 'https://host.test/#fragment']) assert.throws(() => monitorAddress(address));
  assert.throws(() => gsiConfig('http://localhost:3210', 'token" injected'));
});
