/**
 * Player stats for one match: per game and for the whole series. Pure functions, shared by the match page,
 * the MVP picker and the player leaderboard so all three show the same numbers.
 *
 * Organizers save one stat sheet per game (`statGames`). `playerStats` is only a copy of the last sheet saved,
 * so it is read only for older records that have no per-game sheets, and then it counts as one game.
 */
import { seriesGameCount, type Match, type MatchFormat, type Player } from './types';

export const MAX_STAT = 999;

export interface StatLine {
  kills?: unknown; deaths?: unknown; assists?: unknown; ign?: unknown; playerId?: unknown; playerName?: unknown;
  teamCode?: unknown; role?: unknown; cs?: unknown; gold?: unknown; damage?: unknown; [key: string]: unknown;
}
/** `game` is the game number, or null for an older single sheet with no number. */
export interface StatSheet { game: number | null; stats: Record<string, StatLine> }

export interface SeriesStatLine {
  playerId?: string; ign: string; playerName?: string; role?: string; teamCode?: string;
  kills: number; deaths: number; assists: number;
  /** Games this player has a valid line in. */
  games: number;
  cs?: number; gold?: string; damage?: string;
}

export const validStat = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STAT;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

function maxGames(format: MatchFormat): number {
  const count = seriesGameCount(format);
  return Number.isInteger(count) && count > 0 ? count : 7;
}

/**
 * The stat sheets that belong to this match, in game order. A finished series keeps only the games actually
 * played (team1Score + team2Score); a series still in progress keeps any game within its format.
 */
export function matchStatSheets(match: Match): StatSheet[] {
  const played = match.score.team1Score + match.score.team2Score;
  const limit = match.status === 'completed' ? played : maxGames(match.matchFormat);
  const sheets = Object.entries(match.statGames || {})
    .filter(([number, game]) => /^\d+$/.test(number) && Number(number) >= 1 && Number(number) <= limit && game?.playerStats)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([number, game]) => ({ game: Number(number), stats: game.playerStats as Record<string, StatLine> }));
  if (sheets.length) return sheets;
  const legacy = !match.statGames && match.playerStats && Object.keys(match.playerStats).length;
  return legacy && (match.status !== 'completed' || played >= 1) ? [{ game: null, stats: match.playerStats as Record<string, StatLine> }] : [];
}

export function hasPlayerStats(match: Match): boolean {
  return matchStatSheets(match).some(sheet => Object.keys(sheet.stats).length > 0);
}

/** The roster player a stat line belongs to: by roster ID, then by in-game name if exactly one player has it. */
function rosterPlayer(key: string, line: StatLine, roster: Player[]): Player | undefined {
  const byId = roster.find(p => p.id === key) || (text(line.playerId) ? roster.find(p => p.id === line.playerId) : undefined);
  if (byId) return byId;
  const ign = normalize(text(line.ign) || key);
  const named = roster.filter(p => p.ign && normalize(p.ign) === ign);
  return named.length === 1 ? named[0] : undefined;
}

const numeric = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && value.trim() !== '') { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
  return null;
};

/**
 * Adds the given sheets into one line per player, keyed by roster player ID when the player is on a roster.
 * Lines with invalid kills, deaths or assists are left out. Gold, damage and CS are summed only when every
 * game that has them recorded them as plain numbers; otherwise they are omitted rather than shown wrong.
 */
export function combineStatSheets(match: Match, sheets: StatSheet[]): Record<string, SeriesStatLine> {
  const roster = [...(match.team1?.players || []), ...(match.team2?.players || [])];
  type Extras = Record<'cs' | 'gold' | 'damage', number | null | undefined>;
  const totals: Record<string, SeriesStatLine & { extras: Extras; raw: Partial<Record<'gold' | 'damage', string>> }> = {};
  for (const sheet of sheets) {
    const seen = new Set<string>();
    for (const [key, line] of Object.entries(sheet.stats)) {
      if (!line || !validStat(line.kills) || !validStat(line.deaths) || !validStat(line.assists)) continue;
      const player = rosterPlayer(key, line, roster);
      const id = player?.id || key;
      if (seen.has(id)) continue; // a second line for the same player in one game is a duplicate
      seen.add(id);
      const total = totals[id] ||= { playerId: player?.id || text(line.playerId) || undefined, ign: player?.ign || text(line.ign) || key,
        playerName: text(line.playerName) || undefined, role: player?.role || text(line.role) || undefined, teamCode: text(line.teamCode) || undefined,
        kills: 0, deaths: 0, assists: 0, games: 0, extras: { cs: undefined, gold: undefined, damage: undefined }, raw: {} };
      total.kills += line.kills; total.deaths += line.deaths; total.assists += line.assists; total.games++;
      for (const field of ['cs', 'gold', 'damage'] as const) {
        if (line[field] === undefined || line[field] === '') continue;
        const value = numeric(line[field]), prior = total.extras[field];
        total.extras[field] = value === null || prior === null ? null : (prior || 0) + value;
        if (field !== 'cs') total.raw[field] = String(line[field]);
      }
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([id, { extras, raw, ...line }]) => {
    // One game: show what the organizer typed. Several games: the sum, if every value was a number.
    const pick = (field: 'gold' | 'damage') => sheets.length === 1 ? raw[field]
      : typeof extras[field] === 'number' ? Math.round(extras[field] as number).toLocaleString('en-US') : undefined;
    return [id, { ...line, cs: typeof extras.cs === 'number' ? extras.cs : undefined, gold: pick('gold'), damage: pick('damage') }];
  }));
}

/** Series totals for every player with stats in this match. */
export function seriesPlayerStats(match: Match): Record<string, SeriesStatLine> {
  return combineStatSheets(match, matchStatSheets(match));
}
