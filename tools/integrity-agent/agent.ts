// ArenaHub PC agent (Windows). Pairs this PC with one ArenaHub match and, until the match window
// closes, reports blocklisted programs, takes a screenshot every 20 seconds and connects Dota 2's
// official Game State Integration. It never reads or touches the game's memory, so it cannot
// trigger Valve Anti-Cheat.
//
// Usage: node arenahub-agent.cjs --server http://192.168.1.5:3000 --code ABCD2345 [--yes]
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { flaggedProcesses, GSI_FILE, gsiConfig, parseArgs, parseTasklist, steamLibraries } from './agentCore.ts';

const run = promisify(execFile);
const VERSION = 'pc-agent 1.0.0';
const args = parseArgs(process.argv.slice(2));
const server = String(args.server || '').replace(/\/$/, '');
const code = String(args.code || '');
if (!/^https?:\/\/[^\s/]+$/.test(server) || !/^[A-Za-z0-9]{8}$/.test(code)) {
  console.log('Usage: arenahub-agent --server http://<laptop address>:3000 --code <8-character code>\nThe referee screen shows both.');
  process.exit(1);
}
if (process.platform !== 'win32') { console.log('The ArenaHub PC agent runs on Windows only.'); process.exit(1); }

const api = (path: string, init: RequestInit & { token?: string } = {}) => fetch(`${server}/api/integrity${path}`, {
  ...init, headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(15000),
});
const powershell = (script: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });

console.log(`
ArenaHub Match Monitor (PC)
While this window is open and the match is running, ArenaHub will:
  - check running program names against the tournament blocklist (only matches are sent),
  - take a screenshot every 20 seconds and send it to the referee laptop,
  - connect Dota 2's official Game State Integration (hero, match ID, Steam ID).
It does not read game memory, files, messages, browser history or your webcam.
Data stays on the referee laptop and is deleted after 30 days unless it is part of a case.
Close this window or press Ctrl+C to stop. Stopping is logged for the referee.
`);
async function main() {
  if (args.yes !== true) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Type YES to start monitoring: ')).trim();
    rl.close();
    if (answer.toUpperCase() !== 'YES') { console.log('Monitoring not started.'); process.exit(0); }
  }

  const claim = await api('/device/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device: { model: hostname().slice(0, 80), os: `Windows ${release()}`, agent: VERSION } }) });
  const session = await claim.json() as any;
  if (!claim.ok) { console.log(session.error || 'Pairing failed.'); process.exit(1); }
  console.log(`Paired: ${session.playerName} - ${session.matchLabel} (${session.gameLabel}). Monitoring until ${new Date(session.expiresAt).toLocaleTimeString()}.`);
  blocked = session.monitor.blockedProcesses || [];
  token = session.token; game = session.game;
  await installGsi();
  await heartbeat();
  setInterval(() => void heartbeat(), (session.heartbeatSeconds || 15) * 1000);
  void screenshot(); setInterval(() => void screenshot(), 20_000);
}
let token = '', game = '', blocked: string[] = [];
let lastScreenshotOk = true, stopping = false;

// ---- Dota 2 Game State Integration ----
const gsiFiles: string[] = [];
async function installGsi() {
  if (game !== 'dota2') return;
  let steamPath = '';
  try { steamPath = (await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])).stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1].trim() || ''; } catch {}
  if (!steamPath) { console.log('Steam was not found. Dota 2 live data will be missing; the referee will see this.'); return; }
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  for (const library of steamLibraries(steamPath, existsSync(vdfPath) ? readFileSync(vdfPath, 'utf8') : '')) {
    const cfg = join(library, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'cfg');
    if (!existsSync(cfg)) continue;
    const dir = join(cfg, 'gamestate_integration');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, GSI_FILE);
    writeFileSync(file, gsiConfig(server, token));
    gsiFiles.push(file);
  }
  console.log(gsiFiles.length ? 'Dota 2 live data connected. If Dota 2 is already open, restart it now so it loads the connection.' : 'Dota 2 was not found in your Steam libraries.');
}
function removeGsi() { for (const file of gsiFiles) { try { unlinkSync(file); } catch {} } }

// ---- Checks ----
async function snapshot() {
  const list = parseTasklist((await run('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const flagged = flaggedProcesses(list, blocked);
  const details = new Map<number, { path?: string; signer?: string }>();
  if (flagged.length) {
    try {
      const ids = flagged.map(p => p.pid).join(',');
      const out = (await powershell(`Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { $s = if ($_.Path) { (Get-AuthenticodeSignature $_.Path).SignerCertificate.Subject } else { '' }; "$($_.Id)|$($_.Path)|$s" }`)).stdout;
      for (const line of out.split(/\r?\n/)) { const [pid, path, signer] = line.split('|'); if (pid) details.set(Number(pid), { path: path || undefined, signer: signer?.match(/CN=([^,]+)/)?.[1] || undefined }); }
    } catch {}
  }
  return {
    platform: 'pc' as const,
    processes: flagged.map(p => ({ name: p.name, ...details.get(p.pid) })).map(p => ({ name: p.name.slice(0, 200), ...(p.path ? { path: p.path.slice(0, 400) } : {}), ...(p.signer ? { signer: p.signer.slice(0, 200) } : {}) })),
    gameRunning: list.some(p => p.name.toLowerCase() === 'dota2.exe'),
    screenshotOk: lastScreenshotOk,
  };
}
const SCREENSHOT = (out: string) => `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)
$w=[Math]::Min(1280,$b.Width); $h=[int]($b.Height*$w/$b.Width)
$s=New-Object System.Drawing.Bitmap $bmp,$w,$h
$c=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}
$p=New-Object System.Drawing.Imaging.EncoderParameters 1
$p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]60)
$s.Save('${out.replaceAll("'", "''")}',$c,$p)`;
async function screenshot() {
  const file = join(tmpdir(), `arenahub-shot-${process.pid}.jpg`);
  try {
    await powershell(SCREENSHOT(file));
    const data = readFileSync(file);
    const response = await api('/device/media', { method: 'POST', token, headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(data) });
    if (response.status === 410) return stop('The match window closed.');
    lastScreenshotOk = true;
  } catch { lastScreenshotOk = false; }
  finally { try { unlinkSync(file); } catch {} }
}
async function heartbeat() {
  try {
    const response = await api('/device/heartbeat', { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await snapshot()) });
    if (response.status === 410) return stop('The match window closed.');
    const body = await response.json() as any;
    if (response.ok) { blocked = body.monitor?.blockedProcesses || blocked; process.stdout.write(`\rMonitoring active - last report ${new Date().toLocaleTimeString()}   `); }
  } catch { process.stdout.write('\rCannot reach the referee laptop. Retrying...            '); }
}
async function stop(reason: string, notify = false) {
  if (stopping) return; stopping = true;
  removeGsi();
  if (notify) { try { await api('/device/stop', { method: 'POST', token }); } catch {} }
  console.log(`\n${reason} Monitoring stopped.`);
  process.exit(0);
}
process.on('SIGINT', () => void stop('You stopped the agent.', true));
process.on('SIGTERM', () => void stop('The agent was closed.', true));
process.on('SIGHUP', () => void stop('The window was closed.', true));

main().catch(error => { console.log(`
The agent could not start: ${error instanceof Error ? error.message : error}`); removeGsi(); process.exit(1); });
