import { GAME_PLATFORMS, type MonitorConfig, type MonitorGame, type MonitorPlatform } from './integrityRisk';
import { preMatchScan, type ScanReadiness } from './preMatchScan';

// A practice scan lets a player check their own device before match day, with no scan code.
// It applies exactly the same rules as the official scan, so "No cheats found" here means the
// official scan would pass too (unless staff change the lists or the device changes).
// It is never stored and never clears anyone for a match.

const STAMP = { challenge: '0'.repeat(48), policyVersion: '0'.repeat(64) };
export const PRACTICE_NOTE = 'Practice result only. It does not clear you for a match: run the official scan with your code from staff on match day.';

export function practicePlatform(game: MonitorGame): Exclude<MonitorPlatform, 'ios'> | null {
  for (const platform of GAME_PLATFORMS[game]) if (platform !== 'ios') return platform;
  return null;
}
// Fingerprints help staff, not players: a player only needs the file name and the reason.
const readable = (text: string) => text.replace(/ SHA-256 [0-9a-f]{64}$/, '');

export function practiceVerdict(game: MonitorGame, facts: unknown, config: MonitorConfig, now = Date.now()): ScanReadiness {
  const platform = practicePlatform(game);
  if (!platform) throw new Error('This game has no device scan.');
  const stamped = facts && typeof facts === 'object' ? { ...facts, scan: STAMP } : facts;
  const verdict = preMatchScan({ platform, game, status: 'active', lastSeen: now, expiresAt: now + 60_000, facts: stamped, challenge: STAMP.challenge, policyVersion: STAMP.policyVersion, config, now });
  const detail = verdict.status === 'ready' ? 'Nothing on this device would stop the official scan.' : verdict.detail;
  return { ...verdict, label: verdict.status === 'ready' ? 'No cheats found' : verdict.label, detail, validUntil: null, blockers: verdict.blockers.map(readable), warnings: verdict.warnings.map(readable) };
}
