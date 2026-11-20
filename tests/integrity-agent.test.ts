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
