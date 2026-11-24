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
import { DEFAULT_MONITOR_CONFIG, monitorConfigSchema, type MonitorConfig } from '../../src/lib/integrityRisk';
import { PRACTICE_NOTE, practiceVerdict } from '../../src/lib/practiceScan';
import { codeFromFileName, dotaGameDirFromExe, downloadedFrom, isPackaged, parseLaunchLink, protocolRegistration, rememberedServer, rememberServer } from './launch';
import { startAgentWindow, type AgentWindow, type WindowAction, type WindowStep } from './agentWindow';
import { scanSteps, programsStep, dotaStep, sweepStep } from './agentSteps';

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

const OFFICIAL_NOTICE = `
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
`;
const interactive = process.stdin.isTTY || args.interactive === true;
/** The browser window, when one is open. The console keeps answering every question too. */
let win: AgentWindow | null = null;
async function ask(question: string, signal?: AbortSignal) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question, signal ? { signal } : {})).trim(); } finally { rl.close(); }
}
/**
 * Waits for whichever answers first: the console (when it can be typed in) or the window.
 * Returns the typed text, or the window's action.
 */
async function answer<T extends WindowAction['type']>(question: string | null, type: T): Promise<{ typed: string } | { action: Extract<WindowAction, { type: T }> }> {
  const fromWindow = win?.next(type).then(action => ({ action }));
  if (!question) return fromWindow || { typed: '' };
  if (!fromWindow) return { typed: await ask(question) };
  const abort = new AbortController();
  const typed = ask(question, abort.signal).then(text => ({ typed: text }), () => new Promise<never>(() => {}));
  const first = await Promise.race([typed, fromWindow]);
  if ('action' in first) { abort.abort(); process.stdout.write('\n'); }
  return first;
}
/** Shows a final message in the console and the window. */
function tell(message: string, phase: 'error' | 'declined' | 'ended' = 'error') {
  console.log(message);
  win?.set({ phase, message });
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** A window opened by a click closes when the agent exits, so keep the last message readable. */
async function finish(exitCode: number): Promise<never> {
  if (process.stdin.isTTY) await answer('\nPress Enter to close.', 'close');
  // Give the browser tab a moment to show the last state before the agent goes away.
  if (win) await pause(1500);
  return exitSafely(exitCode);
}
/**
 * Exiting at once while stdin or a socket is still closing trips a libuv assertion on Windows
 * (exit code 0xC0000409). Close what we own, let the event loop finish, and force it only as a backstop.
 */
function exitSafely(exitCode: number): Promise<never> {
  process.exitCode = exitCode;
  win?.close();
  process.stdin.destroy();
  setTimeout(() => process.exit(exitCode), 3000).unref();
  return new Promise<never>(() => {});
}
async function openWindow(link: boolean, practiceMode: boolean) {
  if (args['no-window'] === true || !(process.stdin.isTTY || link)) return;
  try {
    win = await startAgentWindow(practiceMode ? { mode: 'practice', phase: 'scanning', server, steps: scanSteps({ official: false, folders: false }) }
      : code ? { mode: 'official', phase: 'connecting', server, steps: [] }
      : { mode: null, phase: 'choose', server, steps: [] }, { open: process.env.ARENAHUB_NO_BROWSER !== '1' });
    console.log(`\nYour scan is open in your browser. If it did not open, paste this address into your browser:\n  ${win.url}\nKeep this window open: closing it stops the scan.\n`);
  } catch { win = null; }
}
/** Lets the ArenaHub website start this agent with one click. Per user, no admin rights needed. */
async function registerWebsiteStart() {
  if (!isPackaged()) return;
  try { for (const command of protocolRegistration(process.execPath)) await run('reg', command, { windowsHide: true }); } catch { /* One-click start is a convenience; typing still works. */ }
}
async function main() {
  void registerWebsiteStart();
  // Where the server and code come from, first match wins: the command line, a link from the ArenaHub
  // website, the downloaded file itself (its name and where it was downloaded from), then last time.
  const link = typeof args.link === 'string' ? parseLaunchLink(args.link) : null;
  if (!server && link?.server) server = link.server;
  if (!code && link?.code) code = link.code;
  if (!code && isPackaged()) code = codeFromFileName(process.execPath);
  if (!server && isPackaged()) server = downloadedFrom(process.execPath) || '';
  if (!server) server = rememberedServer() || '';

  let practiceMode = args.practice === true || link?.mode === 'practice';
  await openWindow(!!link, practiceMode);
  // Double-clicking a plain download gives nothing to go on, so the player chooses here.
  if (!practiceMode && !code && link?.mode !== 'scan' && (interactive || win)) {
    console.log('\nArenaHub Anti-cheat (PC)\n  1  Official match scan (needs your 8-character scan code from staff)\n  2  Practice scan (check this PC now, no code needed)');
    const choice = await answer(interactive ? 'Type 1 or 2: ' : null, 'choose');
    if ('typed' in choice) practiceMode = choice.typed === '2';
    else if (choice.action.mode === 'practice') practiceMode = true;
    else { code = choice.action.code; try { server = monitorAddress(choice.action.server); } catch { server = ''; } }
  }
  if (practiceMode) return practice();
  win?.set({ mode: 'official', phase: 'connecting', server });
  if (interactive && !server) { try { server = monitorAddress(await ask('Tournament server address: ')); } catch { /* Reported below. */ } }
  if (interactive && !code) code = (await ask('Your 8-character match scan code: ')).toUpperCase();
  if (!/^https?:\/\/[^\s/]+$/.test(server) || !/^[A-Za-z0-9]{8}$/.test(code)) {
    tell('Open the app and enter the server address and match code, or run:\narenahub-agent --server https://<tournament server> --code <8-character code>\nFor a practice scan with no code: arenahub-agent --practice [--server https://<tournament server>]');
    win?.set({ message: 'The server address or scan code is missing. Open your scan again from the ArenaHub page.' });
    return finish(1);
  }
  win?.set({ server });
  // Check the code before asking for consent, so a used or expired code is reported straight away,
  // and the player sees whose scan this is and whether the folder check is part of it.
  let folderCheck = true, info: any = {};
  try {
    const lookup = await api(`/device/pairing/${code}`);
    // An older server without this route answers with a plain page; the claim below still checks the code.
    info = await lookup.json().catch(() => ({})) as any;
    if (lookup.status === 404) { tell(info.error || 'That scan code is wrong, already used or expired. Ask staff for a new one.'); return finish(1); }
    if (lookup.ok) {
      if (info.platform !== 'pc') { tell(`This code is for ${info.platform === 'android' ? 'the Android app' : info.platform === 'ios' ? 'an iPhone' : 'a phone'}, not this PC. Open it on the device you play on.`); return finish(1); }
      console.log(`\nThis scan code is for ${info.playerName} - ${info.matchLabel} (${info.gameLabel}).`);
      if (typeof info.folderCheck === 'boolean') folderCheck = info.folderCheck;
    }
  } catch { tell(`Cannot reach ${server}. Check your internet connection.`); return finish(1); }
  console.log(OFFICIAL_NOTICE);
  console.log(`Tournament server: ${server}. Verify this address with staff before agreeing.`);
  if (args.yes !== true) {
    win?.set({ phase: 'consent', player: { name: info.playerName || '', match: info.matchLabel || '', game: info.gameLabel || '' }, folderCheck, record: info.record === true, dota: (info.game || 'dota2') === 'dota2', notice: OFFICIAL_NOTICE });
    const reply = await answer(folderCheck ? 'Type YES to agree and start (this includes the cheat-file folder check), or NO to decline: ' : 'Type YES to agree and start, or NO to decline: ', 'consent');
    const said = 'typed' in reply ? reply.typed.toUpperCase() : reply.action.answer.toUpperCase();
    if (said !== 'YES') {
      // Anything but YES is a decline. The referee is told, so they can arrange another way to play.
      if (said === 'NO') {
        try {
          const declined = await api('/device/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
          tell(declined.ok ? 'You declined. The referee has been told. Please go to the referee desk before your match.' : ((await declined.json() as any).error || 'Could not send your answer.'), declined.ok ? 'declined' : 'error');
        } catch { tell('Could not reach the tournament API server to send your answer. Tell the referee you declined.'); }
      } else tell('Monitoring not started. Open the scan again and type YES or NO.', 'ended');
      return finish(0);
    }
  }

  win?.set({ phase: 'connecting' });
  const claim = await api('/device/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device: { model: hostname().slice(0, 80), os: `Windows ${release()}`, agent: VERSION } }) });
  const session = await claim.json() as any;
  if (!claim.ok) { tell(session.error || 'Pairing failed.'); return finish(1); }
  rememberServer(server);
  console.log(`Paired: ${session.playerName} - ${session.matchLabel} (${session.gameLabel}). Monitoring until ${new Date(session.expiresAt).toLocaleTimeString()}.`);
  win?.set({ phase: 'scanning', player: { name: session.playerName, match: session.matchLabel, game: session.gameLabel }, expiresAt: Number(session.expiresAt) || undefined, steps: scanSteps({ official: true, folders: session.monitor?.fileSweep === true }) });
  if (win) void (async () => { await win!.next('stop'); await stop('You stopped the scan.', true); })();
  policy = scanPolicy(session.monitor);
  scanStamp = session.monitor?.scan;
  token = session.token; game = session.game; gsiToken = session.gsiToken || '';
  const remaining = Number(session.expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 12 * 3600_000) return stop('The match window is invalid or has closed.');
  // Consent ends at the claimed deadline even if the network never returns a 410 response.
  setTimeout(() => void stop('The match window closed.'), remaining).unref();
  await locateDota();
  if (policy.fileSweep) {
    // The player agreed to the folder check in the one consent question above. An older server does not
    // say in advance whether it is required, so then the player is asked here instead.
    sweepAllowed = args.yes === true || folderCheck || (await ask('This tournament requires the cheat-file check of your user folders and other drives. Type YES to allow it: ')).toUpperCase() === 'YES';
    console.log(sweepAllowed ? 'Checking your user folders and other drives for cheat files. Files are read, never run or changed. Only matching file names are sent.' : 'Folder check declined. The referee will see that the required check did not run.');
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
let sweepCache: { at: number; key: string; findings: SweepFinding[]; paths: string[]; entries: number; status: 'complete' | 'partial' | 'failed' } | undefined;
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
function connectGsi(gameDirs: string[]) {
  if (game !== 'dota2' || !gsiToken) return;
  for (const gameDir of gameDirs) {
    const cfg = join(gameDir, 'dota', 'cfg');
    if (!existsSync(cfg)) continue;
    const dir = join(cfg, 'gamestate_integration');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, GSI_FILE);
    writeFileSync(file, gsiConfig(server, gsiToken));
    gsiFiles.push(file);
  }
}
async function installGsi() {
  if (game !== 'dota2' || !gsiToken) return;
  connectGsi(dotaGameDirs);
  console.log(gsiFiles.length ? 'Dota 2 live data connected. If Dota 2 is already open, restart it now so it loads the connection.' : 'Dota 2 was not found in Steam\'s library list. Open Dota 2 now: the agent will find it from the running game.');
}
/**
 * Adds the folder of a running dota2.exe that Steam's library list did not include (computer shops often
 * keep games on another drive). Only a folder with Valve's dota.signatures file is accepted.
 */
async function findRunningDota() {
  let running: string[] = [];
  try { running = (await windowsProvider.processes()).filter(p => p.name.toLowerCase() === 'dota2.exe').map(p => dotaGameDirFromExe(p.path)).filter((dir): dir is string => !!dir); } catch { return; }
  const known = new Set(dotaGameDirs.map(dir => dir.toLowerCase()));
  const added = [...new Set(running)].filter(dir => !known.has(dir.toLowerCase()) && existsSync(join(dir, 'bin', 'win64', 'dota.signatures'))).slice(0, 3 - dotaGameDirs.length);
  if (!added.length) return;
  dotaGameDirs = [...dotaGameDirs, ...added];
  console.log(`Found Dota 2 from the running game: ${added.join(', ')}.`);
  const before = gsiFiles.length;
  connectGsi(added);
  if (gsiFiles.length > before) console.log('Dota 2 live data connected. Restart Dota 2 once so it loads the connection.');
}
function removeGsi() { for (const file of gsiFiles) { try { unlinkSync(file); } catch {} } }

// ---- Checks ----
async function dotaAudit(): Promise<{ audit: DotaAudit; status: 'complete' | 'partial' | 'failed' }> {
  await findRunningDota();
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
  if (!policy.fileSweep) { win?.step('folders', sweepStep('not-configured', 0)); return { status: 'not-configured' as const, findings: [] }; }
  if (!sweepAllowed) { win?.step('folders', sweepStep('not-allowed', 0)); return { status: 'failed' as const, findings: [] }; }
  const key = JSON.stringify([policy.blockedProcesses, policy.blockedApplications, policy.blockedFileHashes]);
  // The folder check can take a minute or two, so it runs beside the heartbeat instead of blocking it.
  // It reruns every 10 minutes or when the lists change; until the first pass ends the status is not-running.
  if (!sweepRunning && (!sweepCache || sweepCache.key !== key || Date.now() - sweepCache.at > 10 * 60_000)) {
    if (!sweepCache) win?.step('folders', sweepStep('not-running', 0));
    sweepRunning = sweepFolders(defaultSweepRoots(), { blockedProcesses: policy.blockedProcesses, blockedApplications: policy.blockedApplications || [], blockedFileHashes: policy.blockedFileHashes }, { signatures: paths => windowsProvider.signatures!(paths), onProgress: state => { if (!sweepCache) win?.step('folders', sweepStep('not-running', 0, state.entries)); } })
      .then(result => {
        sweepCache = { at: Date.now(), key, findings: result.findings, paths: result.paths, entries: result.stats.entries, status: result.status };
        win?.step('folders', sweepStep(result.status, result.findings.length, result.stats.entries));
        // Report the finished folder check now instead of waiting for the next scheduled report.
        if (token) void heartbeat();
        console.log(`
Folder check finished: ${result.stats.entries} entries, ${result.findings.length} finding(s)${result.status === 'partial' ? ' (reached a time or size limit)' : ''}.`);
      })
      .catch(() => { sweepCache = { at: Date.now(), key, findings: [], paths: [], entries: 0, status: 'failed' }; win?.step('folders', sweepStep('failed', 0)); })
      .finally(() => { sweepRunning = null; });
  }
  if (!sweepCache || sweepCache.key !== key) return { status: 'not-running' as const, findings: [] };
  // A flagged file the player has since deleted stops counting straight away, not at the next full check.
  const kept = sweepCache.findings.filter((_, index) => !sweepCache!.paths[index] || existsSync(sweepCache!.paths[index]));
  if (kept.length !== sweepCache.findings.length) {
    sweepCache = { ...sweepCache, findings: kept, paths: sweepCache.paths.filter(path => !path || existsSync(path)) };
    win?.step('folders', sweepStep(sweepCache.status, kept.length, sweepCache.entries));
  }
  return { status: sweepCache.status, findings: sweepCache.findings };
}
/** Shows a check as running only during the first pass, so later re-checks do not flicker in the window. */
function track<T>(key: string, work: Promise<T>, result: (value: T) => Partial<WindowStep>) {
  if (win?.state.steps.find(step => step.key === key)?.status === 'waiting') win.step(key, { status: 'running', detail: undefined });
  return work.then(value => { win?.step(key, result(value)); return value; });
}
async function snapshot() {
  const [observation, install, sweep] = await Promise.all([
    track('programs', scanWindows(policy), programsStep),
    track('dota', dotaAudit(), result => dotaStep(result.audit, result.status)),
    fileSweep(),
  ]);
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
let reportAgain = false;
async function heartbeat() {
  if (stopping) return;
  if (reporting) { reportAgain = true; return; }
  reporting = true;
  try {
    const facts = await snapshot();
    const response = await api('/device/heartbeat', { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(facts) });
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
      if (win && scan) {
        win.step('report', { status: scan.status === 'ready' ? 'done' : scan.status === 'blocked' ? 'failed' : 'warn', detail: `${scan.label}. Checked again every ${body.heartbeatSeconds || 15} seconds.` });
        // Stay on the scanning screen until the first folder check is done, instead of showing "incomplete".
        // Judged on the facts just sent: a folder check that finished after they were collected counts next report.
        const sweeping = facts.checks.fileSweep === 'not-running';
        win.set({ phase: sweeping ? 'scanning' : 'result', lastCheck: Date.now(), verdict: { status: scan.status, label: scan.label, detail: scan.detail, blockers: scan.blockers || [], warnings: scan.warnings || [], validUntil: scan.validUntil ?? null } });
      }
    } else if (win) win.step('report', { status: 'failed', detail: body.error || 'The tournament server refused this report.' });
  } catch {
    process.stdout.write('\rCannot reach the tournament API server. Retrying...            ');
    win?.step('report', { status: 'failed', detail: 'Cannot reach the tournament server. Retrying by itself.' });
  }
  finally {
    reporting = false;
    if (reportAgain) { reportAgain = false; void heartbeat(); }
  }
}
async function stop(reason: string, notify = false) {
  if (stopping) return; stopping = true;
  removeGsi();
  if (notify) { try { await api('/device/stop', { method: 'POST', token }); } catch {} }
  console.log(`\n${reason} Monitoring stopped.`);
  if (win) { win.set({ phase: 'ended', message: `${reason} Monitoring stopped.` }); await pause(1500); }
  process.exit(0);
}
// ---- Practice scan ----
// Runs every official check once and judges the result on this PC with the same rules the server uses.
// Nothing is sent: the server is only asked for its current lists, and only if an address was given.
let practicing = false;
async function practice() {
  practicing = true;
  win?.set({ mode: 'practice', phase: 'scanning', steps: scanSteps({ official: false, folders: false }) });
  console.log(`
ArenaHub practice scan (PC)
This checks this PC now, so you can fix problems before match day. It does not count for a match.
It checks running and installed programs, Dota 2 files if present, and any configured folder checks.
The result stays on this PC. Nothing is sent and no screenshots are taken.
`);
  // No questions: the server comes from the website link, the download or last time. Without one, the
  // lists built into the agent still catch the common tools.
  let config: MonitorConfig = DEFAULT_MONITOR_CONFIG;
  let source = 'the lists built into this agent (staff may have added more since; start the scan from the ArenaHub website for the latest)';
  if (server) {
    try {
      const response = await api('/practice/policy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'dota2' }) });
      const parsed = monitorConfigSchema.safeParse(((await response.json()) as any)?.config);
      if (response.ok && parsed.success) { config = parsed.data; source = `the current tournament lists from ${server}`; rememberServer(server); }
      else console.log('The tournament server did not send its lists.');
    } catch { console.log(`Cannot reach ${server}.`); }
  }
  console.log(`Checking against ${source}.`);
  policy = { blockedProcesses: config.pc.blockedProcesses.map(e => e.match), blockedApplications: (config.pc.blockedApplications || []).map(e => e.match), blockedFileHashes: (config.pc.blockedFileHashes || []).map(e => e.sha256), blockedModules: (config.pc.blockedModules || []).map(e => e.match), fileSweep: config.pc.fileSweep === true };
  const listsFrom = source.startsWith('the current') ? `the tournament lists from ${server}` : 'the lists built into this agent';
  for (;;) {
    // Every pass is a fresh scan: a player who just removed something must see it gone.
    sweepCache = undefined;
    win?.set({ mode: 'practice', phase: 'scanning', verdict: undefined, steps: scanSteps({ official: false, folders: policy.fileSweep === true }) });
    await locateDota();
    // Programs and game files are checked while the slower folder check runs.
    const early = Promise.all([track('programs', scanWindows(policy), programsStep), track('dota', dotaAudit(), result => dotaStep(result.audit, result.status, true))]);
    if (policy.fileSweep) {
      // Practice reads files on this PC and sends nothing, so starting it is the only consent it needs.
      sweepAllowed = true;
      console.log('Checking your user folders and other drives for cheat files (read only). This usually takes under two minutes...');
      // The official scan waits for the folder check to finish, so the practice scan does too.
      await fileSweep(); await sweepRunning;
    }
    console.log('Checking programs and Dota 2 files...');
    await early;
    win?.step('judge', { status: 'running' });
    const verdict = practiceVerdict('dota2', await snapshot(), config);
    console.log(`\n==== Practice result: ${verdict.label} ====\n${verdict.detail}`);
    if (verdict.blockers.length) { console.log('\nFix these before match day:'); for (const reason of verdict.blockers) console.log(`  - ${reason}`); }
    if (verdict.warnings.length) { console.log('\nWorth knowing (these do not stop you):'); for (const reason of verdict.warnings) console.log(`  - ${reason}`); }
    console.log(`\n${PRACTICE_NOTE}`);
    if (!win) return finish(0);
    win.step('judge', { status: verdict.status === 'ready' ? 'done' : verdict.status === 'blocked' ? 'failed' : 'warn', detail: `${verdict.label}. Judged on this PC; nothing was sent.` });
    win.set({ phase: 'result', verdict: { status: verdict.status, label: verdict.label, detail: verdict.detail, blockers: verdict.blockers, warnings: verdict.warnings, validUntil: null }, listsFrom, note: PRACTICE_NOTE });
    const closeFromWindow = win.next('close').then(action => ({ action }));
    const next = await Promise.race([answer(process.stdin.isTTY ? '\nPress Enter to close, or choose Scan again in your browser.' : null, 'rescan'), closeFromWindow]);
    if ('action' in next && next.action.type === 'rescan') { console.log('\nScanning again...'); continue; }
    await pause(800);
    // The console's "Press Enter" prompt is still open, so close stdin before leaving.
    return exitSafely(0);
  }
}

const quit = (reason: string) => practicing ? process.exit(0) : void stop(reason, true);
process.on('SIGINT', () => quit('You stopped the agent.'));
process.on('SIGTERM', () => quit('The agent was closed.'));
process.on('SIGHUP', () => quit('The window was closed.'));

main().catch(error => { console.log(`
The agent could not start: ${error instanceof Error ? error.message : error}`); removeGsi(); process.exit(1); });
