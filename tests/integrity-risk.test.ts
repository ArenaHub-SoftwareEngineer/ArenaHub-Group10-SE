import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MONITOR_CONFIG, evaluateFacts, evaluateGsi, matchesEntry, monitorConfigSchema, parseGsi, scoreSignals, statOutliers, steamIdToAccountId, type AndroidFacts } from '../src/lib/integrityRisk';

const OFFICIAL = 'a'.repeat(64), MODDED = 'b'.repeat(64);
const clean = (over: Partial<AndroidFacts> = {}): AndroidFacts => ({ platform: 'android', games: [{ packageName: 'com.mobile.legends', versionName: '1.9.0', certSha256: [OFFICIAL] }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: true, foregroundPackage: 'com.mobile.legends', ...over });
const trusted = () => { const c = structuredClone(DEFAULT_MONITOR_CONFIG); c.android.games.mlbb.trustedCertSha256 = [OFFICIAL]; return c; };

test('a clean phone with the trusted game build scores clear', () => {
  const signals = evaluateFacts(clean(), trusted(), 'mlbb');
  assert.deepEqual(signals, []);
  assert.equal(scoreSignals(signals).level, 'clear');
});

test('an untrusted signature is recorded but not judged until staff trust one', () => {
  const signals = evaluateFacts(clean(), DEFAULT_MONITOR_CONFIG, 'mlbb');
  assert.equal(signals[0].id, 'game-signature-unverified');
  assert.match(signals[0].evidence, new RegExp(OFFICIAL));
  assert.equal(scoreSignals(signals).score, 0);
});

test('a modified game build is critical and urgent on its own', () => {
  const signals = evaluateFacts(clean({ games: [{ packageName: 'com.mobile.legends', certSha256: [MODDED] }] }), trusted(), 'mlbb');
  assert.equal(signals[0].id, 'game-signature-mismatch');
  const risk = scoreSignals(signals);
  assert.equal(risk.score, 100); assert.equal(risk.level, 'urgent');
});

test('blocklisted packages are re-checked against the server list, with prefix matching', () => {
  const signals = evaluateFacts(clean({ installedFlagged: ['com.lbe.parallel.intl', 'com.whatever.notlisted'] }), trusted(), 'mlbb');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].id, 'cheat-tool-installed'); assert.equal(signals[0].severity, 'medium');
  assert.equal(matchesEntry('CheatEngine-x86_64.exe', { match: 'cheatengine*' }), true);
  assert.equal(matchesEntry('notcheatengine.exe', { match: 'cheatengine*' }), false);
});

test('screen-control apps are medium unless they are known tools', () => {
  const signals = evaluateFacts(clean({ accessibilityServices: ['com.google.android.marvin.talkback/.TalkBackService', 'com.truedevelopersstudio.automatictap.autoclicker/.AutoClickService'] }), trusted(), 'mlbb');
  assert.deepEqual(signals.map(s => [s.id, s.severity]), [['accessibility-service', 'medium'], ['cheat-tool-installed', 'high']]);
});

test('root, debugging, stopped recording and a missing game all add up, each kind once', () => {
  const signals = evaluateFacts(clean({ games: [], rootIndicators: ['/system/xbin/su'], usbDebugging: true, developerOptions: true, recording: false, overlayPackages: ['com.facebook.orca', 'com.other'] }), trusted(), 'codm-mp');
  const risk = scoreSignals(signals);
  // root 35 + usb 15 + recording 15 + dev 5 + overlay 5 (once) + missing game 5
  assert.equal(risk.score, 80); assert.equal(risk.level, 'urgent');
  assert.equal(risk.reasons.filter(r => r.id === 'overlay-app').length, 1);
});

test('PC process blocklist and Dota checks', () => {
  const signals = evaluateFacts({ platform: 'pc', processes: [{ name: 'cheatengine-x86_64.exe' }, { name: 'chrome.exe' }], gameRunning: false, screenshotOk: true }, DEFAULT_MONITOR_CONFIG, 'dota2');
  assert.deepEqual(signals.map(s => s.id), ['blocked-process', 'dota-not-running']);
  assert.match(signals[0].evidence, /unsigned/);
  assert.equal(scoreSignals(signals).level, 'urgent');
});

test('Dota 2 GSI parsing and Steam account check', () => {
  const summary = parseGsi({ provider: { appid: 570 }, map: { matchid: '7412345678', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 312 }, player: { steamid: '76561198000000001', name: 'Kerr' }, hero: { name: 'npc_dota_hero_axe' } })!;
  assert.deepEqual(summary, { matchId: '7412345678', steamId: '76561198000000001', playerName: 'Kerr', hero: 'axe', gameState: 'GAME_IN_PROGRESS', clockTime: 312 });
  assert.equal(parseGsi({ provider: { appid: 730 } }), null);
  assert.equal(evaluateGsi(summary, '76561198000000001').length, 0);
  assert.equal(evaluateGsi(summary, '76561198000000002')[0].id, 'steam-account-mismatch');
  assert.equal(evaluateGsi(summary, '').length, 0);
  assert.equal(steamIdToAccountId('76561198000000001'), '39734273');
});

test('OpenDota outliers need enough history and compare to the player only', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ kills: 5 + (i % 3), last_hits: 150 + i * 2, gold_per_min: 450 + i * 5, xp_per_min: 500, hero_damage: 15000 + i * 300 }));
  const found = statOutliers({ kills: 25, last_hits: 160, gold_per_min: 470, xp_per_min: 500, hero_damage: 16000 }, history);
  assert.deepEqual(found.map(s => s.id), ['stat-outlier']);
  assert.match(found[0].evidence, /^kills 25 vs usual 6/);
  assert.equal(statOutliers({ kills: 25 }, history.slice(0, 4)).length, 0);
});

test('config validation rejects bad thresholds and patterns', () => {
  assert.equal(monitorConfigSchema.safeParse(DEFAULT_MONITOR_CONFIG).success, true);
  assert.equal(monitorConfigSchema.safeParse({ ...DEFAULT_MONITOR_CONFIG, thresholds: { watch: 50, review: 40, urgent: 70 } }).success, false);
  assert.equal(monitorConfigSchema.safeParse({ ...DEFAULT_MONITOR_CONFIG, pc: { blockedProcesses: [{ match: '../evil', label: 'x x', severity: 'high' }] } }).success, false);
});
