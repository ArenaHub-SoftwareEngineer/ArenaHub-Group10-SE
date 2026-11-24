// Readable match names for the screen. Stored match numbers keep their short codes ("#M1", "#L3", "#F7", "#RR4",
// "#G2", "#S1.2") because schedules, the AI tools and saved links look matches up by them; people see "Match 1".
import type { Match } from './types';

const KINDS: Array<[RegExp, (n: string, m?: string) => string]> = [
  [/^M(\d+)$/i, n => `Match ${n}`],
  [/^RR(\d+)$/i, n => `Match ${n}`],
  [/^L(\d+)$/i, n => `Lower match ${n}`],
  [/^F(\d+)$/i, n => `Final match ${n}`],
  [/^G(\d+)$/i, n => `Game ${n}`],
  [/^S(\d+)\.(\d+)$/i, (round, n) => `Round ${round} match ${n}`],
];

/** "#M1" becomes "Match 1". Anything else loses a leading "#". Empty when there is no number. */
export function matchName(value: Pick<Match, 'matchNumber'> | string | undefined | null): string {
  const raw = (typeof value === 'string' ? value : value?.matchNumber || '').trim().replace(/^#+/, '');
  for (const [pattern, name] of KINDS) {
    const found = raw.match(pattern);
    if (found) return name(found[1], found[2]);
  }
  return raw;
}
