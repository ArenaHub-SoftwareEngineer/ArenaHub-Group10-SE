// Pure helpers for the ArenaHub PC agent, kept separate so they can be unit-tested.
import { findEntry, type BlockEntry } from '../../src/lib/integrityRisk.ts';

export interface ProcessInfo { name: string; pid: number }

/** Parses `tasklist /fo csv /nh` output. */
export function parseTasklist(csv: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.match(/"((?:[^"]|"")*)"/g)?.map(cell => cell.slice(1, -1).replaceAll('""', '"'));
    if (cells && cells.length >= 2 && /^\d+$/.test(cells[1])) rows.push({ name: cells[0], pid: Number(cells[1]) });
  }
  return rows;
}

/** Only processes on the staff blocklist leave the PC. The full process list never does. */
export function flaggedProcesses(processes: ProcessInfo[], patterns: string[]) {
  const entries: BlockEntry[] = patterns.map(match => ({ match, label: match, severity: 'high' }));
  const seen = new Set<string>();
  return processes.filter(p => findEntry(p.name, entries) && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()));
}

/** Library folders from Steam's libraryfolders.vdf, plus the main Steam folder. */
export function steamLibraries(steamPath: string, vdf: string) {
  const paths = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replaceAll('\\\\', '\\'));
  // Windows paths ignore case, so the same library can appear twice with different casing.
  const unique = new Map<string, string>();
  for (const path of [steamPath.replaceAll('/', '\\'), ...paths]) if (!unique.has(path.toLowerCase())) unique.set(path.toLowerCase(), path);
  return [...unique.values()];
}

export const GSI_FILE = 'gamestate_integration_arenahub.cfg';
/** Valve's Game State Integration config. Dota 2 reads it at launch and posts match state to `uri`. */
export function gsiConfig(serverUrl: string, token: string) {
  return `"ArenaHub Match Monitor"
{
  "uri"         "${serverUrl.replace(/\/$/, '')}/api/integrity/dota/gsi"
  "timeout"     "5.0"
  "buffer"      "0.5"
  "throttle"    "5.0"
  "heartbeat"   "30.0"
  "data"
  {
    "provider"  "1"
    "map"       "1"
    "player"    "1"
    "hero"      "1"
  }
  "auth"
  {
    "token"     "${token}"
  }
}
`;
}

export function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].match(/^--([a-z-]+)$/)?.[1];
    if (!key) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
