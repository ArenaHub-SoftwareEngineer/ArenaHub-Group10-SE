// Positions every match of a published bracket for the viewer canvas (TournamentBracketCanvas), whatever the format:
// - single elimination: one lane, each match centred between the two matches that feed it;
// - double elimination: an upper lane, a lower lane under it, and the grand final (plus the reset final, if
//   needed) to the right, fed by both lane finals;
// - round robin and Swiss: one column per round, no paths (every team meets several opponents).
// Every elimination layout ends in a Champion card fed by the deciding final. Round robin and Swiss end in one too,
// filled from the standings once every match is played.
import type { Match, Team } from './types';
import { getTournamentStandings } from './standings';

export const CARD_W = 264;
export const CARD_H = 138;
export const COL_GAP = 112;
export const ROW_STEP = 156;
export const PAD = 36;
const HEADER_H = 40;
const LANE_GAP = 72;
export const CHAMP_W = 220;
export const CHAMP_H = 188;

export type Lane = 'main' | 'upper' | 'lower' | 'final';
export interface Placed { match: Match; lane: Lane; column: number; x: number; y: number }
export interface ColumnHeader { lane: Lane; x: number; y: number; title: string; format: string; final: boolean }
export interface LaneLabel { lane: Lane; y: number; title: string }
export interface Link { from: Placed; to: Placed; advanced: boolean }
export interface ChampionSlot { x: number; y: number; team?: Team; from?: Placed; byStandings: boolean }
export interface BracketLayout {
  mode: 'tree' | 'rounds';
  placed: Placed[]; headers: ColumnHeader[]; laneLabels: LaneLabel[]; links: Link[];
  champion: ChampionSlot | null; width: number; height: number;
}

const playing = (team?: Team) => Boolean(team && !team.isBye && team.name !== 'BYE' && team.name !== 'TBD');

/** Matches whose winner moves into `match` (by nextMatchId or by an explicit winner source). */
function feeders(match: Match, all: Match[]) {
  const ids = new Set<string>();
  for (const other of all) if (other.nextMatchId === match.id) ids.add(other.id);
  for (const source of match.sources || []) if (source?.result === 'winner') ids.add(source.matchId);
  return all.filter(other => ids.has(other.id));
}

function winnerOf(match?: Match): Team | undefined {
  if (!match || match.status !== 'completed') return undefined;
  return [match.team1, match.team2].find(team => team && team.id === match.winnerId)
    ?? (match.score.team1Score === match.score.team2Score ? undefined : match.score.team1Score > match.score.team2Score ? match.team1 : match.team2);
}

export function layoutBracket(matches: Match[]): BracketLayout {
  const format = matches.find(match => match.tournamentFormat)?.tournamentFormat;
  if (format === 'round-robin' || format === 'swiss') return roundsLayout(matches);
  const double = format === 'double-elimination' || matches.some(match => match.bracketType === 'lower');
  return treeLayout(matches, double);
}

/* ---------------------------------------------------------------- round robin and Swiss */

function roundsLayout(matches: Match[]): BracketLayout {
  const rounds = [...new Set(matches.map(match => match.round))].sort((a, b) => a - b);
  const placed: Placed[] = [], headers: ColumnHeader[] = [];
  let bottom = 0;
  rounds.forEach((round, column) => {
    const rows = matches.filter(match => match.round === round);
    const x = PAD + column * (CARD_W + COL_GAP);
    headers.push({ lane: 'main', x, y: 14, title: rows[0]?.roundName || `Round ${round}`, format: rows[0]?.matchFormat || 'Bo1', final: false });
    rows.forEach((match, index) => {
      const y = PAD + HEADER_H + CARD_H / 2 + index * ROW_STEP;
      placed.push({ match, lane: 'main', column, x, y });
      bottom = Math.max(bottom, y + CARD_H / 2);
    });
  });
  const done = matches.length > 0 && matches.every(match => match.status === 'completed' || match.inactive);
  const leader = done ? getTournamentStandings(matches)[0]?.team : undefined;
  const champX = PAD + rounds.length * (CARD_W + COL_GAP);
  const champion: ChampionSlot = { x: champX, y: PAD + HEADER_H + Math.max(CHAMP_H / 2, (bottom - PAD - HEADER_H) / 2), team: leader, byStandings: true };
  return {
    mode: 'rounds', placed, headers, laneLabels: [], links: [], champion,
    width: champX + CHAMP_W + PAD, height: Math.max(bottom, champion.y + CHAMP_H / 2) + PAD,
  };
}

/* ---------------------------------------------------------------- elimination */

function placeLane(matches: Match[], lane: Lane, top: number, columnOffset: number, all: Match[], known: Map<string, Placed>) {
  const rounds = [...new Set(matches.map(match => match.round))].sort((a, b) => a - b);
  const placed: Placed[] = [], headers: ColumnHeader[] = [];
  let bottom = top;
  rounds.forEach((round, index) => {
    const column = columnOffset + index;
    const x = PAD + column * (CARD_W + COL_GAP);
    const rows = matches.filter(match => match.round === round);
    headers.push({ lane, x, y: top + 14, title: rows[0]?.roundName || `Round ${round}`, format: rows[0]?.matchFormat || 'Bo3', final: false });
    // Each match wants to sit level with the matches that feed it; keep the order and a minimum gap.
    const wanted = rows.map((match, order) => {
      const parents = feeders(match, all).map(parent => known.get(parent.id)).filter((p): p is Placed => Boolean(p) && p!.lane === lane);
      const y = parents.length ? parents.reduce((sum, p) => sum + p.y, 0) / parents.length : NaN;
      return { match, order, y };
    });
    let previous = -Infinity;
    const first = top + HEADER_H + CARD_H / 2;
    for (const item of wanted) {
      const fallback = previous === -Infinity ? first : previous + ROW_STEP;
      const y = Math.max(Number.isNaN(item.y) ? fallback : item.y, previous === -Infinity ? first : previous + ROW_STEP);
      const spot: Placed = { match: item.match, lane, column, x, y };
      placed.push(spot); known.set(item.match.id, spot);
      previous = y; bottom = Math.max(bottom, y + CARD_H / 2);
    }
  });
  return { placed, headers, bottom, columns: rounds.length };
}

function treeLayout(matches: Match[], double: boolean): BracketLayout {
  const known = new Map<string, Placed>();
  const placed: Placed[] = [], headers: ColumnHeader[] = [], laneLabels: LaneLabel[] = [];
  const upperMatches = double ? matches.filter(match => match.bracketType === 'upper') : matches.filter(match => match.bracketType !== 'final' || !double);
  const lowerMatches = double ? matches.filter(match => match.bracketType === 'lower') : [];
  const finalMatches = double ? matches.filter(match => match.bracketType === 'final') : [];

  const upperTop = double ? 28 : 0;
  const upper = placeLane(upperMatches, double ? 'upper' : 'main', upperTop, 0, matches, known);
  placed.push(...upper.placed); headers.push(...upper.headers);
  if (double) laneLabels.push({ lane: 'upper', y: 6, title: 'Upper bracket' });

  let bottom = upper.bottom, columns = upper.columns;
  if (lowerMatches.length) {
    const lowerTop = upper.bottom + LANE_GAP;
    laneLabels.push({ lane: 'lower', y: lowerTop - 22, title: 'Lower bracket' });
    const lower = placeLane(lowerMatches, 'lower', lowerTop, 0, matches, known);
    placed.push(...lower.placed); headers.push(...lower.headers);
    bottom = lower.bottom; columns = Math.max(columns, lower.columns);
  }

  // Finals sit to the right of both lanes, level with the matches that feed them.
  const finalRounds = [...new Set(finalMatches.map(match => match.round))].sort((a, b) => a - b);
  finalRounds.forEach((round, index) => {
    const column = columns + index;
    const x = PAD + column * (CARD_W + COL_GAP);
    finalMatches.filter(match => match.round === round).forEach(match => {
      const parents = feeders(match, matches).map(parent => known.get(parent.id)).filter((p): p is Placed => Boolean(p));
      const fromSources = (match.sources || []).map(source => source && known.get(source.matchId)).filter((p): p is Placed => Boolean(p));
      const basis = parents.length ? parents : fromSources;
      const y = basis.length ? basis.reduce((sum, p) => sum + p.y, 0) / basis.length : (upperTop + bottom) / 2;
      const spot: Placed = { match, lane: 'final', column, x, y };
      placed.push(spot); known.set(match.id, spot);
      headers.push({ lane: 'final', x, y: Math.max(14, y - CARD_H / 2 - 30), title: match.roundName || 'Grand final', format: match.matchFormat || 'Bo5', final: true });
    });
  });
  const totalColumns = columns + finalRounds.length;

  // The last round of a single-elimination lane is its final.
  if (!double) {
    const lastColumn = Math.max(...placed.map(p => p.column), 0);
    headers.filter(h => h.x === PAD + lastColumn * (CARD_W + COL_GAP)).forEach(h => { h.final = true; });
  }

  const links: Link[] = [];
  for (const target of placed) {
    for (const parent of feeders(target.match, matches)) {
      const from = known.get(parent.id);
      if (!from || from.column >= target.column) continue;
      const advanced = parent.status === 'completed' || Boolean(parent.winnerId) || Boolean(parent.team2?.isBye) || Boolean(parent.team1?.isBye);
      links.push({ from, to: target, advanced });
    }
  }

  // Champion: the active final (not an unplayed "if needed" reset) decides it.
  const deciding = double
    ? [...placed].filter(p => p.lane === 'final' && !p.match.inactive).sort((a, b) => b.column - a.column)[0]
    : [...placed].sort((a, b) => b.column - a.column)[0];
  const champion: ChampionSlot | null = deciding ? {
    x: PAD + totalColumns * (CARD_W + COL_GAP), y: deciding.y, from: deciding, byStandings: false,
    team: playing(winnerOf(deciding.match)) ? winnerOf(deciding.match) : undefined,
  } : null;

  const height = Math.max(bottom, champion ? champion.y + CHAMP_H / 2 : 0, ...placed.map(p => p.y + CARD_H / 2)) + PAD;
  const width = (champion ? champion.x + CHAMP_W : PAD + totalColumns * (CARD_W + COL_GAP) - COL_GAP) + PAD;
  return { mode: 'tree', placed, headers, laneLabels, links, champion, width, height };
}
