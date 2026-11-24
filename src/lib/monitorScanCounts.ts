import type { MonitorGame, MonitorPlatform } from './integrityRisk';
import type { ScanReadiness } from './preMatchScan';

export interface ScanChartSession {
  id: string;
  matchId: string;
  matchLabel: string;
  playerKey?: string;
  playerName: string;
  team: string;
  game: MonitorGame;
  gameLabel: string;
  platform: MonitorPlatform;
  createdAt: number;
  inspection?: { status: string };
  passedAt?: number | null;
  iosClearance?: { reviewedAt: number } | null;
  scan?: ScanReadiness;
}

export const SCAN_SERIES = [
  { key: 'scanned', label: 'Scan received', color: '#2bbd83' },
  { key: 'inspected', label: 'iPhone inspected', color: '#668cf6' },
  { key: 'awaiting', label: 'Awaiting a check', color: '#697184' },
] as const;
export type ScanCountKey = typeof SCAN_SERIES[number]['key'];
export type ScanCounts = Record<ScanCountKey, number>;

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export const scanTeam = (session: { team: string }) => session.team.trim() || 'No team assigned';

export function latestScanSessions<T extends ScanChartSession>(sessions: T[]): T[] {
  const latest = new Map<string, T>();
  for (const session of sessions) {
    const player = session.playerKey || JSON.stringify([normalize(session.team), normalize(session.playerName)]);
    const key = JSON.stringify([session.game, session.matchId, player]);
    const previous = latest.get(key);
    if (!previous || session.createdAt > previous.createdAt) latest.set(key, session);
  }
  return [...latest.values()];
}

export function scanCountKey(session: ScanChartSession): ScanCountKey {
  if (session.platform === 'ios') return session.iosClearance?.reviewedAt || session.passedAt ? 'inspected' : 'awaiting';
  if (session.inspection?.status === 'reported' || session.inspection?.status === 'limited' || session.passedAt || session.scan?.status === 'ready') return 'scanned';
  return 'awaiting';
}

export function scanCounts(sessions: ScanChartSession[]): ScanCounts {
  const counts = { scanned: 0, inspected: 0, awaiting: 0 };
  for (const session of sessions) counts[scanCountKey(session)]++;
  return counts;
}

export interface ScanGroup<T extends ScanChartSession = ScanChartSession> {
  id: string;
  label: string;
  game: string;
  counts: ScanCounts;
  sessions: T[];
}

export function groupScanSessions<T extends ScanChartSession>(sessions: T[], byTeam: boolean): ScanGroup<T>[] {
  const groups = new Map<string, ScanGroup<T>>();
  for (const session of sessions) {
    const label = byTeam ? scanTeam(session) : session.gameLabel;
    const id = byTeam ? JSON.stringify([session.game, normalize(label)]) : session.game;
    const group = groups.get(id) ?? { id, label, game: session.gameLabel, counts: { scanned: 0, inspected: 0, awaiting: 0 }, sessions: [] };
    group.sessions.push(session);
    group.counts[scanCountKey(session)]++;
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label) || left.game.localeCompare(right.game));
}
