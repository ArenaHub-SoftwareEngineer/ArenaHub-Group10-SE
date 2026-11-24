// Process inspection is bounded to our own child. The registry test reads software entries locally;
// it sends no inventory to a server, writes no registry keys, and reports no software names to logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, unlink, rmdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createWindowsScanner, executableHash, parseInventory, windowsProvider, type WindowsProcess } from '../tools/integrity-agent/windowsScan';
import { IntegrityStore } from '../server/integrityStore';
import { createIntegrityRouter } from '../server/integrity';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MONITOR_CONFIG, evaluateFacts } from '../src/lib/integrityRisk';

test('the built app accepts a server and code interactively and honors decline before scanning', { skip: process.platform !== 'win32' || !existsSync('dist-agent/arenahub-agent.exe'), timeout: 20_000 }, async t => {
  let declined = 0, scans = 0;
  const app = express();
  app.post('/api/integrity/device/decline', (_req, res) => { declined++; res.json({ ok: true }); });
  app.post('/api/integrity/device/claim', (_req, res) => { scans++; res.status(500).json({ error: 'Must not pair after decline' }); });
  app.get('/api/integrity/device/pairing/:code', (_req, res) => { res.json({ platform: 'pc', game: 'dota2', gameLabel: 'Dota 2', playerName: 'Harmless fixture', matchLabel: 'Decline test', record: false, folderCheck: false }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  // No remembered server from this PC's real profile: the agent must ask for one.
  const appData = await mkdtemp(join(tmpdir(), 'arenahub-appdata-'));
  const child = spawn(resolve('dist-agent/arenahub-agent.exe'), ['--interactive'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, APPDATA: appData } });
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(appData, { recursive: true, force: true }); });
  let output = '', stage = 0;
  child.stdout.on('data', chunk => {
    output += String(chunk);
    // A plain double-click offers the official scan (1) or a practice scan (2) first.
    if (stage === 0 && output.includes('Type 1 or 2:')) { stage++; child.stdin.write('1\n'); }
    else if (stage === 1 && output.includes('Tournament server address:')) { stage++; child.stdin.write(`http://127.0.0.1:${(server.address() as AddressInfo).port}\n`); }
    else if (stage === 2 && output.includes('Your 8-character match scan code:')) { stage++; child.stdin.write('ABCD2345\n'); }
    else if (stage === 3 && output.includes('Type YES to agree')) { stage++; child.stdin.write('NO\n'); }
  });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0);
  assert.equal(stage, 4);
  assert.ok(output.includes('This scan code is for Harmless fixture'), 'the player sees whose scan it is before agreeing');
  assert.equal(declined, 1);
  assert.equal(scans, 0);
  assert.ok(output.includes('You declined.'));
});

test('Windows reads real loaded libraries from a harmless child and reports only a configured fixture match', { skip: process.platform !== 'win32', timeout: 45_000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  t.after(() => { child.kill(); });
  const inspected = await windowsProvider.modules!([child.pid!]);
  assert.equal(inspected.failed, 0);
  const selected = inspected.modules.find(module => module.name.toLowerCase() === 'kernel32.dll');
  assert.ok(selected);
  // Reuse a harmless child as the protected-process fixture. No game is modified or injected into.
  const scanner = createWindowsScanner({ processes: async () => [{ name: 'dota2.exe', pid: child.pid! }], applications: async () => [], modules: windowsProvider.modules, hash: executableHash });
  const observation = await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [], blockedModules: [selected.name.toLowerCase()] });
  assert.equal(observation.checks.modules, 'complete');
  assert.deepEqual(observation.loadedModules.map(module => module.name.toLowerCase()), [selected.name.toLowerCase()]);
  assert.ok(!JSON.stringify(observation).includes(selected.path!));
  const config = structuredClone(DEFAULT_MONITOR_CONFIG); config.pc.blockedModules = [{ match: selected.name.toLowerCase(), label: 'Harmless module fixture', severity: 'high' }];
  assert.ok(evaluateFacts({ ...observation, platform: 'pc', screenshotOk: true }, config, 'dota2').some(signal => signal.id === 'blocked-module'));
});

test('Windows collector fingerprints a harmless live fixture and the referee API flags its exact hash', { skip: process.platform !== 'win32', timeout: 45_000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  t.after(() => { child.kill(); });
  assert.ok(Number.isInteger(child.pid));
  const run = promisify(execFile);
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}' | Select-Object @{n='name';e={$_.Name}},@{n='pid';e={$_.ProcessId}},@{n='path';e={$_.ExecutablePath}} | ConvertTo-Json -Compress`], { timeout: 20_000, windowsHide: true });
  const processes = parseInventory<WindowsProcess>(stdout, row => ({ name: String(row.name), pid: Number(row.pid), path: String(row.path) }));
  assert.equal(processes[0].pid, child.pid);
  const fingerprint = await executableHash(process.execPath);
  const scanner = createWindowsScanner({ processes: async () => processes, applications: async () => [{ name: 'Harmless installed-software fixture', version: '1' }, { name: 'Unrelated personal application' }], hash: executableHash });
  const observation = await scanner({ blockedProcesses: [], blockedApplications: ['harmless installed-software fixture'], blockedFileHashes: [fingerprint] });
  assert.equal(observation.processes.length, 1);
  assert.equal(observation.processes[0].sha256, fingerprint, 'real executable bytes were inspected without loading or changing game memory');
  assert.equal(observation.installedApplications.length, 1);
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-native-proof-'));
  const store = new IntegrityStore(dir);
  const app = express();
  app.use('/api/integrity', createIntegrityRouter({}, { store, verifyStaff: async () => 'test-staff' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); store.close();
    const { readdir } = await import('node:fs/promises');
    for (const file of await readdir(dir)) if (file.startsWith('integrity.db')) await unlink(join(dir, file));
    await rmdir(join(dir, 'recordings')); await rmdir(dir);
  });
  const config = store.config();
  config.pc.blockedProcesses = [];
  config.pc.blockedApplications = [{ match: 'harmless installed-software fixture', label: 'Harmless fixture', severity: 'low' }];
  config.pc.blockedFileHashes = [{ sha256: fingerprint, label: 'Harmless collector test executable', severity: 'high' }];
  store.saveConfig(config, 'test-staff');
  const pair = store.createPairing({ matchId: 'isolated-test', matchLabel: 'Harmless collector test', game: 'dota2', platform: 'pc', playerName: 'Fixture', expectedSteamId: '', hours: 1, record: false }, 'test-staff');
  const claimed = store.claim(pair.code, { agent: 'test fixture' })!;
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity/device/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${claimed.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...observation, platform: 'pc', screenshotOk: true }) });
  assert.equal(response.status, 200);
  const signals = store.signals(pair.id);
  assert.ok(signals.some(signal => signal.id === 'blocked-file-hash'));
  assert.ok(signals.some(signal => signal.id === 'blocked-application-installed'));
  assert.ok(!JSON.stringify(store.session(pair.id)?.last_facts).includes('Unrelated personal'));
});

test('Windows registered-software inspection reports only a selected local test match', { skip: process.platform !== 'win32', timeout: 45_000 }, async () => {
  const inventory = await windowsProvider.applications();
  const selected = inventory.find(app => /^[a-z0-9._ -]{2,120}$/i.test(app.name));
  assert.ok(selected, 'This Windows test device must have a registered desktop application.');
  const scanner = createWindowsScanner({ processes: async () => [], applications: windowsProvider.applications, hash: executableHash });
  const observation = await scanner({ blockedProcesses: [], blockedApplications: [selected.name.toLowerCase()], blockedFileHashes: [] });
  assert.equal(observation.checks.installedApplications, 'complete');
  assert.ok(observation.installedApplications.length >= 1);
  assert.ok(observation.installedApplications.every(app => app.name.toLowerCase() === selected.name.toLowerCase()), 'Only the selected local match may leave the collector.');
});

test('the PC agent stops at its local consent deadline without a server expiry response', { skip: process.platform !== 'win32', timeout: 15_000 }, async t => {
  const app = express(); app.use(express.json());
  app.post('/api/integrity/device/claim', (_req, res) => res.json({ token: 'isolated-test-token', game: 'dota2', gameLabel: 'Dota 2', playerName: 'Harmless fixture', matchLabel: 'Local deadline test', expiresAt: Date.now() + 1500, heartbeatSeconds: 15, record: false, monitor: { blockedProcesses: [], blockedApplications: [], blockedFileHashes: [] } }));
  app.get('/api/integrity/device/pairing/:code', (_req, res) => { res.json({ platform: 'pc', game: 'dota2', gameLabel: 'Dota 2', playerName: 'Harmless fixture', matchLabel: 'Local deadline test', record: false, folderCheck: false }); });
  // Simulate an unreachable reporting response. The client must not wait for a server-side 410.
  app.post('/api/integrity/device/heartbeat', (_req, _res) => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const start = Date.now();
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tools/integrity-agent/agent.ts', '--server', `http://127.0.0.1:${(server.address() as AddressInfo).port}`, '--code', 'ABCD2345', '--yes'], { timeout: 10_000, windowsHide: true, maxBuffer: 100_000 });
  assert.match(stdout, /The match window closed\. Monitoring stopped\./);
  assert.ok(Date.now() - start < 8000, 'Collection must stop locally, without waiting for the request timeout.');
});

test('the built Windows app completes a real basic scan and the API verifies its v3 policy stamp', { skip: process.platform !== 'win32' || !existsSync('dist-agent/arenahub-agent.exe'), timeout: 35_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-built-scan-'));
  const store = new IntegrityStore(dir);
  const config = store.config(); config.pc.blockedProcesses = []; config.pc.blockedApplications = []; config.pc.blockedFileHashes = []; config.pc.fileSweep = false; store.saveConfig(config, 'fixture');
  const pairing = store.createPairing({ matchId: 'native-fixture', matchLabel: 'Harmless native scan test', game: 'dota2', platform: 'pc', playerName: 'Fixture', expectedSteamId: '', hours: 1, record: false }, 'fixture');
  const app = express();
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = body => {
      // This test deliberately omits optional GSI setup so no user Steam files are changed.
      if (req.path === '/api/integrity/device/claim') { const { gsiToken: _unused, ...withoutGameSetup } = body; return send(withoutGameSetup); }
      return send(body);
    };
    next();
  });
  app.use('/api/integrity', createIntegrityRouter({}, { store, verifyStaff: async () => 'fixture' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  const child = spawn(resolve('dist-agent/arenahub-agent.exe'), ['--server', `http://127.0.0.1:${(server.address() as AddressInfo).port}`, '--code', pairing.code, '--yes'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    child.kill(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
    const { readdir } = await import('node:fs/promises'); for (const file of await readdir(dir)) if (file.startsWith('integrity.db')) await unlink(join(dir, file)); await rmdir(join(dir, 'recordings')); await rmdir(dir);
  });
  await new Promise<void>((resolve, reject) => {
    let text = '';
    const timeout = setTimeout(() => reject(new Error(`Built companion did not complete its basic scan in time. Output:
${text.slice(-1500)}`)), 28_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', chunk => { text += String(chunk); if (text.includes('Scan passed:') || text.includes('Dota 2 install not found:')) { clearTimeout(timeout); resolve(); } });
    child.on('exit', () => { clearTimeout(timeout); reject(new Error('Built companion exited before completing its scan.')); });
  });
  const row = store.session(pairing.id)!;
  // 3.2 audits the real Dota 2 install read-only. On a PC without Dota 2 the scan must say so instead of passing.
  const facts = JSON.parse(row.last_facts!);
  assert.equal(facts.checks.dotaFiles, facts.dota.found ? 'complete' : 'failed');
  assert.equal(store.scan(row).status, facts.dota.found ? 'ready' : 'incomplete');
  if (facts.dota.found) {
    assert.match(facts.dota.manifestSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual([...facts.dota.modifiedFiles, ...facts.dota.missingFiles, ...facts.dota.unlistedBinaries, ...facts.dota.contentOverrides], [], 'a Steam-verified install has no findings');
  }
  assert.equal(JSON.parse(row.last_facts!).scan.challenge, row.scan_challenge);
  assert.equal(JSON.parse(row.last_facts!).scan.policyVersion, store.policyVersion());
  assert.deepEqual(JSON.parse(row.last_facts!).processes, []);
  assert.deepEqual(JSON.parse(row.last_facts!).installedApplications, []);
});
