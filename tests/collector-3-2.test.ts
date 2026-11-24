// Collector 3.2: Dota 2 install audit, user-folder library signatures, optional cheat-file folder check,
// Android hook/container indicators and iPhone sideload indicators. All fixtures are harmless text files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditDotaInstall, launchOptionsFromVdf, mergeAudits, parseSignatures, restrictedLaunchFlags, unexpectedSearchPaths } from '../tools/integrity-agent/dotaAudit';
import { sweepFolders } from '../tools/integrity-agent/fileSweep';
import { analyzeContent, judgeTraits } from '../tools/integrity-agent/fileIntel';
import { createWindowsScanner, type WindowsScanProvider } from '../tools/integrity-agent/windowsScan';
import { DEFAULT_MONITOR_CONFIG, evaluateFacts, inspectionCoverage, monitorConfigSchema, pcFactsSchema } from '../src/lib/integrityRisk';
import { preMatchScan } from '../src/lib/preMatchScan';
import { foundIndicators, IOS_INDICATOR_KEYS, IOS_INSPECTION_CHECKS, iosReviewSchema } from '../src/lib/iosAntiCheat';

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const sha256Buffer = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const BS = String.fromCharCode(92);
const VALVE_GAMEINFO = '"GameInfo"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_AudioLanguage\tdota_*LANGUAGE*\n\t\t\tGame_LowViolence\tdota_lv\n\t\t\tGame\t\t\t\tdota\n\t\t\tGame\t\t\t\tcore\n\t\t\tMod\t\t\t\t\tdota\n\t\t\tWrite\t\t\t\tdota\n\t\t\tAddonRoot_AudioLanguage\tdota_*LANGUAGE*_addons\n\t\t\tAddonRoot\t\t\tdota_addons\n\t\t\tPublicContent\t\tdota_core\n\t\t\tPublicContent\t\tcore\n\t\t}\n\t}\n}\n';

/** A fake Dota install shaped like the real one: game/bin/win64 with dota.signatures, game/dota, a Steam app manifest. */
function fakeInstall() {
  const library = mkdtempSync(join(tmpdir(), 'arenahub-dota-'));
  const game = join(library, 'steamapps', 'common', 'dota 2 beta', 'game');
  const files: Record<string, string> = { 'bin/win64/dota2.exe': 'MZ fake dota2', 'bin/win64/tier0.dll': 'MZ fake tier0', 'dota/bin/win64/client.dll': 'MZ fake client', 'dota/gameinfo.gi': VALVE_GAMEINFO };
  for (const [file, body] of Object.entries(files)) { mkdirSync(join(game, ...file.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(game, ...file.split('/')), body); }
  for (const name of ['pak01_dir.vpk', 'pak01_000.vpk', 'shaders_pc_dir.vpk']) writeFileSync(join(game, 'dota', name), 'vpk');
  mkdirSync(join(game, 'core'), { recursive: true }); writeFileSync(join(game, 'core', 'pak01_dir.vpk'), 'vpk');
  mkdirSync(join(game, 'dota_russian'), { recursive: true }); writeFileSync(join(game, 'dota_russian', 'gameinfo.gi'), VALVE_GAMEINFO.replace('Game\t\t\t\tdota\n', 'Game\t\t\t\tdota_russian\n\t\t\tGame\t\t\t\tdota\n'));
  mkdirSync(join(game, 'dota_lv', 'maps', 'scenes', 'dashboard_background'), { recursive: true }); writeFileSync(join(game, 'dota_lv', 'maps', 'scenes', 'dashboard_background', 'radiant.vpk'), 'vpk');
  mkdirSync(join(game, 'dota_addons', 'overthrow', 'maps'), { recursive: true }); writeFileSync(join(game, 'dota_addons', 'overthrow', 'maps', 'map.vpk'), 'vpk');
  const line = (file: string) => {
    const relative = file.startsWith('bin/win64/') ? `...${BS}${file.slice('bin/win64/'.length).replaceAll('/', BS)}` : `...${BS}..${BS}..${BS}${file.replaceAll('/', BS)}`;
    return `${relative}~SHA1:${sha1(files[file]).toUpperCase()};CRC:00000000`;
  };
  writeFileSync(join(game, 'bin', 'win64', 'dota.signatures'), [...Object.keys(files).map(line), 'DIGEST:ABCDEF'].join('\r\n'));
  writeFileSync(join(library, 'steamapps', 'appmanifest_570.acf'), '"AppState"\n{\n\t"appid"\t\t"570"\n\t"StateFlags"\t\t"4"\n\t"buildid"\t\t"26632873"\n}\n');
  return { library, game, cleanup: () => rmSync(library, { recursive: true, force: true }) };
}

test('Valve file list paths resolve inside the game folder and escaping entries are ignored', () => {
  const entries = parseSignatures([
    `...${BS}..${BS}..${BS}dota${BS}bin${BS}win64${BS}client.dll~SHA1:5A26E9F5D30BA7B89CC58217CD46AEC81C74A736;CRC:5FF63345`,
    `...${BS}tier0.dll~SHA1:AD2CE63BE2CEECC7D104694B06E7AA2D7D6296C9;CRC:CFB2533F`,
    `...${BS}qt5_plugins${BS}platforms${BS}qwindows.dll~SHA1:${'1'.repeat(40)};CRC:0`,
    `...${BS}..${BS}..${BS}..${BS}..${BS}..${BS}Windows${BS}evil.dll~SHA1:${'2'.repeat(40)};CRC:0`,
    'DIGEST:163D134FB37B',
  ].join('\r\n'));
  assert.deepEqual(entries.map(entry => entry.file), ['dota/bin/win64/client.dll', 'bin/win64/tier0.dll', 'bin/win64/qt5_plugins/platforms/qwindows.dll']);
  assert.equal(entries[0].sha1, '5a26e9f5d30ba7b89cc58217cd46aec81c74a736');
});

test('launch options: -insecure, sv_cheats and non-Valve -language are restricted; normal options are not', () => {
  assert.deepEqual(restrictedLaunchFlags('-novid -high -language russian +fps_max 240'), []);
  assert.deepEqual(restrictedLaunchFlags('"C:\\Steam\\dota2.exe" -insecure -language mods +sv_cheats 1'), ['-insecure (VAC disabled)', '-language mods (not a Valve language; loads game/dota_mods)', '+sv_cheats 1']);
  assert.deepEqual(restrictedLaunchFlags('+sv_cheats 0'), []);
  const vdf = '"UserLocalConfigStore"\n{\n "Software" { "Valve" { "Steam" { "apps" {\n  "730" { "LaunchOptions" "-insecure" }\n  "570" { "LastPlayed" "1" "cloud" { "x" "y" } "LaunchOptions" "-novid -language \\"mods\\"" }\n } } } }\n}';
  assert.deepEqual(launchOptionsFromVdf(vdf), ['-novid -language "mods"'], 'only Dota 2 (app 570) options are read');
  assert.deepEqual(restrictedLaunchFlags(launchOptionsFromVdf(vdf)[0]), ['-language mods (not a Valve language; loads game/dota_mods)']);
});

test('gameinfo search paths: Valve folders and language folders pass, an added mod folder does not', () => {
  assert.deepEqual(unexpectedSearchPaths(VALVE_GAMEINFO, 'dota'), []);
  assert.deepEqual(unexpectedSearchPaths(VALVE_GAMEINFO.replace('PublicContent\t\tcore', 'PublicContent\t\tcore\n\t\t\tGame\tdota_schinese_addons'), 'dota'), []);
  assert.deepEqual(unexpectedSearchPaths(VALVE_GAMEINFO.replace('Game\t\t\t\tdota\n', 'Game\t\t\t\tdota_mods\n\t\t\tGame\t\t\t\tdota\n'), 'dota'), ['dota_mods']);
});

test('a clean install has no findings; each kind of tampering is reported by relative path only', async () => {
  const { game, library, cleanup } = fakeInstall();
  try {
    const clean = await auditDotaInstall(game, { launchOptions: ['-novid'] });
    assert.equal(clean.status, 'complete');
    assert.deepEqual({ ...clean.audit, manifestSha256: undefined }, { found: true, buildId: '26632873', updatePending: false, manifestSha256: undefined, modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] });
    assert.match(clean.audit.manifestSha256!, /^[0-9a-f]{64}$/);

    // A patched client, a proxy DLL beside dota2.exe, a mod folder and a gameinfo search path, a removed file.
    writeFileSync(join(game, 'dota', 'bin', 'win64', 'client.dll'), 'MZ patched client');
    writeFileSync(join(game, 'bin', 'win64', 'version.dll'), 'MZ proxy loader');
    writeFileSync(join(game, 'dota', 'gameinfo.gi'), VALVE_GAMEINFO.replace('Game\t\t\t\tdota\n', 'Game\t\t\t\tdota_mods\n\t\t\tGame\t\t\t\tdota\n'));
    mkdirSync(join(game, 'dota_mods'), { recursive: true }); writeFileSync(join(game, 'dota_mods', 'pak01_dir.vpk'), 'mod');
    writeFileSync(join(game, 'dota', 'pak02_dir.vpk'), 'mod');
    writeFileSync(join(game, 'dota_lv', 'pak01_dir.vpk'), 'mod');
    unlinkSync(join(game, 'bin', 'win64', 'tier0.dll'));
    writeFileSync(join(library, 'steamapps', 'appmanifest_570.acf'), '"AppState"\n{\n\t"StateFlags"\t\t"6"\n\t"buildid"\t\t"26632873"\n}\n');
    const { audit, status } = await auditDotaInstall(game, { launchOptions: ['-insecure'] });
    assert.equal(status, 'complete');
    assert.deepEqual(audit.modifiedFiles.sort(), ['dota/bin/win64/client.dll', 'dota/gameinfo.gi']);
    assert.deepEqual(audit.missingFiles, ['bin/win64/tier0.dll']);
    assert.deepEqual(audit.unlistedBinaries, ['bin/win64/version.dll']);
    assert.equal(audit.updatePending, true);
    assert.deepEqual(audit.launchFlags, ['-insecure (VAC disabled)']);
    const overrides = audit.contentOverrides.join('\n');
    assert.match(overrides, /dota\/pak02_dir\.vpk is not a Valve content pack/);
    assert.match(overrides, /dota\/gameinfo\.gi adds search path dota_mods/);
    assert.match(overrides, /dota_mods holds 1 content pack/);
    assert.match(overrides, /dota_lv holds 1 content pack/, 'only Valve dashboard scenes are allowed in dota_lv');
    assert.doesNotMatch(overrides, /dota_addons|dota_russian/);
    assert.ok(![...audit.modifiedFiles, ...audit.unlistedBinaries, ...audit.contentOverrides].some(item => item.includes(tmpdir()) || item.includes(library)), 'no local paths leave the PC');
  } finally { cleanup(); }
});

test('a missing install or Valve list is never reported as clean', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'arenahub-nodota-'));
  try {
    const result = await auditDotaInstall(empty);
    assert.equal(result.status, 'failed'); assert.equal(result.audit.found, false);
    assert.equal(mergeAudits([result]).status, 'failed');
  } finally { rmSync(empty, { recursive: true, force: true }); }
  const { game, cleanup } = fakeInstall();
  try {
    unlinkSync(join(game, 'bin', 'win64', 'dota.signatures'));
    const { audit } = await auditDotaInstall(game);
    assert.deepEqual(audit.missingFiles, ['bin/win64/dota.signatures']);
  } finally { cleanup(); }
});

const stamp = { challenge: 'a'.repeat(48), policyVersion: 'b'.repeat(64) };
const cleanDota = { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] };
const pcFacts = (over: Record<string, unknown> = {}) => pcFactsSchema.parse({ platform: 'pc', processes: [], installedApplications: [], gameRunning: false, screenshotOk: true, dota: cleanDota, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' }, scan: stamp, ...over });
const scan = (facts: unknown, config = structuredClone(DEFAULT_MONITOR_CONFIG)) => preMatchScan({ platform: 'pc', game: 'dota2', status: 'active', lastSeen: 1000, expiresAt: 10_000_000, facts, challenge: stamp.challenge, policyVersion: stamp.policyVersion, config, now: 1000 });

test('Dota install findings block admission with an explanation; a pending Steam update is softer but still blocks', () => {
  assert.equal(scan(pcFacts()).status, 'ready');
  for (const dota of [{ modifiedFiles: ['dota/bin/win64/client.dll'] }, { unlistedBinaries: ['bin/win64/version.dll'] }, { contentOverrides: ['dota_mods holds 1 content pack (VPK); Valve ships none there'] }, { launchFlags: ['-insecure (VAC disabled)'] }]) {
    const result = scan(pcFacts({ dota: { ...cleanDota, ...dota } }));
    assert.equal(result.status, 'blocked', JSON.stringify(dota));
    assert.match(result.detail, /Verify integrity/);
  }
  const signals = evaluateFacts(pcFacts({ gameRunning: true, dota: { ...cleanDota, updatePending: true, modifiedFiles: ['dota/bin/win64/client.dll'] } }), DEFAULT_MONITOR_CONFIG, 'dota2');
  assert.deepEqual(signals.map(s => [s.id, s.severity]), [['dota-file-modified', 'medium']]);
  assert.match(signals[0].evidence, /update pending/);
  assert.equal(evaluateFacts(pcFacts({ dota: { ...cleanDota, modifiedFiles: ['dota/gameinfo.gi'] } }), DEFAULT_MONITOR_CONFIG, 'dota2')[0].severity, 'critical');
});

test('staff reference file lists: a list that is not a reference copy blocks; a matching one passes', () => {
  const config = structuredClone(DEFAULT_MONITOR_CONFIG);
  config.pc.trustedDotaManifests = [{ sha256: 'd'.repeat(64), label: 'Build 26632873', severity: 'high' }];
  assert.equal(scan(pcFacts(), config).status, 'blocked');
  config.pc.trustedDotaManifests.push({ sha256: 'c'.repeat(64), label: 'Build 26632873 (second)', severity: 'high' });
  assert.equal(scan(pcFacts(), config).status, 'ready');
});

test('a 3.1 agent, a missing install or an unfinished file check cannot clear a Dota player', () => {
  const { dota: _dota, ...old } = pcFacts();
  assert.equal(scan({ ...old, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured' } }).label, 'Dota 2 file check missing');
  assert.equal(scan(pcFacts({ dota: { ...cleanDota, found: false } })).label, 'Dota 2 install not found');
  assert.equal(scan(pcFacts({ checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'partial', fileSweep: 'complete' } })).label, 'Dota 2 file check incomplete');
  assert.equal(scan(pcFacts({ gameRunning: true, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', modules: 'complete', moduleSigners: 'failed', fileSweep: 'complete' } })).label, 'Game library signatures incomplete');
  assert.equal(inspectionCoverage('pc', pcFacts({ checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'partial', fileSweep: 'complete' } })).status, 'limited');
});

test('the folder check is required by default; it must finish, and its findings block', () => {
  const config = structuredClone(DEFAULT_MONITOR_CONFIG);
  assert.equal(config.pc.fileSweep, true);
  assert.equal(monitorConfigSchema.parse(JSON.parse(JSON.stringify({ ...config, pc: { ...config.pc, fileSweep: undefined } }))).pc.fileSweep, true, 'stored configs without the setting require it');
  const swept = (fileSweep: string, over: Record<string, unknown> = {}) => pcFacts({ checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep }, ...over });
  for (const state of ['not-configured', 'failed']) assert.equal(scan(swept(state), config).label, 'Folder check required');
  assert.equal(scan(swept('not-running'), config).label, 'Folder check running');
  assert.equal(scan(swept('complete'), config).status, 'ready');
  const blocked = scan(swept('complete', { fileFindings: [{ name: 'settings.txt', folder: 'Downloads', reason: 'Cheat Engine table that targets dota2.exe', severity: 'high' }] }), config);
  assert.equal(blocked.status, 'blocked'); assert.match(blocked.blockers[0], /Downloads: settings\.txt/);
  const renamed = scan(swept('complete', { fileFindings: [{ name: 'chrome_helper.exe', folder: 'Desktop', reason: 'Renamed copy of a listed tool (its internal name is "cheatengine-x86_64.exe")', listedAs: 'cheatengine-x86_64.exe', severity: 'high' }] }), config);
  assert.equal(renamed.status, 'blocked'); assert.match(renamed.blockers[0], /Cheat Engine/, 'the staff label is shown');
  const noLongerListed = structuredClone(config); noLongerListed.pc.blockedProcesses = []; noLongerListed.pc.blockedApplications = [];
  assert.equal(scan(swept('complete', { fileFindings: [{ name: 'chrome_helper.exe', folder: 'Desktop', reason: 'Renamed copy', listedAs: 'cheatengine-x86_64.exe', severity: 'high' }] }), noLongerListed).status, 'ready', 'a tool staff removed from the list is not reported');
  assert.equal(pcFactsSchema.safeParse({ ...swept('complete'), fileFindings: [{ name: 'x', folder: 'C:\Users\Player', reason: 'x' }] }).success, false, 'only folder labels, never paths');
});

const pe = (text: string) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126), Buffer.from(text, 'latin1')]);
test('folder check judges content: renamed tables and scripts, listed tools, fingerprints; ordinary files pass', async () => {
  const home = mkdtempSync(join(tmpdir(), 'arenahub-sweep-'));
  try {
    const downloads = join(home, 'Downloads'), desktop = join(home, 'Desktop');
    mkdirSync(join(downloads, 'tools', 'deep'), { recursive: true }); mkdirSync(join(downloads, 'Cheat Engine 7.5'), { recursive: true }); mkdirSync(desktop, { recursive: true });
    writeFileSync(join(downloads, 'settings.txt'), '<?xml version="1.0" encoding="utf-8"?>\n<CheatTable CheatEngineTableVersion="45"><CheatEntries/><ProcessName>dota2.exe</ProcessName></CheatTable>');
    writeFileSync(join(downloads, 'other_game.CT'), '<?xml version="1.0"?><CheatTable><ProcessName>solitaire.exe</ProcessName></CheatTable>');
    writeFileSync(join(downloads, 'source.ts'), "const sample = '<CheatTable>dota2.exe</CheatTable>'; // a detector's own test text is not a table");
    writeFileSync(join(downloads, 'tools', 'deep', 'keys.log'), '#IfWinActive ahk_exe dota2.exe\nF1::SendInput qwer');
    writeFileSync(join(downloads, 'macro.dat'), 'import pydirectinput\n# focus dota2.exe then press keys\npydirectinput.press("q")');
    writeFileSync(join(desktop, 'notes.ahk'), '; launches notepad\n#n::Run notepad');
    writeFileSync(join(downloads, 'tools', 'cheatengine-x86_64.exe'), pe('portable'));
    writeFileSync(join(desktop, 'renamed.bin'), pe('fingerprinted tool'));
    writeFileSync(join(desktop, 'game.exe'), pe('ordinary program'));
    const policy = { blockedProcesses: ['cheatengine*'], blockedApplications: ['cheat engine*'], blockedFileHashes: [sha256Buffer(pe('fingerprinted tool'))] };
    const { findings, paths, status } = await sweepFolders([{ folder: 'Downloads', path: downloads }, { folder: 'Desktop', path: desktop }], policy);
    assert.equal(status, 'complete');
    // Each finding keeps its full path locally (same order), so the agent can drop it once the file is deleted.
    assert.equal(paths.length, findings.length);
    findings.forEach((finding, index) => assert.ok(paths[index].endsWith(finding.name), `${paths[index]} is ${finding.name}`));
    assert.ok(paths.every(path => path.startsWith(home)));
    assert.deepEqual(findings.map(f => `${f.folder}:${f.name}:${f.reason}`).sort(), [
      'Desktop:renamed.bin:Matches a staff file fingerprint',
      'Downloads:Cheat Engine 7.5:Folder named like a listed tool',
      'Downloads:cheatengine-x86_64.exe:Copy of a listed tool',
      'Downloads:keys.log:Automation script (AutoHotkey or input macro) that targets dota2.exe',
      'Downloads:macro.dat:Automation script (AutoHotkey or input macro) that targets dota2.exe',
      'Downloads:settings.txt:Cheat Engine table that targets dota2.exe',
    ]);
    assert.ok(findings.every(f => !f.name.includes(home)), 'file names only');
    // Even with no fingerprints configured, a flagged program carries its own, so staff can add it to the list.
    const unlisted = await sweepFolders([{ folder: 'Downloads', path: downloads }], { ...policy, blockedFileHashes: [] });
    assert.equal(unlisted.findings.find(f => f.name === 'cheatengine-x86_64.exe')?.sha256, sha256Buffer(pe('portable')));
    assert.equal(unlisted.findings.find(f => f.name === 'settings.txt')?.sha256, undefined, 'text files are judged by content, not fingerprinted');
    assert.equal((await sweepFolders([{ folder: 'Downloads', path: downloads }], policy, { limits: { maxEntries: 2 } })).status, 'partial');
    assert.equal((await sweepFolders([{ folder: 'Temp', path: join(home, 'missing') }], policy)).status, 'failed');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('libraries loaded from user folders need a valid signature; Windows, Program Files and the game folder are not checked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arenahub-mod-'));
  try {
    const injected = join(dir, 'overlay_helper.dll'); writeFileSync(injected, 'MZ unsigned helper');
    const signedPath = join(dir, 'DiscordHook64.dll'); writeFileSync(signedPath, 'MZ signed');
    const checked: string[][] = [];
    const provider: WindowsScanProvider = {
      async processes() { return [{ name: 'dota2.exe', pid: 100, path: 'D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe' }]; },
      async applications() { return []; },
      async hash(path) { return sha256(path); },
      async modules() { return { failed: 0, modules: [
        { name: 'dota2.exe', path: 'D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe' },
        { name: 'kernel32.dll', path: 'C:\\Windows\\System32\\kernel32.dll' },
        { name: 'RTSSHooks64.dll', path: 'C:\\Program Files (x86)\\RivaTuner Statistics Server\\RTSSHooks64.dll' },
        { name: 'overlay_helper.dll', path: injected },
        { name: 'DiscordHook64.dll', path: signedPath },
      ] }; },
      async signatures(paths) { checked.push(paths); return paths.map(path => ({ path, status: path === signedPath ? 'Valid' : 'NotSigned', signer: path === signedPath ? 'Discord Inc.' : '' })); },
    };
    const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
    const saved = { ...process.env }; Object.assign(process.env, env);
    try {
      const scanner = createWindowsScanner(provider, { trustedRoots: () => ['D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game'] });
      const observation = await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [], blockedModules: [] });
      assert.deepEqual(checked, [[injected, signedPath]]);
      assert.equal(observation.checks.moduleSigners, 'complete');
      assert.deepEqual(observation.untrustedModules.map(m => [m.name, m.status]), [['overlay_helper.dll', 'NotSigned']]);
      assert.match(observation.untrustedModules[0].sha256!, /^[0-9a-f]{64}$/);
      const facts = pcFacts({ gameRunning: true, untrustedModules: observation.untrustedModules, checks: { ...observation.checks, dotaFiles: 'complete', fileSweep: 'complete' } });
      const result = scan(facts);
      assert.equal(result.status, 'blocked'); assert.match(result.blockers[0], /overlay_helper\.dll in dota2\.exe: NotSigned/);
      await scanner({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [] });
      assert.equal(checked.length, 1, 'unchanged files reuse the cached signature');
      const failing = createWindowsScanner({ ...provider, async signatures() { throw new Error('PowerShell unavailable'); } });
      assert.equal((await failing({ blockedProcesses: [], blockedApplications: [], blockedFileHashes: [] })).checks.moduleSigners, 'failed');
    } finally { for (const key of Object.keys(env)) { if (key in saved) process.env[key] = saved[key]; else delete process.env[key]; } }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Android hooking frameworks and cloned or virtual spaces block admission', () => {
  const signer = 'e'.repeat(64);
  const config = structuredClone(DEFAULT_MONITOR_CONFIG); config.android.games.mlbb.trustedCertSha256 = [signer];
  const facts = { platform: 'android' as const, games: [{ packageName: 'com.mobile.legends', certSha256: [signer], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: false, checks: { installedApps: true, gameSignatures: true, overlays: true, certificates: true }, scan: stamp };
  const run = (over: Record<string, unknown>) => preMatchScan({ platform: 'android', game: 'mlbb', status: 'active', lastSeen: 1000, expiresAt: 10_000_000, facts: { ...facts, ...over }, challenge: stamp.challenge, policyVersion: stamp.policyVersion, config, now: 1000 });
  assert.equal(run({}).status, 'ready');
  assert.equal(run({ hookIndicators: ['Frida server answering on port 27042'] }).status, 'blocked');
  assert.equal(run({ virtualIndicators: ['unexpected app data folder /data/data/com.lbe.parallel.intl/parallel_intl/0/ph.edu.wmsu.arenahub.companion'] }).status, 'blocked');
  // A 3.1 companion that does not send the new fields is unaffected.
  assert.equal(run({ hookIndicators: undefined, virtualIndicators: undefined }).status, 'ready');
  // Low-severity listed packages (Termux) are shown as warnings, not blockers.
  const termux = run({ installedFlagged: ['com.termux'] });
  assert.equal(termux.status, 'ready'); assert.match(termux.warnings.join(' '), /Termux/);
});

test('iPhone approval requires every sideload indicator to be checked and clear; a revoke records what was found', () => {
  const checks = Object.fromEntries(Object.keys(IOS_INSPECTION_CHECKS).map(key => [key, true]));
  const indicators = Object.fromEntries(IOS_INDICATOR_KEYS.map(key => [key, 'clear']));
  const note = 'Device and account checked; referee supervising.';
  assert.ok(iosReviewSchema.safeParse({ approved: true, checks, indicators, note }).success);
  assert.equal(iosReviewSchema.safeParse({ approved: true, checks, note }).success, false, 'indicators are required');
  assert.equal(iosReviewSchema.safeParse({ approved: true, checks, indicators: { ...indicators, developerMode: undefined }, note }).success, false);
  assert.equal(iosReviewSchema.safeParse({ approved: true, checks, indicators: { ...indicators, developerMode: 'found' }, note }).success, false);
  const revoke = iosReviewSchema.parse({ approved: false, indicators: { developerMode: 'found', appStoreCopy: 'found', vpnOrProfile: 'clear' }, note });
  assert.deepEqual(foundIndicators(revoke), ['Developer Mode is on', 'The page shows Get or a download icon, not Open, although the game is installed']);
});

test('lessons from the real-PC run: no regex blow-up, no source-code or Java false positives', () => {
  // Comment-heavy XML (Visual Studio packages) once made the table check backtrack for minutes.
  const NL = String.fromCharCode(10);
  const xml = '<?xml version="1.0"?>' + NL + '<!-- a -- b --> '.repeat(4000) + '<doc>dota2.exe</doc>';
  const started = Date.now();
  assert.equal(analyzeContent(Buffer.from(xml)).cheatTable, false);
  assert.ok(Date.now() - started < 500, 'linear time');
  // Source code that quotes macro text is not a macro script; a real script is.
  assert.equal(analyzeContent(Buffer.from("const sample = '#IfWinActive ahk_exe dota2.exe\nF1::Send q';")).automationScript, false);
  assert.equal(analyzeContent(Buffer.from(['#Requires AutoHotkey v2.0', '#HotIf WinActive("ahk_exe dota2.exe")', 'F1::Send "qwer"'].join(NL))).automationScript, true);
  assert.equal(analyzeContent(Buffer.from(['import pydirectinput', '# dota2.exe combo', 'pydirectinput.press("q")'].join(NL))).automationScript, true);
  // The generic indicator also occurs in legitimate software such as Java's attach.dll.
  const javaAttach = { kind: 'pe' as const, referencesDota: false, injectionApis: true, cheatTable: false, automationScript: false };
  assert.deepEqual(judgeTraits('attach.dll', javaAttach, { processes: [], applications: [] }, 'unsigned').map(v => v.severity), ['low']);
  // Archive entries cannot be signature-checked: only a Dota target is reported from them.
  assert.deepEqual(judgeTraits('vsdebugeng.impl.dll', javaAttach, { processes: [], applications: [] }, 'unknown'), []);
  const facts = pcFacts({ fileFindings: [{ name: 'attach.dll', folder: 'App data', reason: 'Unsigned program that contains DLL-injection functions', severity: 'low' }] });
  const result = scan(facts);
  assert.equal(result.status, 'ready'); assert.match(result.warnings.join(' '), /attach.dll/);
});
