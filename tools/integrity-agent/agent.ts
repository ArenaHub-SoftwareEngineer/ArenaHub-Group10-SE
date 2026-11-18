// ArenaHub PC agent (Windows). Pairs this PC with one ArenaHub match and, until the match window
// closes, reports blocklisted programs, takes a screenshot every 20 seconds and connects Dota 2's
// official Game State Integration. It does not inject into or alter game memory.
// This is not a publisher compatibility guarantee.
//
// Usage: node arenahub-agent.cjs --server http://192.168.1.5:3210 --code ABCD2345 [--yes]
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { GSI_FILE, gsiConfig, parseArgs, steamLibraries } from './agentCore.ts';
import { auditDotaInstall, cachedSha1, mergeAudits, windowsLaunchOptions, type DotaAudit } from './dotaAudit';
import { defaultSweepRoots, sweepFolders, type SweepFinding } from './fileSweep';
import { createWindowsScanner, windowsProvider, type ScanPolicy } from './windowsScan';
import { monitorAddress } from '../../src/lib/monitorAddress';

const run = promisify(execFile);
const VERSION = 'pc-agent 3.3.0';
const args = parseArgs(process.argv.slice(2));
let server = '';
try { server = monitorAddress(String(args.server || '')); } catch { /* The usage message below handles invalid destinations. */ }
let code = String(args.code || '');
if (process.platform !== 'win32') { console.log('The ArenaHub PC agent runs on Windows only.'); process.exit(1); }

const api = (path: string, init: RequestInit & { token?: string } = {}) => fetch(`${server}/api/integrity${path}`, {
  ...init, redirect: 'error', headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(15000),
});
const powershell = (script: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });

console.log(`
ArenaHub Anti-cheat (PC)
Run this scan before joining your official match. Keep this window open while playing.
While this window is open and the match is running, ArenaHub will:
  - check running programs and registered installed software against the tournament lists,
  - check your Dota 2 install against the file list Valve ships with the game, and look for extra
    program files, custom content packs and launch options such as -insecure,
  - inspect libraries loaded into Dota 2 against configured module names, and check the digital
    signature of any library Dota 2 loaded from outside Windows, Program Files and the game folder,
  - hash accessible executables and game libraries when staff configured file fingerprints (only matches are sent),
  - check running programs by what they contain, not their name: a renamed copy of a listed tool, or an
    unsigned program that targets dota2.exe, injects DLLs or hides its code like a cheat loader,
  - when the tournament requires it, check your user folders and other drives for cheat files the same way
    (renamed programs, cheat tables, macro scripts, ZIP archives); only matching file names are sent,
  - take a screenshot every 20 seconds and send it to the tournament API server, if the referee turned recording on,
  - connect Dota 2's official Game State Integration (hero, match ID, Steam ID).
It does not read game memory, the contents of your documents, messages, browser history or your webcam.
Only findings and check-completion status leave this PC: never the full list of your programs or files.
An installed tool or a file on disk is not proof of cheating.
Reports and screenshots go to the server shown below and are deleted after 30 days unless staff place an evidence hold. Screenshots can include private notifications; close personal apps before playing.
Close this window or press Ctrl+C to stop. Stopping is logged for the referee.
`);
async function main() {
  if ((process.stdin.isTTY || args.interactive === true) && (!server || !code)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!server) server = monitorAddress((await rl.question('Tournament server address: ')).trim());
      if (!code) code = (await rl.question('Your 8-character match scan code: ')).trim().toUpperCase();
    } finally { rl.close(); }
  }
  if (!/^https?:\/\/[^\s/]+$/.test(server) || !/^[A-Za-z0-9]{8}$/.test(code)) {
    console.log('Open the app and enter the server address and match code, or run:\narenahub-agent --server https://<tournament server> --code <8-character code>');
    process.exit(1);
  }
  console.log(`Tournament server: ${server}. Verify this address with staff before agreeing.`);
  if (args.yes !== true) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Type YES to agree and start, or NO to decline: ')).trim().toUpperCase();
    rl.close();
    if (answer !== 'YES') {
      // Anything but YES is a decline. The referee is told, so they can arrange another way to play.
      if (answer === 'NO') {
        try {
          const declined = await api('/device/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
          console.log(declined.ok ? 'You declined. The referee has been told. Please go to the referee desk before your match.' : ((await declined.json() as any).error || 'Could not send your answer.'));
        } catch { console.log('Could not reach the tournament API server to send your answer. Tell the referee you declined.'); }
      } else console.log('Monitoring not started. Run the command again and type YES or NO.');
      process.exit(0);
    }
  }

  const claim = await api('/device/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device: { model: hostname().slice(0, 80), os: `Windows ${release()}`, agent: VERSION } }) });
  const session = await claim.json() as any;
  if (!claim.ok) { console.log(session.error || 'Pairing failed.'); process.exit(1); }
  console.log(`Paired: ${session.playerName} - ${session.matchLabel} (${session.gameLabel}). Monitoring until ${new Date(session.expiresAt).toLocaleTimeString()}.`);
  policy = scanPolicy(session.monitor);
  scanStamp = session.monitor?.scan;
  token = session.token; game = session.game; gsiToken = session.gsiToken || '';
  const remaining = Number(session.expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 12 * 3600_000) return stop('The match window is invalid or has closed.');
  // Consent ends at the claimed deadline even if the network never returns a 410 response.
  setTimeout(() => void stop('The match window closed.'), remaining).unref();
  await locateDota();
  if (policy.fileSweep) {
    console.log('This tournament requires the cheat-file check of your user folders and other drives. Files are read, never run or changed. Only matching file names are sent.');
    if (args.yes !== true) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      sweepAllowed = (await rl.question('Type YES to allow the folder check. Without it the scan cannot clear you for this match: ')).trim().toUpperCase() === 'YES';
      rl.close();
    } else sweepAllowed = true;
    if (!sweepAllowed) console.log('Folder check declined. The referee will see that the required check did not run.');
  }
  await installGsi();
  await heartbeat();
  setInterval(() => void heartbeat(), (session.heartbeatSeconds || 15) * 1000);
  if (session.record !== false) { void screenshot(); setInterval(() => void screenshot(), 20_000); }
  else console.log('The referee did not ask for screenshots for this match, so only program checks run.');
}
let token = '', gsiToken = '', game = '';
let steamPath = '', sweepAllowed = false;
/** `<library>/steamapps/common/dota 2 beta/game` for every Steam library that has Dota 2. */
let dotaGameDirs: string[] = [];
const scanWindows = createWindowsScanner(windowsProvider, { trustedRoots: () => dotaGameDirs });
const sha1 = cachedSha1();
let policy: ScanPolicy & { fileSweep?: boolean } = { blockedProcesses: [], blockedApplications: [], blockedFileHashes: [] };
let scanStamp: { challenge: string; policyVersion: string } | undefined;
const scanPolicy = (monitor: any): ScanPolicy & { fileSweep?: boolean } => ({ blockedProcesses: monitor.blockedProcesses || [], blockedApplications: monitor.blockedApplications || [], blockedFileHashes: monitor.blockedFileHashes || [], blockedModules: monitor.blockedModules || [], fileSweep: monitor.fileSweep === true });
let lastScreenshotOk = true, stopping = false, reporting = false, capturing = false;
let sweepCache: { at: number; key: string; findings: SweepFinding[]; status: 'complete' | 'partial' | 'failed' } | undefined;
let sweepRunning: Promise<void> | null = null;
let referencePrinted = false;

async function locateDota() {
  try { steamPath = (await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])).stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1].trim() || ''; } catch {}
  if (!steamPath) return;
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  dotaGameDirs = steamLibraries(steamPath, existsSync(vdfPath) ? readFileSync(vdfPath, 'utf8') : '')
    .map(library => join(library, 'steamapps', 'common', 'dota 2 beta', 'game'))
    .filter(dir => existsSync(join(dir, 'bin', 'win64', 'dota2.exe'))).slice(0, 3);
}

// ---- Dota 2 Game State Integration ----
const gsiFiles: string[] = [];
async function installGsi() {
  if (game !== 'dota2' || !gsiToken) return;
  if (!steamPath) { console.log('Steam was not found. Dota 2 live data will be missing; the referee will see this.'); return; }
  for (const gameDir of dotaGameDirs) {
    const cfg = join(gameDir, 'dota', 'cfg');
    if (!existsSync(cfg)) continue;
    const dir = join(cfg, 'gamestate_integration');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, GSI_FILE);
    writeFileSync(file, gsiConfig(server, gsiToken));
    gsiFiles.push(file);
  }
  console.log(gsiFiles.length ? 'Dota 2 live data connected. If Dota 2 is already open, restart it now so it loads the connection.' : 'Dota 2 was not found in your Steam libraries.');
}
function removeGsi() { for (const file of gsiFiles) { try { unlinkSync(file); } catch {} } }

// ---- Checks ----
async function dotaAudit(): Promise<{ audit: DotaAudit; status: 'complete' | 'partial' | 'failed' }> {
  const launchOptions = steamPath ? await windowsLaunchOptions(steamPath) : [];
  const result = mergeAudits(await Promise.all(dotaGameDirs.map(dir => auditDotaInstall(dir, { sha1, launchOptions }))));
  if (!referencePrinted && result.audit.found && result.audit.manifestSha256) {
    referencePrinted = true;
    // Staff can copy this from a Steam-verified organizer PC into the Match monitor reference list.
    console.log(`Dota 2 build ${result.audit.buildId || 'unknown'}; Valve file list SHA-256 ${result.audit.manifestSha256}.`);
  }
  return result;
}
async function fileSweep() {
  if (!policy.fileSweep) return { status: 'not-configured' as const, findings: [] };
  if (!sweepAllowed) return { status: 'failed' as const, findings: [] };
  const key = JSON.stringify([policy.blockedProcesses, policy.blockedApplications, policy.blockedFileHashes]);
  // The folder check can take a minute or two, so it runs beside the heartbeat instead of blocking it.
  // It reruns every 10 minutes or when the lists change; until the first pass ends the status is not-running.
  if (!sweepRunning && (!sweepCache || sweepCache.key !== key || Date.now() - sweepCache.at > 10 * 60_000)) {
    sweepRunning = sweepFolders(defaultSweepRoots(), { blockedProcesses: policy.blockedProcesses, blockedApplications: policy.blockedApplications || [], blockedFileHashes: policy.blockedFileHashes }, { signatures: paths => windowsProvider.signatures!(paths) })
      .then(result => {
        sweepCache = { at: Date.now(), key, findings: result.findings, status: result.status };
        console.log(`
Folder check finished: ${result.stats.entries} entries, ${result.findings.length} finding(s)${result.status === 'partial' ? ' (reached a time or size limit)' : ''}.`);
      })
      .catch(() => { sweepCache = { at: Date.now(), key, findings: [], status: 'failed' }; })
      .finally(() => { sweepRunning = null; });
  }
  if (!sweepCache || sweepCache.key !== key) return { status: 'not-running' as const, findings: [] };
  return { status: sweepCache.status, findings: sweepCache.findings };
}
async function snapshot() {
  const [observation, install, sweep] = await Promise.all([scanWindows(policy), dotaAudit(), fileSweep()]);
  return {
    platform: 'pc' as const,
    ...observation,
    dota: install.audit,
    ...(sweep.findings.length ? { fileFindings: sweep.findings } : {}),
    checks: { ...observation.checks, dotaFiles: install.status, fileSweep: sweep.status },
    screenshotOk: lastScreenshotOk,
    ...(scanStamp ? { scan: scanStamp } : {}),
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
  if (capturing || stopping) return;
  capturing = true;
  const file = join(tmpdir(), `arenahub-shot-${process.pid}.jpg`);
  try {
    await powershell(SCREENSHOT(file));
    const data = readFileSync(file);
    const response = await api('/device/media', { method: 'POST', token, headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(data) });
    if (response.status === 410) return stop('The match window closed.');
    lastScreenshotOk = response.ok;
  } catch { lastScreenshotOk = false; }
  finally { capturing = false; try { unlinkSync(file); } catch {} }
}
async function heartbeat() {
  if (reporting || stopping) return;
  reporting = true;
  try {
    const response = await api('/device/heartbeat', { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await snapshot()) });
    if (response.status === 410) return stop('The match window closed.');
    const body = await response.json() as any;
    if (response.ok) {
      if (body.monitor) {
        policy = scanPolicy(body.monitor); scanStamp = body.monitor.scan;
        if (policy.fileSweep && !sweepAllowed && args.yes === true) sweepAllowed = true;
      }
      const scan = body.scan;
      const message = scan ? `${scan.label}: ${scan.detail}` : 'Scan received. Keep this window open.';
      console.log(`\n${message}`);
      if (scan?.blockers?.length) for (const reason of scan.blockers) console.log(`  - ${reason}`);
    }
  } catch { process.stdout.write('\rCannot reach the tournament API server. Retrying...            '); }
  finally { reporting = false; }
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
