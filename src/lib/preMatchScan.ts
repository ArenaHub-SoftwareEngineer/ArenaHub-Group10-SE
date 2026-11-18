import { deviceFactsSchema, evaluateFacts, SEVERITY_POINTS, type MonitorConfig, type MonitorGame, type MonitorPlatform } from './integrityRisk';
import type { IosClearance } from './iosAntiCheat';

export const SCAN_FRESH_MS = 45_000;
export type ScanStatus = 'required' | 'scanning' | 'blocked' | 'incomplete' | 'stale' | 'unsupported' | 'ready' | 'ended' | 'declined';
export interface ScanReadiness { status: ScanStatus; label: string; detail: string; checkedAt: number | null; validUntil: number | null; blockers: string[]; warnings: string[] }
export interface PlayerScanReadiness { playerKey: string; playerName: string; team: string; sessionId: string | null; scan: ScanReadiness }
export interface MatchScanReadiness { matchId: string; matchLabel: string; game: MonitorGame; total: number; ready: number; canStart: boolean; players: PlayerScanReadiness[] }
export const rosterPlayerKey = (teamId: string, playerId: string) => JSON.stringify([teamId, playerId]);

interface ScanInput {
  platform: MonitorPlatform; game: MonitorGame; status: string; lastSeen: number | null; expiresAt: number;
  facts: unknown; challenge: string; policyVersion: string; config: MonitorConfig; now: number;
  iosClearance?: IosClearance | null;
}
const BLOCKING = new Set(['blocked-process', 'blocked-module', 'blocked-application-installed', 'blocked-file-hash', 'blocked-app-certificate', 'cheat-tool-installed', 'game-signature-mismatch', 'game-not-installed',
  'dota-file-modified', 'dota-unlisted-binary', 'dota-content-override', 'dota-launch-option', 'untrusted-game-module', 'cheat-file-found', 'suspicious-program-running', 'hooking-framework', 'virtual-container']);

/** Admission checks current observations only: fixing a finding must allow a fresh scan to pass. */
export function preMatchScan(input: ScanInput): ScanReadiness {
  const result = (status: ScanStatus, label: string, detail: string, blockers: string[] = [], warnings: string[] = []): ScanReadiness => ({ status, label, detail, checkedAt: input.lastSeen, validUntil: status === 'ready' ? Math.min(input.expiresAt, input.lastSeen! + SCAN_FRESH_MS) : null, blockers, warnings });
  if (input.status === 'ended' || input.expiresAt <= input.now) return result('ended', 'Scan session ended', 'Create a new scan code before the player joins.');
  if (input.status === 'declined') return result('declined', 'Scan declined', 'A scan is required for admission. Offer a supported organizer device.');
  if (input.status !== 'active') return result('required', 'Scan required', 'The player must open the companion and complete the scan.');
  if (input.platform === 'ios') {
    if (input.game === 'dota2') return result('unsupported', 'Windows device required', 'Dota 2 requires the Windows agent.');
    const review = input.iosClearance;
    if (!review) return result('required', 'iPhone inspection required', 'Ask a referee to inspect this iPhone, verify recording and arrange continuous supervision.');
    if (!review.approved) return result('blocked', 'iPhone clearance revoked', 'Return to the referee for a new inspection before joining.', [review.note]);
    if (review.challenge !== input.challenge || review.policyVersion !== input.policyVersion) return result('required', 'iPhone reinspection required', 'The session or tournament rules changed. Ask a referee to repeat the inspection.');
    if (review.validUntil <= input.now) return { ...result('stale', 'iPhone inspection expired', 'Ask the referee to repeat the inspection and confirm supervision before joining.'), checkedAt: review.reviewedAt };
    return { ...result('ready', 'iPhone supervised clearance', 'Referee inspection is current. Continuous supervision and recording are required during play.', [], ['iPhone protection uses referee inspection and recorded gameplay. Installed-app and game-memory inspection are unavailable.']), checkedAt: review.reviewedAt, validUntil: Math.min(input.expiresAt, review.validUntil) };
  }
  if (!input.facts) return result('scanning', 'Waiting for first scan', 'Pairing alone does not clear a player to join.');
  if (!input.lastSeen || input.now - input.lastSeen >= SCAN_FRESH_MS) return result('stale', 'Scan disconnected', 'Keep the companion running and reconnect before joining.');
  const parsed = deviceFactsSchema.safeParse(input.facts);
  if (!parsed.success || parsed.data.platform !== input.platform) return result('incomplete', 'Scan incomplete', 'The companion did not provide a valid device scan.');
  const facts = parsed.data;
  if (!input.challenge || facts.scan?.challenge !== input.challenge || facts.scan?.policyVersion !== input.policyVersion) return result('scanning', 'Updated scan required', 'Use the current companion and wait for it to scan with the latest tournament rules.');
  const signals = evaluateFacts(facts, input.config, input.game, { recordingRequired: false });
  const blockers = signals.filter(signal => BLOCKING.has(signal.id) && (signal.id === 'game-not-installed' || SEVERITY_POINTS[signal.severity] >= SEVERITY_POINTS.medium)).map(signal => signal.evidence);
  const warnings = signals.filter(signal => !BLOCKING.has(signal.id) && !['dota-not-running', 'checks-incomplete', 'game-signature-unverified'].includes(signal.id)).map(signal => signal.evidence);
  // Low-severity listed packages (for example Termux) stay visible as warnings instead of blocking.
  for (const signal of signals) if (BLOCKING.has(signal.id) && signal.id !== 'game-not-installed' && SEVERITY_POINTS[signal.severity] < SEVERITY_POINTS.medium) warnings.push(signal.evidence);
  if (blockers.length) return result('blocked', 'Action required', 'Close or remove the listed restricted tools, then rescan. Restart the game if a restricted library is still loaded. For Dota 2 file findings, run Steam\'s Verify integrity first.', blockers, warnings);
  if (facts.platform === 'pc') {
    if (input.game === 'dota2') {
      if (!facts.dota || !facts.checks?.dotaFiles) return result('incomplete', 'Dota 2 file check missing', 'Update the Windows agent to version 3.2 or later. It checks the Dota 2 install against Valve\'s file list.', [], warnings);
      if (!facts.dota.found) return result('incomplete', 'Dota 2 install not found', 'The agent could not find Dota 2 in this PC\'s Steam libraries. Play on the PC that has the tournament install.', [], warnings);
      if (facts.checks.dotaFiles !== 'complete') return result('incomplete', 'Dota 2 file check incomplete', 'The agent could not read every Dota 2 file. Close other programs that lock the game folder and keep the agent open until it rescans.', [], warnings);
      if (facts.gameRunning && facts.checks.moduleSigners && !['complete', 'not-configured'].includes(facts.checks.moduleSigners)) return result('incomplete', 'Game library signatures incomplete', 'The agent could not check the signatures of every library loaded from user folders. Keep it open until it rescans.', [], warnings);
    }
    if (facts.checks?.programContent === 'failed') return result('incomplete', 'Program check incomplete', 'The agent could not check running programs. Keep it open until it rescans.', [], warnings);
    if (input.config.pc.fileSweep) {
      if (!facts.checks?.fileSweep || facts.checks.fileSweep === 'failed' || facts.checks.fileSweep === 'not-configured') return result('incomplete', 'Folder check required', 'Staff turned on the cheat-file folder check. Update the agent and let it finish the check.', [], warnings);
      if (facts.checks.fileSweep === 'not-running') return result('incomplete', 'Folder check running', 'The agent is still checking this PC for cheat files. Keep it open; this usually takes under two minutes.', [], warnings);
      if (facts.checks.fileSweep === 'partial') warnings.push('The folder check reached its time or size limit before finishing every folder.');
    }
    if (facts.gameRunning && ((input.config.pc.blockedModules || []).length > 0 || (input.config.pc.blockedFileHashes || []).length > 0) && facts.checks?.modules !== 'complete') return result('incomplete', 'Game library scan incomplete', 'Update the Windows agent and allow it to inspect the running game libraries before joining.', [], warnings);
    if (facts.checks?.processes !== 'complete' || facts.checks?.installedApplications !== 'complete' || ((input.config.pc.blockedFileHashes || []).length > 0 && facts.checks?.fileHashes !== 'complete')) return result('incomplete', 'Scan incomplete', 'Required process, installed-software or configured fingerprint checks did not finish.', [], warnings);
  } else {
    const key = input.game === 'mlbb' ? 'mlbb' : 'codm';
    if (!input.config.android.games[key].trustedCertSha256.length) return result('incomplete', 'Game verification needed', 'Staff must configure the official regional game signing certificate before admitting Android players.');
    if (facts.games.some(game => input.config.android.games[key].packages.includes(game.packageName) && !game.certSha256.length)) return result('incomplete', 'Game certificate missing', 'The companion could not read the installed game signing certificate. Rescan before joining.', [], warnings);
    if (!facts.checks?.installedApps || !facts.checks?.gameSignatures || ((input.config.android.blockedCertificates || []).length > 0 && !facts.checks?.certificates)) return result('incomplete', 'Scan incomplete', 'Installed-app or required certificate checks did not finish.', [], warnings);
    if (!facts.checks.overlays) warnings.push('Overlay inspection was unavailable; this basic scan covers visible packages and required signatures.');
  }
  return result('ready', 'Scan passed', 'No configured blocking indicators were found in the required checks. Keep the companion running until the match ends.', [], warnings);
}
