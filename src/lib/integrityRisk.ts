// Match Integrity Monitor: shared rules for turning device facts into explainable signals.
// ArenaHub cannot see inside MLBB, CODM or Dota 2. These checks describe the device around the
// game, and the score only decides how urgently a human referee should look. It never decides guilt.
import { z } from 'zod';

export const MONITOR_GAMES = ['mlbb', 'codm-br', 'codm-mp', 'dota2'] as const;
export type MonitorGame = typeof MONITOR_GAMES[number];
export type MonitorPlatform = 'android' | 'ios' | 'pc';
export const GAME_PLATFORM: Record<MonitorGame, MonitorPlatform> = { mlbb: 'android', 'codm-br': 'android', 'codm-mp': 'android', dota2: 'pc' };
/** iPhone admission uses a time-limited referee inspection and supervised recording. */
export const GAME_PLATFORMS: Record<MonitorGame, MonitorPlatform[]> = { mlbb: ['android', 'ios'], 'codm-br': ['android', 'ios'], 'codm-mp': ['android', 'ios'], dota2: ['pc'] };
export const PLATFORM_LABEL: Record<MonitorPlatform, string> = { android: 'Android', ios: 'iPhone', pc: 'PC' };
export const GAME_LABEL: Record<MonitorGame, string> = { mlbb: 'Mobile Legends', 'codm-br': 'CODM Battle Royale', 'codm-mp': 'CODM Multiplayer', dota2: 'Dota 2' };

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = typeof SEVERITIES[number];
export const SEVERITY_POINTS: Record<Severity, number> = { info: 0, low: 5, medium: 15, high: 35, critical: 100 };

export const SIGNAL_CATALOG = {
  'blocked-module': { severity: 'high', title: 'Restricted library loaded in the game', explain: 'A library loaded into Dota 2 matches a configured restricted-module name. Verify the match and restart the game after removing the restricted tool.' },
  'blocked-application-installed': { severity: 'medium', title: 'Listed software is installed', explain: 'A Windows installed-software entry matches the tournament blocklist. Installed is different from running, and legitimate tools can match.' },
  'blocked-file-hash': { severity: 'high', title: 'Listed executable fingerprint found', explain: 'A running executable matches a SHA-256 fingerprint explicitly configured by staff. Renaming a file does not change its fingerprint. Review the source of the blocklist and the evidence.' },
  'blocked-app-certificate': { severity: 'high', title: 'Listed Android signing certificate found', explain: 'An installed app matches a signing-certificate fingerprint configured by staff. A certificate can sign multiple apps; review the match before deciding.' },
  'checks-incomplete': { severity: 'medium', title: 'Some device checks did not complete', explain: 'The collector could not inspect everything required by the configured checks. Missing observations must not be treated as a clean device.' },
  'game-signature-mismatch': { severity: 'critical', title: 'Game signing certificate differs', explain: 'The reported signing certificate differs from the staff trust list. Check the game region, publisher and legitimate key rotation before concluding that a build was modified.' },
  'game-signature-unverified': { severity: 'info', title: 'Game signature not on the trusted list', explain: 'Staff have not marked this game signature as official yet, so it was recorded but not judged.' },
  'game-not-installed': { severity: 'low', title: 'Game app not found', explain: 'The expected game was not found on this phone, so the match may be played on another device.' },
  'cheat-tool-installed': { severity: 'high', title: 'Listed Android tool found', explain: 'An app on the staff blocklist is installed or active. These tools can have legitimate uses; installation does not establish cheating.' },
  'root-detected': { severity: 'high', title: 'Root indicators reported', explain: 'Device files or build metadata suggest elevated access. These are heuristics and can be hidden or produce false positives.' },
  'emulator-detected': { severity: 'high', title: 'Emulator indicators reported', explain: 'Device metadata resembles an emulator. Confirm the device and tournament rules before taking action.' },
  'accessibility-service': { severity: 'medium', title: 'Screen-control app enabled', explain: 'An app with accessibility access can tap and read the screen. Auto-tap and aim tools use this access, but so do some normal apps.' },
  'overlay-app': { severity: 'low', title: 'App allowed to draw over games', explain: 'An app can show content on top of the game. Chat heads use this, and so do some cheat menus.' },
  'developer-options': { severity: 'low', title: 'Developer options on', explain: 'Developer options were turned on during the match.' },
  'usb-debugging': { severity: 'medium', title: 'USB or wireless debugging on', explain: 'Debugging lets a computer control the phone during the match.' },
  'recording-stopped': { severity: 'medium', title: 'Screen recording stopped', explain: 'The match screen recording was not running when the phone reported in.' },
  'game-left-foreground': { severity: 'info', title: 'Another app was in front', explain: 'When the phone reported in, the game was not the app on screen.' },
  'heartbeat-lost': { severity: 'medium', title: 'Device stopped reporting', explain: 'The companion stopped reporting for longer than allowed during the match.' },
  'blocked-process': { severity: 'critical', title: 'Blocked program running', explain: 'A program on the staff blocklist (memory editors, injectors, debuggers, macro tools) was running during the match.' },
  'steam-account-mismatch': { severity: 'high', title: 'Different Steam account', explain: 'Dota 2 reported a different Steam account from the one registered for this player.' },
  'dota-not-running': { severity: 'low', title: 'Dota 2 not running', explain: 'The PC agent did not find Dota 2 running when it reported in.' },
  'screenshot-failed': { severity: 'low', title: 'Screenshot failed', explain: 'The PC agent could not capture the screen.' },
  'stat-outlier': { severity: 'low', title: 'Unusual stats for this player', explain: 'A stat from this match is far above the player\'s own recent average. Players have good games, so this is context only.' },
  'recording-refused': { severity: 'medium', title: 'Screen recording refused', explain: 'The player agreed to monitoring but did not allow screen recording when the phone asked.' },
  'game-sideloaded': { severity: 'medium', title: 'Game not installed from an app store', explain: 'The game was installed from a downloaded file or an unknown source instead of an app store. Modified game apps are spread this way, but some players install official files this way too.' },
  'monitoring-declined': { severity: 'medium', title: 'Player declined monitoring', explain: 'The player chose not to be monitored for this match. Declining is allowed and is not a penalty; arrange an organizer device or direct referee watch.' },
  'referee-observation': { severity: 'medium', title: 'Referee observation', explain: 'A referee watched the evidence and recorded something that matches a known cheat type.' },
  // Collector 3.2: Dota 2 install audit, user-folder libraries, optional cheat-file check, Android hooks.
  'dota-file-modified': { severity: 'critical', title: 'Dota 2 file differs from Valve\'s list', explain: 'A Dota 2 program file or gameinfo.gi does not match the SHA-1 list Valve ships with the game (game/bin/win64/dota.signatures), or that list is not the staff reference copy. Close Dota 2, run Steam > Dota 2 > Properties > Installed Files > Verify integrity, then rescan. A difference that remains after verification means the file was replaced.' },
  'dota-unlisted-binary': { severity: 'high', title: 'Extra program file beside Dota 2', explain: 'A DLL, ASI or EXE sits in a Dota 2 program folder but is not on Valve\'s shipped file list. Loaders hide cheats this way, for example a fake version.dll or dxgi.dll that Dota 2 loads at start. Graphics injectors such as ReShade use the same method. Remove the file, verify the game files and rescan.' },
  'dota-content-override': { severity: 'medium', title: 'Custom Dota 2 content folder', explain: 'A content pack (VPK) or search path that Valve does not ship was found in the Dota 2 folder. Visual mods and vision or particle changes are loaded this way. Remove the folder or file, verify the game files and rescan.' },
  'dota-launch-option': { severity: 'high', title: 'Restricted Dota 2 launch option', explain: '-insecure turns VAC off, sv_cheats unlocks cheat commands, and -language with a non-Valve name loads a custom content folder. Remove it under Steam > Dota 2 > Properties > Launch options and restart the game.' },
  'untrusted-game-module': { severity: 'high', title: 'Unsigned library from a user folder in Dota 2', explain: 'Dota 2 has loaded a library from outside Windows, Program Files and the game folder that has no valid digital signature. Injected cheats usually look like this. Some small overlay and hotkey tools do too: close the program that owns it and restart Dota 2.' },
  'cheat-file-found': { severity: 'high', title: 'File flagged for review', explain: 'The folder check found a file that matches a configured rule or a content indicator. Review the evidence and its severity.' },
  'hooking-framework': { severity: 'high', title: 'App-hooking framework on the phone', explain: 'Frida, Xposed/LSPosed, Zygisk, Riru or Substrate traces were found, or a Frida server answered on the phone. These frameworks change how other apps run, which is how most Android game mods and injectors work. Developers also use them.' },
  'suspicious-program-running': { severity: 'critical', title: 'Running program flagged for review', explain: 'A running program matched a configured rule or a content indicator. General-purpose software can contain some of these indicators.' },
  'virtual-container': { severity: 'high', title: 'Companion running inside a cloned or virtual space', explain: 'The companion appears to run inside an app cloner or virtual phone (for example Parallel Space or VMOS). A game inside such a container can be modified without the real phone showing it.' },
} as const satisfies Record<string, { severity: Severity; title: string; explain: string }>;
export type SignalId = keyof typeof SIGNAL_CATALOG;

// Every signal belongs to one category, so a player's risk can be read by area.
export const SIGNAL_CATEGORIES = ['game-build', 'cheat-tools', 'device', 'connection', 'behaviour'] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];
export const CATEGORY_LABEL: Record<SignalCategory, string> = { 'game-build': 'Game build', 'cheat-tools': 'Cheat tools', device: 'Device state', connection: 'Connection and recording', behaviour: 'Behaviour' };
export const SIGNAL_CATEGORY: Record<SignalId, SignalCategory> = {
  'game-signature-mismatch': 'game-build', 'game-signature-unverified': 'game-build', 'game-not-installed': 'game-build',
  'game-sideloaded': 'game-build',
  'cheat-tool-installed': 'cheat-tools', 'blocked-process': 'cheat-tools', 'blocked-module': 'cheat-tools',
  'blocked-application-installed': 'cheat-tools', 'blocked-file-hash': 'cheat-tools', 'blocked-app-certificate': 'cheat-tools', 'checks-incomplete': 'device',
  'root-detected': 'device', 'emulator-detected': 'device', 'accessibility-service': 'device', 'overlay-app': 'device', 'developer-options': 'device', 'usb-debugging': 'device',
  'recording-stopped': 'connection', 'game-left-foreground': 'connection', 'heartbeat-lost': 'connection', 'dota-not-running': 'connection', 'screenshot-failed': 'connection', 'recording-refused': 'connection', 'monitoring-declined': 'connection',
  'steam-account-mismatch': 'behaviour', 'stat-outlier': 'behaviour', 'referee-observation': 'behaviour',
  'dota-file-modified': 'game-build', 'dota-content-override': 'game-build', 'dota-launch-option': 'game-build',
  'dota-unlisted-binary': 'cheat-tools', 'untrusted-game-module': 'cheat-tools', 'cheat-file-found': 'cheat-tools', 'suspicious-program-running': 'cheat-tools', 'hooking-framework': 'cheat-tools',
  'virtual-container': 'device',
};

export interface Signal { id: SignalId; severity: Severity; evidence: string }

export interface BlockEntry { match: string; label: string; severity: Severity }
export interface FileHashEntry { sha256: string; label: string; severity: Severity }
export interface MonitorConfig {
  android: { games: { mlbb: GameIdentity; codm: GameIdentity }; blockedPackages: BlockEntry[]; trustedInstallers: string[]; blockedCertificates?: FileHashEntry[] };
  pc: {
    blockedProcesses: BlockEntry[]; blockedApplications?: BlockEntry[]; blockedFileHashes?: FileHashEntry[]; blockedModules?: BlockEntry[];
    /** Content-based cheat-file check of the user profile and other drives. On by default (2026-11-17 tournament rule); players must agree. */
    fileSweep?: boolean;
    /** SHA-256 of game/bin/win64/dota.signatures from a Steam-verified reference PC, per Dota build. */
    trustedDotaManifests?: FileHashEntry[];
  };
  thresholds: { watch: number; review: number; urgent: number };
}
export interface GameIdentity { packages: string[]; trustedCertSha256: string[] }

const severity = z.enum(SEVERITIES);
const blockEntry = z.object({ match: z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z0-9._\- ]+\*?$/), label: z.string().trim().min(2).max(80), severity });
const certHash = z.string().regex(/^[0-9a-f]{64}$/);
const fileHashEntry = z.object({ sha256: z.string().trim().toLowerCase().pipe(certHash), label: z.string().trim().min(2).max(80), severity });
export const DEFAULT_BLOCKED_APPLICATIONS: BlockEntry[] = [
  { match: 'cheat engine*', label: 'Cheat Engine installation', severity: 'medium' },
  { match: 'artmoney*', label: 'ArtMoney installation', severity: 'medium' },
  { match: 'extreme injector*', label: 'Injector installation', severity: 'medium' },
  { match: 'autohotkey*', label: 'AutoHotkey installation (legitimate uses exist)', severity: 'low' },
];
// Published Cheat Engine module names. Renamed or manually mapped libraries need other indicators.
export const DEFAULT_BLOCKED_MODULES: BlockEntry[] = [
  { match: 'speedhack-x86_64.dll', label: 'Cheat Engine speed modifier library', severity: 'high' },
  { match: 'speedhack-i386.dll', label: 'Cheat Engine speed modifier library', severity: 'high' },
];
const gameIdentity = z.object({ packages: z.array(z.string().regex(/^[a-zA-Z0-9._]{3,150}$/)).min(1).max(10), trustedCertSha256: z.array(certHash).max(20) });
// App stores that ship the official MLBB and CODM builds. A game installed by anything else is "sideloaded".
export const DEFAULT_TRUSTED_INSTALLERS = ['com.android.vending', 'com.huawei.appmarket', 'com.sec.android.app.samsungapps', 'com.xiaomi.market', 'com.xiaomi.mipicks', 'com.heytap.market', 'com.oppo.market', 'com.bbk.appstore', 'com.hihonor.appmarket', 'com.transsnet.store', 'com.amazon.venezia'];
export const monitorConfigSchema = z.object({
  android: z.object({ games: z.object({ mlbb: gameIdentity, codm: gameIdentity }), blockedPackages: z.array(blockEntry).max(300), trustedInstallers: z.array(z.string().regex(/^[a-zA-Z0-9._]{3,150}$/)).max(40).default(DEFAULT_TRUSTED_INSTALLERS), blockedCertificates: z.array(fileHashEntry).max(300).default([]) }),
  pc: z.object({ blockedProcesses: z.array(blockEntry).max(300), blockedApplications: z.array(blockEntry).max(300).default(DEFAULT_BLOCKED_APPLICATIONS), blockedFileHashes: z.array(fileHashEntry).max(300).default([]), blockedModules: z.array(blockEntry).max(300).default(DEFAULT_BLOCKED_MODULES), fileSweep: z.boolean().default(true), trustedDotaManifests: z.array(fileHashEntry).max(50).default([]) }),
  thresholds: z.object({ watch: z.number().int().min(1).max(100), review: z.number().int().min(1).max(100), urgent: z.number().int().min(1).max(100) }).refine(t => t.watch < t.review && t.review < t.urgent, 'Thresholds must increase: watch < review < urgent.'),
});

// Starter lists. Staff should review them on the Match monitor page before the first event;
// package names of cheat tools change often, and a trailing * matches a prefix.
export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  android: {
    games: {
      mlbb: { packages: ['com.mobile.legends'], trustedCertSha256: [] },
      codm: { packages: ['com.activision.callofduty.shooter', 'com.garena.game.codm'], trustedCertSha256: [] },
    },
    blockedPackages: [
      { match: 'catch_.me_.if_.you_.can_', label: 'GameGuardian (memory editor)', severity: 'high' },
      { match: 'com.gameguardian*', label: 'GameGuardian (memory editor)', severity: 'high' },
      { match: 'com.cih.game_cih', label: 'Game Killer (memory editor)', severity: 'high' },
      { match: 'org.sbtools.gamehack', label: 'SB Game Hacker', severity: 'high' },
      { match: 'com.xmodgame', label: 'Xmodgames', severity: 'high' },
      { match: 'com.chelpus.lackypatch', label: 'Lucky Patcher', severity: 'high' },
      { match: 'com.android.vending.billing.inappbillingservice.luck', label: 'Lucky Patcher', severity: 'high' },
      { match: 'de.robv.android.xposed.installer', label: 'Xposed installer', severity: 'high' },
      { match: 'org.lsposed.manager', label: 'LSPosed', severity: 'high' },
      { match: 'io.va.exposed*', label: 'VirtualXposed', severity: 'high' },
      { match: 'com.topjohnwu.magisk', label: 'Magisk (root manager)', severity: 'high' },
      { match: 'eu.chainfire.supersu', label: 'SuperSU (root manager)', severity: 'high' },
      { match: 'com.kingroot.kinguser', label: 'KingRoot (root manager)', severity: 'high' },
      { match: 'com.lbe.parallel*', label: 'Parallel Space (app cloner)', severity: 'medium' },
      { match: 'com.ludashi.dualspace*', label: 'Dual Space (app cloner)', severity: 'medium' },
      { match: 'com.truedevelopersstudio.automatictap*', label: 'Auto Clicker', severity: 'high' },
      // Privileged tooling and virtualization are policy indicators, not proof of game modification.
      { match: 'moe.shizuku.privileged.api', label: 'Shizuku (privileged debugging service)', severity: 'high' },
      { match: 'com.vmos*', label: 'VMOS (virtual phone inside the phone)', severity: 'high' },
      // 3.2 additions. Verify each package on a test phone before an event; publishers of these tools rename them.
      { match: 'org.lsposed.lspatch', label: 'LSPatch (patches hook modules into apps without root)', severity: 'high' },
      { match: 'me.weishu.kernelsu', label: 'KernelSU (root manager)', severity: 'high' },
      { match: 'me.bmax.apatch', label: 'APatch (root manager)', severity: 'high' },
      { match: 'io.github.vvb2060.magisk', label: 'Magisk Alpha (root manager)', severity: 'high' },
      { match: 'com.chaozhuo.gameassistant*', label: 'Octopus (key mapper)', severity: 'medium' },
      { match: 'app.mantispro.gamepad', label: 'Mantis Gamepad (key mapper)', severity: 'medium' },
      { match: 'com.vphonegaga*', label: 'VPhoneGaga (virtual phone)', severity: 'high' },
      { match: 'com.termux', label: 'Termux (terminal; can run scripts and Frida)', severity: 'low' },
    ],
    trustedInstallers: DEFAULT_TRUSTED_INSTALLERS,
    blockedCertificates: [],
  },
  pc: {
    blockedModules: DEFAULT_BLOCKED_MODULES,
    blockedApplications: DEFAULT_BLOCKED_APPLICATIONS,
    blockedFileHashes: [],
    fileSweep: true,
    trustedDotaManifests: [],
    blockedProcesses: [
      { match: 'cheatengine*', label: 'Cheat Engine', severity: 'critical' },
      { match: 'artmoney*', label: 'ArtMoney (memory editor)', severity: 'critical' },
      { match: 'extreme injector*', label: 'Extreme Injector', severity: 'critical' },
      { match: 'extremeinjector*', label: 'Extreme Injector', severity: 'critical' },
      { match: 'xenos*', label: 'Xenos injector', severity: 'critical' },
      { match: 'x64dbg.exe', label: 'x64dbg (debugger)', severity: 'high' },
      { match: 'x32dbg.exe', label: 'x32dbg (debugger)', severity: 'high' },
      { match: 'ollydbg.exe', label: 'OllyDbg (debugger)', severity: 'high' },
      { match: 'processhacker.exe', label: 'Process Hacker', severity: 'medium' },
      { match: 'systeminformer.exe', label: 'System Informer', severity: 'medium' },
      { match: 'autohotkey*', label: 'AutoHotkey (macros)', severity: 'medium' },
      { match: 'wemod.exe', label: 'WeMod (trainer)', severity: 'high' },
    ],
  },
  thresholds: { watch: 15, review: 35, urgent: 70 },
};

export function matchesEntry(name: string, entry: Pick<BlockEntry, 'match'>) {
  const value = name.trim().toLowerCase();
  return entry.match.endsWith('*') ? value.startsWith(entry.match.slice(0, -1)) : value === entry.match;
}
export const findEntry = (name: string, entries: BlockEntry[]) => entries.find(entry => matchesEntry(name, entry));

const shortText = z.string().trim().max(200);
const packageName = z.string().regex(/^[a-zA-Z0-9._]{2,200}$/);
const scanStamp = z.object({ challenge: z.string().regex(/^[a-f0-9]{48}$/), policyVersion: certHash });
export const androidFactsSchema = z.object({
  platform: z.literal('android'),
  games: z.array(z.object({ packageName, versionName: shortText.optional(), certSha256: z.array(z.string().toLowerCase().pipe(certHash)).max(5), installer: packageName.optional() })).max(10),
  installedFlagged: z.array(packageName).max(100),
  rootIndicators: z.array(shortText).max(20),
  emulatorIndicators: z.array(shortText).max(20),
  accessibilityServices: z.array(shortText).max(50),
  overlayPackages: z.array(packageName).max(100),
  developerOptions: z.boolean(),
  usbDebugging: z.boolean(),
  recording: z.boolean(),
  recordingRefused: z.boolean().optional(),
  foregroundPackage: packageName.optional(),
  blockedCertificateMatches: z.array(z.object({ packageName, sha256: certHash })).max(100).optional(),
  checks: z.object({ installedApps: z.boolean(), gameSignatures: z.boolean(), overlays: z.boolean(), certificates: z.boolean() }).optional(),
  hookIndicators: z.array(shortText).max(20).optional(),
  virtualIndicators: z.array(shortText).max(20).optional(),
  scan: scanStamp.optional(),
});
const checkStatus = z.enum(['complete', 'partial', 'failed', 'not-configured', 'not-running']);
export const SWEEP_FOLDERS = ['Desktop', 'Downloads', 'Documents', 'Temp', 'User folders', 'App data', 'Other drive'] as const;
/** Dota 2 install audit. Paths are relative to the game folder and never include the user's profile path. */
const dotaAuditSchema = z.object({
  found: z.boolean(),
  buildId: z.string().regex(/^\d{1,12}$/).optional(),
  updatePending: z.boolean().optional(),
  manifestSha256: certHash.optional(),
  modifiedFiles: z.array(shortText).max(50),
  missingFiles: z.array(shortText).max(50),
  unlistedBinaries: z.array(shortText).max(50),
  contentOverrides: z.array(shortText).max(50),
  launchFlags: z.array(shortText).max(20),
});
export const pcFactsSchema = z.object({
  platform: z.literal('pc'),
  processes: z.array(z.object({ name: shortText.min(1), path: z.string().max(400).optional(), signer: shortText.optional(), sha256: certHash.optional() })).max(50),
  installedApplications: z.array(z.object({ name: shortText.min(1), version: shortText.optional() })).max(100).optional(),
  loadedModules: z.array(z.object({ name: shortText.min(1), process: z.literal('dota2.exe'), sha256: certHash.optional() })).max(50).optional(),
  untrustedModules: z.array(z.object({ name: shortText.min(1), status: shortText, signer: shortText.optional(), sha256: certHash.optional() })).max(50).optional(),
  dota: dotaAuditSchema.optional(),
  fileFindings: z.array(z.object({ name: shortText.min(1), folder: z.enum(SWEEP_FOLDERS), reason: shortText.min(1), sha256: certHash.optional(), listedAs: shortText.optional(), severity: z.enum(['low', 'medium', 'high']).optional() })).max(50).optional(),
  suspiciousPrograms: z.array(z.object({ name: shortText.min(1), reason: shortText.min(1), listedAs: shortText.optional(), severity: z.enum(['low', 'medium', 'high']), sha256: certHash.optional() })).max(50).optional(),
  checks: z.object({ processes: checkStatus, installedApplications: checkStatus, fileHashes: checkStatus, modules: checkStatus.optional(), moduleSigners: checkStatus.optional(), dotaFiles: checkStatus.optional(), fileSweep: checkStatus.optional(), programContent: checkStatus.optional() }).optional(),
  gameRunning: z.boolean(),
  screenshotOk: z.boolean(),
  scan: scanStamp.optional(),
});
export const deviceFactsSchema = z.discriminatedUnion('platform', [androidFactsSchema, pcFactsSchema]);
export type AndroidFacts = z.infer<typeof androidFactsSchema>;
export type PcFacts = z.infer<typeof pcFactsSchema>;
export type DeviceFacts = z.infer<typeof deviceFactsSchema>;

export function inspectionCoverage(platform: MonitorPlatform, facts: unknown): { status: 'unavailable' | 'not-reported' | 'limited' | 'reported'; detail: string } {
  if (platform === 'ios') return { status: 'unavailable', detail: 'Apple does not let any app inspect an iPhone, so installed apps and game memory cannot be checked. The player confirms the iPhone settings at check-in and staff watch the live screen; a referee check is optional.' };
  if (!facts || typeof facts !== 'object') return { status: 'not-reported', detail: 'No device inspection report has arrived yet.' };
  const checks = (facts as { checks?: Record<string, unknown> }).checks;
  if (!checks) return { status: 'limited', detail: 'This collector did not report its inspection coverage. Update the companion before relying on its results.' };
  const OPTIONAL_PC = ['fileHashes', 'modules', 'moduleSigners', 'dotaFiles', 'fileSweep', 'programContent'];
  const expected = platform === 'pc' ? ['processes', 'installedApplications', 'fileHashes', ...OPTIONAL_PC.slice(1).filter(key => checks[key])] : ['installedApps', 'gameSignatures', 'overlays', 'certificates'];
  const limited = expected.some(key => platform === 'pc' ? checks[key] !== 'complete' && !(OPTIONAL_PC.includes(key) && checks[key] === 'not-configured') && !(['modules', 'moduleSigners'].includes(key) && checks[key] === 'not-running' && (facts as PcFacts).gameRunning === false) : checks[key] !== true);
  if (limited) return { status: 'limited', detail: 'Some configured checks could not complete. An empty finding list does not establish a clean device.' };
  return { status: 'reported', detail: platform === 'pc' && checks.fileHashes === 'not-configured' ? 'Process and registered-software checks reported. No executable fingerprints are configured. Reports are supplied by the device, not hardware-attested.' : 'Configured checks reported. Hidden tools and modified collectors can evade these checks; this is not a cheat-free certificate.' };
}

const signal = (id: SignalId, evidence: string, level: Severity = SIGNAL_CATALOG[id].severity): Signal => ({ id, severity: level, evidence: evidence.slice(0, 200) });
// The fingerprint goes last and is never cut off by the 200-character limit, so staff can always add it to the list.
const HASH_SUFFIX = ' SHA-256 '.length + 64;
const withHash = (text: string, sha256?: string) => sha256 ? `${text.slice(0, 200 - HASH_SUFFIX)} SHA-256 ${sha256}` : text;

/** Findings about one file on a PC. A referee who confirms one can add its fingerprint, so renamed copies on other PCs are caught. */
export const FINGERPRINTABLE_SIGNALS: ReadonlySet<string> = new Set<SignalId>(['cheat-file-found', 'suspicious-program-running', 'untrusted-game-module']);
export function reportedFingerprint(signal: { id: string; evidence: string }): string | undefined {
  return FINGERPRINTABLE_SIGNALS.has(signal.id) ? /SHA-256 ([0-9a-f]{64})$/.exec(signal.evidence)?.[1] : undefined;
}

/** Turns one device report into signals. The server re-checks every list against its own config. */
export function evaluateFacts(facts: DeviceFacts, config: MonitorConfig, game: MonitorGame, options: { recordingRequired?: boolean } = {}): Signal[] {
  const recordingRequired = options.recordingRequired ?? true;
  const out: Signal[] = [];
  if (facts.platform === 'pc') {
    for (const process of facts.processes) {
      const entry = findEntry(process.name, config.pc.blockedProcesses);
      if (entry) out.push(signal('blocked-process', `${entry.label}: ${process.name}${process.signer ? ` (signed by ${process.signer})` : ' (signature not checked)'}`, entry.severity));
      const hash = process.sha256 && config.pc.blockedFileHashes?.find(entry => entry.sha256 === process.sha256);
      if (hash) out.push(signal('blocked-file-hash', `${hash.label}: ${process.name} SHA-256 ${process.sha256}`, hash.severity));
    }
    for (const app of facts.installedApplications || []) {
      const entry = findEntry(app.name, config.pc.blockedApplications || []);
      if (entry) out.push(signal('blocked-application-installed', `${entry.label}: ${app.name}${app.version ? ` ${app.version}` : ''} (installed; execution not established)`, entry.severity));
    }
    for (const module of facts.loadedModules || []) {
      const entry = findEntry(module.name, config.pc.blockedModules || []);
      if (entry) out.push(signal('blocked-module', `${entry.label}: ${module.name} loaded in ${module.process}`, entry.severity));
      const hash = module.sha256 && config.pc.blockedFileHashes?.find(entry => entry.sha256 === module.sha256);
      if (hash) out.push(signal('blocked-file-hash', `${hash.label}: ${module.name} loaded in ${module.process} SHA-256 ${module.sha256}`, hash.severity));
    }
    for (const module of facts.untrustedModules || []) {
      const hash = module.sha256 && config.pc.blockedFileHashes?.find(entry => entry.sha256 === module.sha256);
      out.push(signal('untrusted-game-module', withHash(`${module.name} in dota2.exe: ${module.status}${module.signer ? `, signer ${module.signer}` : ''}${hash ? ` (matches ${hash.label})` : ''}`, module.sha256), hash ? 'critical' : undefined));
    }
    const dota = facts.dota;
    if (dota?.found) {
      // A half-applied Steam update can also leave files out of step with the list; it still needs fixing before play.
      const fileLevel: Severity | undefined = dota.updatePending ? 'medium' : undefined;
      const pending = dota.updatePending ? ' (Steam reports an update pending)' : '';
      if (dota.modifiedFiles.length) out.push(signal('dota-file-modified', `Differs from Valve list: ${dota.modifiedFiles.join(', ')}${pending}`, fileLevel));
      if (dota.missingFiles.length) out.push(signal('dota-file-modified', `Missing from the install: ${dota.missingFiles.join(', ')}${pending}`, fileLevel));
      const references = config.pc.trustedDotaManifests || [];
      if (references.length && dota.manifestSha256 && !references.some(entry => entry.sha256 === dota.manifestSha256)) out.push(signal('dota-file-modified', `dota.signatures SHA-256 ${dota.manifestSha256} is not a staff reference copy${dota.buildId ? ` (build ${dota.buildId})` : ''}`, 'high'));
      for (const file of dota.unlistedBinaries) out.push(signal('dota-unlisted-binary', `${file} is not on Valve's file list`));
      for (const item of dota.contentOverrides) out.push(signal('dota-content-override', item));
      for (const flag of dota.launchFlags) out.push(signal('dota-launch-option', flag, /insecure|sv_cheats/i.test(flag) ? 'high' : 'medium'));
    }
    const listedEntry = (value?: string) => value ? findEntry(value, config.pc.blockedProcesses) || findEntry(value, config.pc.blockedApplications || []) : undefined;
    for (const file of facts.fileFindings || []) {
      const hash = file.sha256 ? config.pc.blockedFileHashes?.find(entry => entry.sha256 === file.sha256) : undefined;
      const entry = listedEntry(file.listedAs);
      // A listed name the server does not recognise any more (list changed) is not reported.
      if (file.listedAs && !entry && !hash) continue;
      out.push(signal('cheat-file-found', withHash(`${file.folder}: ${file.name} - ${hash ? hash.label : entry ? `${file.reason}: ${entry.label}` : file.reason}`, file.sha256), hash?.severity || entry?.severity || file.severity));
    }
    for (const program of facts.suspiciousPrograms || []) {
      const entry = listedEntry(program.listedAs);
      const hash = program.sha256 ? config.pc.blockedFileHashes?.find(entry => entry.sha256 === program.sha256) : undefined;
      if (program.listedAs && !entry && !hash) continue;
      const severity = hash?.severity ?? entry?.severity ?? (program.severity === 'high' ? 'critical' : program.severity);
      out.push(signal('suspicious-program-running', withHash(`${program.name}: ${hash?.label ?? (entry ? `${program.reason}: ${entry.label}` : program.reason)}`, program.sha256), severity));
    }
    if (facts.checks && Object.values(facts.checks).some(status => status === 'failed' || status === 'partial')) out.push(signal('checks-incomplete', Object.entries(facts.checks).filter(([, state]) => state === 'failed' || state === 'partial').map(([name, state]) => `${name}: ${state}`).join(', ')));
    if (game === 'dota2' && !facts.gameRunning) out.push(signal('dota-not-running', 'dota2.exe was not running'));
    if (recordingRequired && !facts.screenshotOk) out.push(signal('screenshot-failed', 'Screen capture failed on this report'));
    return out;
  }
  const identity = game === 'mlbb' ? config.android.games.mlbb : config.android.games.codm;
  if (facts.checks && Object.values(facts.checks).some(complete => !complete)) out.push(signal('checks-incomplete', Object.entries(facts.checks).filter(([, complete]) => !complete).map(([name]) => name).join(', ')));
  for (const match of facts.blockedCertificateMatches || []) {
    const entry = config.android.blockedCertificates?.find(entry => entry.sha256 === match.sha256);
    if (entry) out.push(signal('blocked-app-certificate', `${entry.label}: ${match.packageName} certificate SHA-256 ${match.sha256}`, entry.severity));
  }
  const installed = facts.games.filter(g => identity.packages.includes(g.packageName));
  // Players read this on their phone, so it names the game first and the package for staff after.
  if (!installed.length && facts.checks?.installedApps !== false && facts.checks?.gameSignatures !== false) out.push(signal('game-not-installed', `${game === 'mlbb' ? 'Mobile Legends' : 'Call of Duty: Mobile'} is not installed on this phone (looked for ${identity.packages.join(', ')})`));
  for (const app of installed) {
    const label = `${app.packageName}${app.versionName ? ` ${app.versionName}` : ''}`;
    if (!app.certSha256.length) out.push(signal('checks-incomplete', `${label}: no signing certificate reported`));
    else if (!identity.trustedCertSha256.length) out.push(signal('game-signature-unverified', `${label} cert ${app.certSha256[0]}`));
    else if (!app.certSha256.some(cert => identity.trustedCertSha256.includes(cert))) out.push(signal('game-signature-mismatch', `${label} cert ${app.certSha256[0]}`));
    if (!app.installer) out.push(signal('game-sideloaded', `${label}: installed from a file or unknown source`));
    else if (!config.android.trustedInstallers.includes(app.installer)) out.push(signal('game-sideloaded', `${label}: installed by ${app.installer}`));
  }
  for (const name of facts.installedFlagged) {
    const entry = findEntry(name, config.android.blockedPackages);
    if (entry) out.push(signal('cheat-tool-installed', `${entry.label}: ${name}`, entry.severity));
  }
  for (const service of facts.accessibilityServices) {
    const owner = service.split('/')[0];
    const entry = findEntry(owner, config.android.blockedPackages);
    out.push(entry ? signal('cheat-tool-installed', `${entry.label} has screen control: ${service}`, entry.severity) : signal('accessibility-service', service));
  }
  for (const name of facts.overlayPackages) {
    const entry = findEntry(name, config.android.blockedPackages);
    if (!entry) out.push(signal('overlay-app', name));
  }
  if (facts.hookIndicators?.length) out.push(signal('hooking-framework', facts.hookIndicators.join(', ')));
  if (facts.virtualIndicators?.length) out.push(signal('virtual-container', facts.virtualIndicators.join(', ')));
  if (facts.rootIndicators.length) out.push(signal('root-detected', facts.rootIndicators.join(', ')));
  if (facts.emulatorIndicators.length) out.push(signal('emulator-detected', facts.emulatorIndicators.join(', ')));
  if (facts.developerOptions) out.push(signal('developer-options', 'Developer options enabled'));
  if (facts.usbDebugging) out.push(signal('usb-debugging', 'USB or wireless debugging enabled'));
  if (facts.recordingRefused) out.push(signal('recording-refused', 'The player did not allow screen recording'));
  else if (recordingRequired && !facts.recording) out.push(signal('recording-stopped', 'Recording was off at this report'));
  if (facts.foregroundPackage && !identity.packages.includes(facts.foregroundPackage) && facts.foregroundPackage !== 'ph.edu.wmsu.arenahub.companion') out.push(signal('game-left-foreground', facts.foregroundPackage));
  return out;
}

export type RiskLevel = 'clear' | 'watch' | 'review' | 'urgent';
export interface RiskResult { score: number; level: RiskLevel; reasons: { id: SignalId; severity: Severity; points: number; title: string; category: SignalCategory }[]; categories: Record<SignalCategory, number> }

/** Each kind of signal counts once, at its worst severity, so one noisy check cannot dominate. */
export function scoreSignals(signals: Pick<Signal, 'id' | 'severity'>[], thresholds = DEFAULT_MONITOR_CONFIG.thresholds): RiskResult {
  const worst = new Map<SignalId, Severity>();
  for (const s of signals) if (!worst.has(s.id) || SEVERITY_POINTS[s.severity] > SEVERITY_POINTS[worst.get(s.id)!]) worst.set(s.id, s.severity);
  const reasons = [...worst].map(([id, level]) => ({ id, severity: level, points: SEVERITY_POINTS[level], title: SIGNAL_CATALOG[id].title, category: SIGNAL_CATEGORY[id] })).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  const level: RiskLevel = score >= thresholds.urgent ? 'urgent' : score >= thresholds.review ? 'review' : score >= thresholds.watch ? 'watch' : 'clear';
  const categories = Object.fromEntries(SIGNAL_CATEGORIES.map(c => [c, Math.min(100, reasons.filter(r => r.category === c).reduce((sum, r) => sum + r.points, 0))])) as Record<SignalCategory, number>;
  return { score, level, reasons, categories };
}

// Dota 2 Game State Integration (Valve's official local data feed).
export interface GsiSummary { matchId: string; steamId: string; playerName: string; hero: string; gameState: string; clockTime: number | null }
export function parseGsi(payload: any): GsiSummary | null {
  if (!payload || typeof payload !== 'object' || payload.provider?.appid !== 570) return null;
  const text = (value: unknown, max = 80) => typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '';
  return {
    matchId: /^\d{1,20}$/.test(text(payload.map?.matchid)) ? text(payload.map?.matchid) : '',
    steamId: /^\d{17}$/.test(text(payload.player?.steamid)) ? text(payload.player?.steamid) : '',
    playerName: text(payload.player?.name),
    hero: text(payload.hero?.name).replace(/^npc_dota_hero_/, ''),
    gameState: text(payload.map?.game_state).replace(/^DOTA_GAMERULES_STATE_/, ''),
    clockTime: Number.isFinite(payload.map?.clock_time) ? payload.map.clock_time : null,
  };
}
export function evaluateGsi(summary: GsiSummary, expectedSteamId: string): Signal[] {
  return expectedSteamId && summary.steamId && summary.steamId !== expectedSteamId ? [signal('steam-account-mismatch', `Expected ${expectedSteamId}, Dota 2 reported ${summary.steamId}`)] : [];
}

// OpenDota post-match check: compares this match with the player's own recent games.
export const steamIdToAccountId = (steamId: string) => /^\d{17}$/.test(steamId) ? String(BigInt(steamId) - 76561197960265728n) : '';
export const OUTLIER_STATS = ['kills', 'last_hits', 'gold_per_min', 'xp_per_min', 'hero_damage'] as const;
export function statOutliers(current: Record<string, unknown>, history: Record<string, unknown>[], limit = 3): Signal[] {
  const out: Signal[] = [];
  for (const stat of OUTLIER_STATS) {
    const value = Number(current[stat]);
    const past = history.map(row => Number(row[stat])).filter(Number.isFinite);
    if (!Number.isFinite(value) || past.length < 5) continue;
    const mean = past.reduce((a, b) => a + b, 0) / past.length;
    const sd = Math.sqrt(past.reduce((a, b) => a + (b - mean) ** 2, 0) / past.length);
    if (sd === 0) continue;
    const z = (value - mean) / sd;
    if (z > limit) out.push(signal('stat-outlier', `${stat.replaceAll('_', ' ')} ${Math.round(value)} vs usual ${Math.round(mean)} (z ${z.toFixed(1)}, ${past.length} games)`));
  }
  return out;
}

export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** One link for every device: the join page opens the Android app, offers the download, or runs the iPhone check-in. */
export const pairingLink = (serverUrl: string, code: string) => `${serverUrl}/join.html?c=${code}`;
/** Deep link the join page hands to the Android companion. */
export const companionLink = (serverUrl: string, code: string) => `arenahub://pair?s=${encodeURIComponent(serverUrl)}&c=${code}`;
