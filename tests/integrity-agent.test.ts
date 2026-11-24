import test from 'node:test';
import assert from 'node:assert/strict';
import { flaggedProcesses, gsiConfig, parseArgs, parseTasklist, steamLibraries } from '../tools/integrity-agent/agentCore';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('tasklist parsing keeps names and PIDs, including quotes and commas', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"cheatengine-x86_64-SSE4-AVX2.exe","4120","Console","1","52,120 K"\r\n"Some ""quoted"", app.exe","77","Console","1","1 K"\r\n';
  assert.deepEqual(parseTasklist(csv), [{ name: 'System Idle Process', pid: 0 }, { name: 'cheatengine-x86_64-SSE4-AVX2.exe', pid: 4120 }, { name: 'Some "quoted", app.exe', pid: 77 }]);
});

test('only blocklisted processes are reported, once per name', () => {
  const list = [{ name: 'chrome.exe', pid: 1 }, { name: 'CheatEngine.exe', pid: 2 }, { name: 'cheatengine.exe', pid: 3 }, { name: 'dota2.exe', pid: 4 }];
  assert.deepEqual(flaggedProcesses(list, ['cheatengine*', 'x64dbg.exe']), [{ name: 'CheatEngine.exe', pid: 2 }]);
});

test('Steam libraries and the GSI config', () => {
  // Real libraryfolders.vdf files escape backslashes, so each one appears doubled.
  const vdf = String.raw`"libraryfolders"
{
	"0" { "path"		"C:\\Program Files (x86)\\Steam" }
	"1" { "path"		"D:\\SteamLibrary" }
}`;
  assert.deepEqual(steamLibraries('c:/program files (x86)/steam', vdf), [String.raw`c:\program files (x86)\steam`, String.raw`D:\SteamLibrary`]);
  const cfg = gsiConfig('http://192.168.1.5:3000/', 'tok_123');
  assert.match(cfg, /"uri"\s+"http:\/\/192\.168\.1\.5:3000\/api\/integrity\/dota\/gsi"/);
  assert.match(cfg, /"token"\s+"tok_123"/);
  assert.match(cfg, /"player"\s+"1"/);
});

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['--server', 'http://10.0.0.2:3000', '--code', 'ABCD2345', '--yes']), { server: 'http://10.0.0.2:3000', code: 'ABCD2345', yes: true });
});

test('one-click start: website links, the downloaded file and the remembered server', async () => {
  const { codeFromFileName, isPackaged, parseLaunchLink, protocolRegistration, rememberedServer, rememberServer, serverFromZoneIdentifier } = await import('../tools/integrity-agent/launch');
  assert.deepEqual(parseLaunchLink('arenahub://practice?s=https%3A%2F%2Fevent.trycloudflare.com'), { mode: 'practice', server: 'https://event.trycloudflare.com' });
  assert.deepEqual(parseLaunchLink('arenahub://scan/?s=https%3A%2F%2Fevent.example.org&c=abcd2345'), { mode: 'scan', server: 'https://event.example.org', code: 'ABCD2345' });
  // A link can come from any website, so a bad address or code is dropped, never used.
  assert.deepEqual(parseLaunchLink('arenahub://scan?s=https%3A%2F%2Fuser%3Apw%40evil.example%2Fpath&c=ABCD1111'), { mode: 'scan' });
  assert.equal(parseLaunchLink('arenahub://uninstall?s=x'), null);
  assert.equal(parseLaunchLink('https://event.example.org'), null);

  assert.equal(codeFromFileName(String.raw`C:\Users\p\Downloads\arenahub-scan-ABCD2345 (1).exe`), 'ABCD2345');
  assert.equal(codeFromFileName(String.raw`C:\Users\p\Downloads\arenahub-agent.exe`), '');

  const zone = (host: string) => `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://arenahub.example.org/\r\nHostUrl=${host}\r\n`;
  assert.equal(serverFromZoneIdentifier(zone('https://event.trycloudflare.com/api/integrity/downloads/arenahub-agent.exe?code=ABCD2345')), 'https://event.trycloudflare.com');
  assert.equal(serverFromZoneIdentifier('[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://mirror.example.com/files/arenahub-agent.exe\r\n'), undefined, 'a copy from another site is not a tournament server');

  const dir = mkdtempSync(join(tmpdir(), 'arenahub-launch-'));
  try {
    assert.equal(rememberedServer(dir), undefined);
    rememberServer('https://event.example.org', dir);
    assert.equal(rememberedServer(dir), 'https://event.example.org');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  assert.equal(isPackaged(String.raw`C:\Program Files\nodejs\node.exe`), false);
  assert.equal(isPackaged(String.raw`C:\Users\p\Downloads\arenahub-scan-ABCD2345.exe`), true);
  const [, , command] = protocolRegistration(String.raw`C:\Users\p\Downloads\arenahub-agent.exe`);
  assert.deepEqual(command, ['add', String.raw`HKCU\Software\Classes\arenahub\shell\open\command`, '/ve', '/d', String.raw`"C:\Users\p\Downloads\arenahub-agent.exe" --link "%1"`, '/f']);
});

test('Dota 2 is found from the running game when Steam does not list it (computer shops)', async () => {
  const { dotaGameDirFromExe } = await import('../tools/integrity-agent/launch');
  assert.equal(dotaGameDirFromExe(String.raw`D:\Games\Steam\steamapps\common\dota 2 beta\game\bin\win64\dota2.exe`), String.raw`D:\Games\Steam\steamapps\common\dota 2 beta\game`);
  assert.equal(dotaGameDirFromExe(String.raw`\gameserver\games\dota 2 beta\game\bin\win64\DOTA2.EXE`), String.raw`\gameserver\games\dota 2 beta\game`);
  assert.equal(dotaGameDirFromExe(String.raw`C:\Users\p\Downloads\dota2.exe`), undefined, 'a dota2.exe outside a game install is not a game folder');
  assert.equal(dotaGameDirFromExe(undefined), undefined);
});

test('agent window: only its own tab can read it or answer, and answers are validated', async () => {
  const { startAgentWindow, readAction } = await import('../tools/integrity-agent/agentWindow');
  assert.deepEqual(readAction({ type: 'choose', mode: 'official', code: 'abcd2345', server: 'https://x.test' }), { type: 'choose', mode: 'official', code: 'ABCD2345', server: 'https://x.test' });
  assert.equal(readAction({ type: 'choose', mode: 'official', code: 'ABCD1', server: 'https://x.test' }), null, 'codes are 8 characters without 0, 1, O or I');
  assert.equal(readAction({ type: 'consent', answer: 'maybe' }), null);
  assert.equal(readAction({ type: 'format-disk' }), null);
  const win = await startAgentWindow({ mode: 'official', phase: 'consent', steps: [] }, { open: false });
  try {
    const url = new URL(win.url);
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(url.pathname.length > 30, 'a long random secret path');
    const page = await fetch(win.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.match(await page.text(), /ArenaHub Anti-cheat/);
    assert.equal((await fetch(`${url.origin}/state`)).status, 404, 'no secret, no state');
    assert.equal((await fetch(`${url.origin}/wrong-secret/state`)).status, 404);
    // DNS rebinding: a page on another name that resolves to 127.0.0.1 still sends its own Host.
    const { request } = await import('node:http');
    const rebound = await new Promise<number>(resolve => request(win.url, { headers: { Host: `evil.test:${url.port}` } }, res => resolve(res.statusCode || 0)).end());
    assert.equal(rebound, 404);
    const state = await (await fetch(`${win.url}state`)).json();
    assert.equal(state.phase, 'consent');
    const answered = win.next('consent');
    const post = (body: unknown, headers: Record<string, string> = { 'X-ArenaHub': '1' }) => fetch(`${win.url}action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ type: 'consent', answer: 'yes' }, {})).status, 404, 'a plain cross-site form post has no custom header');
    assert.equal((await post({ type: 'consent', answer: 'yes' }, { 'X-ArenaHub': '1', Origin: 'https://evil.test' })).status, 404);
    assert.equal((await post({ type: 'stop' })).status, 409, 'nothing is waiting for stop yet');
    assert.equal((await post({ type: 'consent', answer: 'yes' })).status, 200);
    assert.deepEqual(await answered, { type: 'consent', answer: 'yes' });
    win.set({ phase: 'scanning' }); win.set({ steps: [{ key: 'programs', label: 'Programs', status: 'waiting' }] }); win.step('programs', { status: 'done', detail: 'ok' });
    assert.deepEqual((await (await fetch(`${win.url}state`)).json()).steps, [{ key: 'programs', label: 'Programs', status: 'done', detail: 'ok' }]);
  } finally { win.close(); }
});

test('agent window steps read plainly for each scan outcome', async () => {
  const { scanSteps, programsStep, dotaStep, sweepStep } = await import('../tools/integrity-agent/agentSteps');
  assert.deepEqual(scanSteps({ official: true, folders: false }).map(step => `${step.key}:${step.status}`), ['programs:waiting', 'dota:waiting', 'folders:skipped', 'report:waiting']);
  assert.equal(scanSteps({ official: false, folders: true }).at(-1)?.key, 'judge');
  const clean = { processes: [], installedApplications: [], loadedModules: [], untrustedModules: [], suspiciousPrograms: [], checks: { processes: 'complete', installedApplications: 'complete' } };
  assert.equal(programsStep(clean).status, 'done');
  assert.deepEqual(programsStep({ ...clean, processes: [{}], suspiciousPrograms: [{}] }), { status: 'warn', detail: '2 programs flagged. See the list above.' });
  assert.equal(programsStep({ ...clean, checks: { processes: 'failed', installedApplications: 'failed' } }).status, 'failed');
  const audit = { found: true, buildId: '26632873', modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] };
  assert.equal(dotaStep(audit, 'complete').detail, 'Build 26632873 matches the file list Valve ships.');
  assert.equal(dotaStep({ ...audit, launchFlags: ['-insecure'] }, 'complete').status, 'warn');
  assert.equal(dotaStep({ ...audit, found: false }, 'failed').status, 'failed');
  assert.equal(dotaStep({ ...audit, found: false }, 'failed', true).status, 'skipped');
  assert.equal(sweepStep('not-configured', 0).status, 'skipped');
  assert.equal(sweepStep('not-running', 0, 12000).detail, '12,000 files read so far');
  assert.deepEqual(sweepStep('complete', 0, 272509), { status: 'done', detail: '272,509 files read. No findings in those files.' });
  assert.equal(sweepStep('complete', 1, 10).detail, '10 files read, 1 file listed for review. See the findings above.');
  assert.equal(sweepStep('partial', 0, 10).status, 'warn');
});
