/**
 * Battle Royale placement scoring (CODM BR and similar lobby games).
 *
 * Every squad plays every game in one lobby. Each game awards placement points from a
 * configurable table plus points per elimination. Standings add up every completed game.
 *
 * Tiebreakers, in order:
 *   1. total points
 *   2. total placement points (survival beats eliminations)
 *   3. best single placement
 *   4. total eliminations
 *   5. better placement in the most recent completed game
 * Squads still level after all five share the rank.
 *
 * Pure functions only, so everything here is unit-tested.
 */
import type { BracketDraft } from '../types';

export const MAX_LOBBY_TEAMS = 25; // CODM BR: 100 players, squads of four.
export const MAX_GAMES = 24;
export const MAX_KILLS = 99;

export interface PlacementTeam { id: string; name: string; collegeCode: string }
export interface PlacementResult { teamId: string; placement: number; kills: number }
export interface PlacementGame {
  id: string; label: string; status: 'upcoming' | 'live' | 'completed';
  scheduledDate?: string; scheduledTime?: string;
  results: PlacementResult[];
}
export interface PlacementConfig {
  /** pointsTable[0] is first place. Places past the end of the table score 0. */
  pointsTable: number[];
  killPoints: number;
}
export interface PlacementEvent { config: PlacementConfig; teams: PlacementTeam[]; games: PlacementGame[] }

export interface PlacementStanding {
  rank: number; teamId: string; name: string; collegeCode: string;
  total: number; placementPoints: number; killPoints: number; kills: number;
  bestPlacement: number | null; gamesPlayed: number; wins: number;
  /** Placement in each completed game, in game order; null when the squad did not play it. */
  history: Array<number | null>;
}

export const POINT_PRESETS: Array<{ id: string; label: string; config: PlacementConfig }> = [
  { id: 'standard', label: 'Standard: 10, 6, 5, 4, 3, 2, 1, 1 + 1 per elimination', config: { pointsTable: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 1 } },
  { id: 'survival', label: 'Survival heavy: 15, 12, 10, 8, 6, 4, 2, 1 + 1 per elimination', config: { pointsTable: [15, 12, 10, 8, 6, 4, 2, 1], killPoints: 1 } },
  { id: 'kills', label: 'Elimination heavy: 10, 6, 5, 4, 3, 2, 1, 1 + 2 per elimination', config: { pointsTable: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 2 } },
];

export function placementPoints(config: PlacementConfig, placement: number) {
  return config.pointsTable[placement - 1] ?? 0;
}

export function validateConfig(config: PlacementConfig) {
  if (!Array.isArray(config.pointsTable) || !config.pointsTable.length || config.pointsTable.length > MAX_LOBBY_TEAMS) throw new Error(`The points table needs 1 to ${MAX_LOBBY_TEAMS} places.`);
  if (config.pointsTable.some(p => !Number.isInteger(p) || p < 0 || p > 100)) throw new Error('Placement points must be whole numbers from 0 to 100.');
  if (config.pointsTable.some((p, i) => i > 0 && p > config.pointsTable[i - 1])) throw new Error('A better placement can never score fewer points than a worse one.');
  if (!Number.isInteger(config.killPoints) || config.killPoints < 0 || config.killPoints > 10) throw new Error('Points per elimination must be a whole number from 0 to 10.');
}

/** Checks one game's results. A squad that did not play is simply left out. */
export function validateResults(event: Pick<PlacementEvent, 'teams'>, results: PlacementResult[]) {
  const ids = new Set(event.teams.map(t => t.id));
  const seenTeams = new Set<string>(), seenPlaces = new Set<number>();
  for (const result of results) {
    const name = event.teams.find(t => t.id === result.teamId)?.name || 'A squad';
    if (!ids.has(result.teamId)) throw new Error('A result names a squad that is not in this event.');
    if (seenTeams.has(result.teamId)) throw new Error(`${name} appears twice in this game.`);
    if (!Number.isInteger(result.placement) || result.placement < 1 || result.placement > event.teams.length) throw new Error(`${name} needs a placement from 1 to ${event.teams.length}.`);
    if (seenPlaces.has(result.placement)) throw new Error(`Two squads cannot both finish #${result.placement}.`);
    if (!Number.isInteger(result.kills) || result.kills < 0 || result.kills > MAX_KILLS) throw new Error(`${name} needs eliminations from 0 to ${MAX_KILLS}.`);
    seenTeams.add(result.teamId); seenPlaces.add(result.placement);
  }
}

export function computeStandings(event: PlacementEvent): PlacementStanding[] {
  const completed = event.games.filter(g => g.status === 'completed');
  const rows = event.teams.map(team => {
    const history = completed.map(game => game.results.find(r => r.teamId === team.id)?.placement ?? null);
    const results = completed.flatMap(game => game.results.filter(r => r.teamId === team.id));
    const placementPts = results.reduce((sum, r) => sum + placementPoints(event.config, r.placement), 0);
    const kills = results.reduce((sum, r) => sum + r.kills, 0);
    const played = results.map(r => r.placement);
    return {
      rank: 0, teamId: team.id, name: team.name, collegeCode: team.collegeCode,
      placementPoints: placementPts, killPoints: kills * event.config.killPoints, kills,
      total: placementPts + kills * event.config.killPoints,
      bestPlacement: played.length ? Math.min(...played) : null,
      gamesPlayed: results.length, wins: played.filter(p => p === 1).length, history,
    };
  });
  const lastPlacement = (row: PlacementStanding) => { for (let i = row.history.length - 1; i >= 0; i--) if (row.history[i] !== null) return row.history[i]!; return Infinity; };
  // Lower is better. Never subtract here: Infinity - Infinity is NaN, which would break shared ranks.
  const asc = (x: number, y: number) => x === y ? 0 : x < y ? -1 : 1;
  const compare = (a: PlacementStanding, b: PlacementStanding) =>
    asc(b.total, a.total)
    || asc(b.placementPoints, a.placementPoints)
    || asc(a.bestPlacement ?? Infinity, b.bestPlacement ?? Infinity)
    || asc(b.kills, a.kills)
    || asc(lastPlacement(a), lastPlacement(b));
  rows.sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
  rows.forEach((row, i) => { row.rank = i > 0 && compare(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** Which tiebreaker separated two adjacent squads, for the standings footnote. */
export function tiebreakReason(above: PlacementStanding, below: PlacementStanding): string | null {
  if (above.total !== below.total) return null;
  if (above.placementPoints !== below.placementPoints) return 'more placement points';
  if (above.bestPlacement !== below.bestPlacement) return 'a better best placement';
  if (above.kills !== below.kills) return 'more eliminations';
  if (above.rank !== below.rank) return 'a better placement in the latest game';
  return null;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'squad';

/** Builds a publishable Battle Royale event. It has no head-to-head matches; scoring lives in `placement`. */
export function createPlacementEvent(input: { title: string; teams: Array<{ name: string; collegeCode?: string }>; games: number; config: PlacementConfig; now?: number }): BracketDraft {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 160) throw new Error('Give the event a title of 3 to 160 characters.');
  const names = input.teams.map(t => ({ name: t.name.trim(), collegeCode: (t.collegeCode || '').trim().toUpperCase() })).filter(t => t.name);
  if (names.length < 2 || names.length > MAX_LOBBY_TEAMS) throw new Error(`A lobby needs 2 to ${MAX_LOBBY_TEAMS} squads.`);
  const lower = names.map(t => t.name.toLowerCase());
  const duplicate = lower.find((n, i) => lower.indexOf(n) !== i);
  if (duplicate) throw new Error(`"${names[lower.indexOf(duplicate)].name}" is listed twice.`);
  if (!Number.isInteger(input.games) || input.games < 1 || input.games > MAX_GAMES) throw new Error(`Choose 1 to ${MAX_GAMES} games.`);
  validateConfig(input.config);
  const stamp = (input.now ?? Date.now()).toString(36);
  const id = `br-${stamp}`;
  const teams: PlacementTeam[] = names.map((t, i) => ({ id: `${id}-${i + 1}-${slug(t.name)}`, name: t.name, collegeCode: t.collegeCode }));
  const placement: PlacementEvent = {
    config: { pointsTable: [...input.config.pointsTable], killPoints: input.config.killPoints },
    teams,
    games: Array.from({ length: input.games }, (_, i) => ({ id: `${id}-G${i + 1}`, label: `Game ${i + 1}`, status: 'upcoming' as const, results: [] })),
  };
  return {
    id, title, gameId: 'game-codm-br', gameName: 'Call of Duty: Mobile Battle Royale',
    format: 'Battle Royale points', teamsCount: teams.length, matchFormat: 'Bo1', seedingRule: 'Single lobby',
    matches: [], teams: teams.map((t, i) => ({ id: t.id, name: t.name, college: t.collegeCode, seed: i + 1 })),
    parsedParams: { game: 'Call of Duty: Mobile Battle Royale', format: 'Battle Royale points', seeding: 'Single lobby', constraint: 'None', teamsCount: teams.length, matchFormat: 'Bo1' },
    rawPrompt: '', createdAt: new Date(input.now ?? Date.now()).toLocaleDateString(), status: 'draft', placement,
  };
}

/** Returns the event with one game's results saved and its status set. */
export function recordGame(event: PlacementEvent, gameId: string, results: PlacementResult[], status: PlacementGame['status']): PlacementEvent {
  const game = event.games.find(g => g.id === gameId);
  if (!game) throw new Error('That game is not part of this event.');
  validateResults(event, results);
  if (status === 'completed' && results.length < 2) throw new Error('Enter at least two squads before marking the game complete.');
  return { ...event, games: event.games.map(g => g.id === gameId ? { ...g, status, results: [...results].sort((a, b) => a.placement - b.placement) } : g) };
}

export const isPlacementEvent = (bracket: Pick<BracketDraft, 'placement'>) => !!bracket.placement;
