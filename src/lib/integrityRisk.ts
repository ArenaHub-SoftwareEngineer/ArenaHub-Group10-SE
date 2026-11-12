// Match Integrity Monitor: shared rules for turning device facts into explainable signals.
// ArenaHub cannot see inside MLBB, CODM or Dota 2. These checks describe the device around the
// game, and the score only decides how urgently a human referee should look. It never decides guilt.
import { z } from 'zod';

export const MONITOR_GAMES = ['mlbb', 'codm-br', 'codm-mp', 'dota2'] as const;
export type MonitorGame = typeof MONITOR_GAMES[number];
export type MonitorPlatform = 'android' | 'pc';
export const GAME_PLATFORM: Record<MonitorGame, MonitorPlatform> = { mlbb: 'android', 'codm-br': 'android', 'codm-mp': 'android', dota2: 'pc' };
export const GAME_LABEL: Record<MonitorGame, string> = { mlbb: 'Mobile Legends', 'codm-br': 'CODM Battle Royale', 'codm-mp': 'CODM Multiplayer', dota2: 'Dota 2' };

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = typeof SEVERITIES[number];
export const SEVERITY_POINTS: Record<Severity, number> = { info: 0, low: 5, medium: 15, high: 35, critical: 100 };

export const SIGNAL_CATALOG = {
  'game-signature-mismatch': { severity: 'critical', title: 'Game app is not the official build', explain: 'The installed game is signed with a different key from the build staff trust. Modified game apps look like this.' },
  'game-signature-unverified': { severity: 'info', title: 'Game signature not on the trusted list', explain: 'Staff have not marked this game signature as official yet, so it was recorded but not judged.' },
  'game-not-installed': { severity: 'low', title: 'Game app not found', explain: 'The expected game was not found on this phone, so the match may be played on another device.' },
  'cheat-tool-installed': { severity: 'high', title: 'Known cheat or modding tool', explain: 'An app on the staff blocklist (memory editors, patchers, clone spaces, auto-tappers) is installed or active.' },
  'root-detected': { severity: 'high', title: 'Phone is rooted', explain: 'Root access lets apps change other apps, which cheat tools need.' },
  'emulator-detected': { severity: 'high', title: 'Running on an emulator', explain: 'The companion is running on an emulator instead of a real phone.' },
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
} as const satisfies Record<string, { severity: Severity; title: string; explain: string }>;
export type SignalId = keyof typeof SIGNAL_CATALOG;

export interface Signal { id: SignalId; severity: Severity; evidence: string }

export interface BlockEntry { match: string; label: string; severity: Severity }
export interface MonitorConfig {
  android: { games: { mlbb: GameIdentity; codm: GameIdentity }; blockedPackages: BlockEntry[] };
  pc: { blockedProcesses: BlockEntry[] };
  thresholds: { watch: number; review: number; urgent: number };
}
export interface GameIdentity { packages: string[]; trustedCertSha256: string[] }

const severity = z.enum(SEVERITIES);
const blockEntry = z.object({ match: z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z0-9._\- ]+\*?$/), label: z.string().trim().min(2).max(80), severity });
const certHash = z.string().regex(/^[0-9a-f]{64}$/);
const gameIdentity = z.object({ packages: z.array(z.string().regex(/^[a-zA-Z0-9._]{3,150}$/)).min(1).max(10), trustedCertSha256: z.array(certHash).max(20) });
export const monitorConfigSchema = z.object({
  android: z.object({ games: z.object({ mlbb: gameIdentity, codm: gameIdentity }), blockedPackages: z.array(blockEntry).max(300) }),
  pc: z.object({ blockedProcesses: z.array(blockEntry).max(300) }),
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
    ],
  },
  pc: {
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
export const androidFactsSchema = z.object({
  platform: z.literal('android'),
  games: z.array(z.object({ packageName, versionName: shortText.optional(), certSha256: z.array(z.string().toLowerCase().pipe(certHash)).max(5) })).max(10),
  installedFlagged: z.array(packageName).max(100),
  rootIndicators: z.array(shortText).max(20),
  emulatorIndicators: z.array(shortText).max(20),
  accessibilityServices: z.array(shortText).max(50),
  overlayPackages: z.array(packageName).max(100),
  developerOptions: z.boolean(),
  usbDebugging: z.boolean(),
  recording: z.boolean(),
  foregroundPackage: packageName.optional(),
});
export const pcFactsSchema = z.object({
  platform: z.literal('pc'),
  processes: z.array(z.object({ name: shortText.min(1), path: z.string().max(400).optional(), signer: shortText.optional() })).max(50),
  gameRunning: z.boolean(),
  screenshotOk: z.boolean(),
});
export const deviceFactsSchema = z.discriminatedUnion('platform', [androidFactsSchema, pcFactsSchema]);
export type AndroidFacts = z.infer<typeof androidFactsSchema>;
export type PcFacts = z.infer<typeof pcFactsSchema>;
export type DeviceFacts = z.infer<typeof deviceFactsSchema>;

const signal = (id: SignalId, evidence: string, level: Severity = SIGNAL_CATALOG[id].severity): Signal => ({ id, severity: level, evidence: evidence.slice(0, 200) });

/** Turns one device report into signals. The server re-checks every list against its own config. */
export function evaluateFacts(facts: DeviceFacts, config: MonitorConfig, game: MonitorGame): Signal[] {
  const out: Signal[] = [];
  if (facts.platform === 'pc') {
    for (const process of facts.processes) {
      const entry = findEntry(process.name, config.pc.blockedProcesses);
      if (entry) out.push(signal('blocked-process', `${entry.label}: ${process.name}${process.signer ? ` (signed by ${process.signer})` : ' (unsigned)'}`, entry.severity));
    }
    if (game === 'dota2' && !facts.gameRunning) out.push(signal('dota-not-running', 'dota2.exe was not running'));
    if (!facts.screenshotOk) out.push(signal('screenshot-failed', 'Screen capture failed on this report'));
    return out;
  }
  const identity = game === 'mlbb' ? config.android.games.mlbb : config.android.games.codm;
  const installed = facts.games.filter(g => identity.packages.includes(g.packageName));
  if (!installed.length) out.push(signal('game-not-installed', `None of ${identity.packages.join(', ')} found`));
  for (const app of installed) {
    const label = `${app.packageName}${app.versionName ? ` ${app.versionName}` : ''}`;
    if (!app.certSha256.length) out.push(signal('game-signature-mismatch', `${label}: no signing certificate reported`));
    else if (!identity.trustedCertSha256.length) out.push(signal('game-signature-unverified', `${label} cert ${app.certSha256[0]}`));
    else if (!app.certSha256.some(cert => identity.trustedCertSha256.includes(cert))) out.push(signal('game-signature-mismatch', `${label} cert ${app.certSha256[0]}`));
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
  if (facts.rootIndicators.length) out.push(signal('root-detected', facts.rootIndicators.join(', ')));
  if (facts.emulatorIndicators.length) out.push(signal('emulator-detected', facts.emulatorIndicators.join(', ')));
  if (facts.developerOptions) out.push(signal('developer-options', 'Developer options enabled'));
  if (facts.usbDebugging) out.push(signal('usb-debugging', 'USB or wireless debugging enabled'));
  if (!facts.recording) out.push(signal('recording-stopped', 'Recording was off at this report'));
  if (facts.foregroundPackage && !identity.packages.includes(facts.foregroundPackage) && facts.foregroundPackage !== 'ph.edu.wmsu.arenahub.companion') out.push(signal('game-left-foreground', facts.foregroundPackage));
  return out;
}

export type RiskLevel = 'clear' | 'watch' | 'review' | 'urgent';
export interface RiskResult { score: number; level: RiskLevel; reasons: { id: SignalId; severity: Severity; points: number; title: string }[] }

/** Each kind of signal counts once, at its worst severity, so one noisy check cannot dominate. */
export function scoreSignals(signals: Pick<Signal, 'id' | 'severity'>[], thresholds = DEFAULT_MONITOR_CONFIG.thresholds): RiskResult {
  const worst = new Map<SignalId, Severity>();
  for (const s of signals) if (!worst.has(s.id) || SEVERITY_POINTS[s.severity] > SEVERITY_POINTS[worst.get(s.id)!]) worst.set(s.id, s.severity);
  const reasons = [...worst].map(([id, level]) => ({ id, severity: level, points: SEVERITY_POINTS[level], title: SIGNAL_CATALOG[id].title })).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  const level: RiskLevel = score >= thresholds.urgent ? 'urgent' : score >= thresholds.review ? 'review' : score >= thresholds.watch ? 'watch' : 'clear';
  return { score, level, reasons };
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
export const pairingLink = (serverUrl: string, code: string) => `arenahub://pair?s=${encodeURIComponent(serverUrl)}&c=${code}`;
