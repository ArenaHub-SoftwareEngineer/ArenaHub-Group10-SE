import test from 'node:test';
import assert from 'node:assert/strict';
import { flaggedProcesses, gsiConfig, parseArgs, parseTasklist, steamLibraries } from '../tools/integrity-agent/agentCore';

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
