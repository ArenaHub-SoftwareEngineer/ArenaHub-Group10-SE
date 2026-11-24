// Cheat-evasion simulation (agent 3.3). Builds HARMLESS programs from tests/fixtures/cheat-sim with gcc that
// carry the traits of cheat software (injector imports, a Dota target string, a listed tool's internal
// identity, a protector section, an unsigned Dota-targeting DLL) and then hides them the way cheaters do:
// renamed, given a fake extension, zipped, buried in folders, run under another name, loaded into a process
// called dota2.exe. None of the programs touches another process or the real game.
// Requires Windows and MSYS2/MinGW gcc + windres; skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { sweepFolders } from '../tools/integrity-agent/fileSweep';
import { createWindowsScanner, windowsProvider } from '../tools/integrity-agent/windowsScan';
import { DEFAULT_MONITOR_CONFIG, evaluateFacts, pcFactsSchema } from '../src/lib/integrityRisk';
import { preMatchScan } from '../src/lib/preMatchScan';

const hasGcc = (() => { try { execFileSync('gcc', ['--version'], { stdio: 'ignore' }); execFileSync('windres', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = process.platform !== 'win32' || !hasGcc;
const SRC = resolve('tests/fixtures/cheat-sim');
const lists = { blockedProcesses: DEFAULT_MONITOR_CONFIG.pc.blockedProcesses.map(e => e.match), blockedApplications: (DEFAULT_MONITOR_CONFIG.pc.blockedApplications || []).map(e => e.match), blockedFileHashes: [] as string[] };

let work = '';
const bin = (name: string) => join(work, 'bin', name);
function build() {
  work = mkdtempSync(join(tmpdir(), 'arenahub-cheat-sim-'));
  mkdirSync(join(work, 'bin'));
  const gcc = (out: string, ...args: string[]) => execFileSync('gcc', ['-O1', '-s', '-o', bin(out), ...args], { cwd: SRC, stdio: 'pipe' });
  execFileSync('windres', ['tool_sim.rc', '-O', 'coff', '-o', bin('tool_sim.res')], { cwd: SRC, stdio: 'pipe' });
  gcc('injector_sim.exe', 'injector_sim.c');
  gcc('tool_sim.exe', 'tool_sim.c', bin('tool_sim.res'));
  gcc('protected_sim.exe', 'protected_sim.c');
  gcc('module_sim.dll', '-shared', 'module_sim.c');
  gcc('host_sim.exe', 'host_sim.c');
  gcc('benign.exe', 'benign.c');
}

/** Minimal ZIP writer (deflate), so the test controls exactly what the archive holds. */
function zip(entries: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), body = deflateRawSync(entry.data), crc = crc32(entry.data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('hidden cheat files are found by content, with real Windows signature checks, and ordinary programs pass', { skip, timeout: 120_000 }, async () => {
  build();
  const home = join(work, 'home');
  const place = (relative: string, data: Buffer | string) => { const path = join(home, ...relative.split('/')); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, data); };
  // Each line is one evasion trick.
  place('Downloads/chrome_updater.exe', readFileSync(bin('tool_sim.exe')));                       // listed tool, renamed
  place('Desktop/notes.txt', readFileSync(bin('injector_sim.exe')));                              // injector with a fake extension
  place('Documents/school/sem2/projects/old/helper.dll', readFileSync(bin('module_sim.dll')));    // cheat DLL buried deep
  place('AppData/Roaming/SysCache/cache.bin', readFileSync(bin('protected_sim.exe')));            // protected loader as a data file
  place('Downloads/patch.zip', zip([{ name: 'readme.dat', data: readFileSync(bin('injector_sim.exe')) }, { name: 'docs/manual.txt', data: Buffer.from('nothing to see') }])); // zipped and renamed
  place('Videos/holiday.mp4', readFileSync(bin('injector_sim.exe')));                             // disguised as a video (checked last)
  place('Downloads/settings.txt', '<?xml version="1.0" encoding="utf-8"?>\r\n<CheatTable CheatEngineTableVersion="45"><CheatEntries/><ProcessName>dota2.exe</ProcessName></CheatTable>'); // table with a fake extension
  place('Desktop/keys.log', '#IfWinActive ahk_exe dota2.exe\r\nF1::SendInput qwer');              // macro with a fake extension
  // Ordinary files that must stay clean.
  place('Downloads/hello.exe', readFileSync(bin('benign.exe')));
  place('Downloads/tools.zip', zip([{ name: 'hello.exe', data: readFileSync(bin('benign.exe')) }]));
  place('Downloads/signed-copy.exe', readFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe')));
  place('Documents/essay.txt', 'Dota 2 is a game. This essay mentions dota2.exe but is not a script.');

  const { findings, status } = await sweepFolders([{ folder: 'User folders', path: home }], lists, { signatures: paths => windowsProvider.signatures!(paths) });
  assert.equal(status, 'complete');
  const got = findings.map(f => `${f.name} :: ${f.reason}`).sort();
  assert.deepEqual(got, [
    'cache.bin :: Unsigned program that is wrapped in VMProtect',
    'chrome_updater.exe :: Renamed copy of a listed tool (its internal name is "cheatengine-x86_64.exe")',
    'helper.dll :: Unsigned program that targets dota2.exe',
    'holiday.mp4 :: Unsigned program that targets dota2.exe, contains DLL-injection functions',
    'keys.log :: Automation script (AutoHotkey or input macro) that targets dota2.exe',
    'notes.txt :: Unsigned program that targets dota2.exe, contains DLL-injection functions',
    'patch.zip > readme.dat :: Unsigned program that targets dota2.exe, contains DLL-injection functions (signature not checked)',
    'settings.txt :: Cheat Engine table that targets dota2.exe',
  ]);

  // The server turns them into blocking findings with the staff label for the renamed tool.
  const facts = pcFactsSchema.parse({ platform: 'pc', processes: [], installedApplications: [], gameRunning: false, screenshotOk: true, fileFindings: findings, dota: { found: true, modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] }, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' }, scan: { challenge: 'a'.repeat(48), policyVersion: 'b'.repeat(64) } });
  assert.ok(evaluateFacts(facts, DEFAULT_MONITOR_CONFIG, 'dota2').some(s => s.id === 'cheat-file-found' && /Cheat Engine/.test(s.evidence)));
  const admission = preMatchScan({ platform: 'pc', game: 'dota2', status: 'active', lastSeen: 1000, expiresAt: 9e9, facts, challenge: 'a'.repeat(48), policyVersion: 'b'.repeat(64), config: DEFAULT_MONITOR_CONFIG, now: 1000 });
  assert.equal(admission.status, 'blocked');
  // A protector alone is a staff warning on disk (ordinary software uses packers too); the other seven block.
  assert.equal(admission.blockers.length, 7);
  assert.ok(admission.warnings.some(w => /VMProtect/.test(w)));
});

test('renamed cheat programs are caught while running, and an unsigned DLL loaded into "dota2.exe" is caught', { skip, timeout: 120_000 }, async t => {
  if (!work) build();
  const run = join(work, 'run');
  mkdirSync(run, { recursive: true });
  copyFileSync(bin('injector_sim.exe'), join(run, 'svchost_helper.exe'));     // injector under a system-looking name
  copyFileSync(bin('tool_sim.exe'), join(run, 'discord_update.exe'));          // listed tool under an app-looking name
  copyFileSync(bin('benign.exe'), join(run, 'game_launcher.exe'));             // ordinary program
  copyFileSync(bin('host_sim.exe'), join(run, 'dota2.exe'));                   // stands in for the game process
  copyFileSync(bin('module_sim.dll'), join(run, 'd3dx9_helper.dll'));          // cheat DLL with a graphics-looking name
  const children: ChildProcess[] = [];
  t.after(() => { for (const child of children) child.kill(); });
  const start = (exe: string, args: string[]) => new Promise<void>((done, fail) => {
    const child = spawn(join(run, exe), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.on('error', fail);
    child.stdout!.once('data', () => done());
  });
  await start('svchost_helper.exe', ['--wait', '60']);
  await start('discord_update.exe', ['--wait', '60']);
  await start('game_launcher.exe', ['--wait', '60']);
  await start('dota2.exe', [join(run, 'd3dx9_helper.dll'), '60']);

  const scanner = createWindowsScanner(windowsProvider);
  const observation = await scanner({ ...lists, blockedModules: [] });
  const programs = observation.suspiciousPrograms.map(p => `${p.name} :: ${p.reason}`).sort();
  assert.ok(programs.includes('discord_update.exe :: Renamed copy of a listed tool (its internal name is "cheatengine-x86_64.exe")'), programs.join('\n'));
  assert.ok(programs.includes('svchost_helper.exe :: Unsigned program that targets dota2.exe, contains DLL-injection functions'), programs.join('\n'));
  assert.ok(!programs.some(p => p.startsWith('game_launcher.exe') || p.startsWith('dota2.exe')), 'ordinary and host programs pass');
  assert.equal(observation.checks.programContent, 'complete');
  assert.equal(observation.gameRunning, true);
  // The stand-in game is itself unsigned and outside a Steam library, so it is reported too: Valve's real
  // dota2.exe is signed and sits in the audited install. An unsigned "dota2.exe" elsewhere is not the game.
  assert.deepEqual(observation.untrustedModules.map(m => [m.name, m.status]).sort(), [['d3dx9_helper.dll', 'NotSigned'], ['dota2.exe', 'NotSigned']]);
  assert.equal(observation.checks.moduleSigners, 'complete');

  const signals = evaluateFacts(pcFactsSchema.parse({ platform: 'pc', processes: observation.processes, installedApplications: [], gameRunning: true, screenshotOk: true, suspiciousPrograms: observation.suspiciousPrograms, untrustedModules: observation.untrustedModules }), DEFAULT_MONITOR_CONFIG, 'dota2');
  assert.deepEqual([...new Set(signals.map(s => `${s.id}:${s.severity}`))].sort(), ['suspicious-program-running:critical', 'untrusted-game-module:high']);
});

test.after(() => { if (work) rmSync(work, { recursive: true, force: true }); });
