// Swiss format (M2).
//
// Every team plays every round. Each round pairs teams on the same record and avoids rematches whenever a
// rematch-free pairing exists. Rounds are created one at a time: the next round appears as soon as the last
// result of the current round is saved. With an odd team count, one team per round gets a bye (the
// lowest-ranked team that has not had one), and a bye counts as a series win.
// Ranking: series wins, then Buchholz (the total wins of the teams you played), then game difference, then seed.
import { seriesWinsNeeded, type Match, type MatchFormat, type Team } from '../types';
import { validateScore } from '../integrityChecks';

export const SWISS_MAX_TEAMS = 128;

/** Rounds needed to leave a single unbeaten team: the ceiling of log2(teams), never more than teams - 1. */
export function swissRoundCount(teamCount: number): number {
  return Math.max(1, Math.min(teamCount - 1, Math.ceil(Math.log2(Math.max(2, teamCount)))));
}

export interface SwissRow { team: Team; wins: number; losses: number; byes: number; gameDiff: number; buchholz: number; opponents: string[] }

const byeTeam = (id: string): Team => ({ id: `bye-${id}`, name: 'BYE', isBye: true, collegeId: 'bye', collegeCode: 'BYE', gameId: 'game-draft', seed: 0, winRate: 0, record: '0W-0L', players: [] });

/** Records from completed Swiss series (byes included), ranked by the Swiss tiebreakers. */
export function swissStandings(matches: Match[], teams: Team[] = []): SwissRow[] {
  const rows = new Map<string, SwissRow>();
  const row = (team: Team) => {
    let found = rows.get(team.id);
    if (!found) rows.set(team.id, found = { team, wins: 0, losses: 0, byes: 0, gameDiff: 0, buchholz: 0, opponents: [] });
    return found;
  };
  for (const team of teams) if (!team.isBye) row(team);
  for (const match of matches) {
    for (const team of [match.team1, match.team2]) if (team && !team.isBye) row(team);
    if (match.status !== 'completed' || !match.team1 || !match.team2) continue;
    if (match.team1.id === match.team2.id) continue;
    try { validateScore(match.matchFormat, match.score.team1Score, match.score.team2Score, true); } catch { continue; }
    const winner = match.score.team1Score > match.score.team2Score ? match.team1 : match.team2;
    if (match.winnerId !== winner.id || winner.isBye) continue;
    if (match.team1.isBye || match.team2.isBye) {
      const team = match.team1.isBye ? match.team2 : match.team1;
      if (!team.isBye) { row(team).wins++; row(team).byes++; }
      continue;
    }
    const a = row(match.team1), b = row(match.team2);
    a.opponents.push(b.team.id); b.opponents.push(a.team.id);
    const diff = match.score.team1Score - match.score.team2Score;
    a.gameDiff += diff; b.gameDiff -= diff;
    if (match.winnerId === a.team.id) { a.wins++; b.losses++; }
    else if (match.winnerId === b.team.id) { b.wins++; a.losses++; }
  }
  for (const r of rows.values()) r.buchholz = r.opponents.reduce((sum, id) => sum + (rows.get(id)?.wins || 0), 0);
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.buchholz - x.buchholz || y.gameDiff - x.gameDiff
    || (x.team.seed || 999) - (y.team.seed || 999) || x.team.name.localeCompare(y.team.name));
}

/**
 * Pairs ranked teams from the top: each team meets the closest-ranked team it has not played, backtracking
 * when a choice would strand a later team. A rematch is allowed only when no rematch-free pairing exists.
 */
export function pairSwiss(ranked: SwissRow[]): Array<[SwissRow, SwissRow]> {
  let budget = 20_000;
  const search = (pool: SwissRow[], allowRematch: boolean): Array<[SwissRow, SwissRow]> | null => {
    if (!pool.length) return [];
    if (--budget < 0) return null;
    const [first, ...rest] = pool;
    for (let i = 0; i < rest.length; i++) {
      if (!allowRematch && first.opponents.includes(rest[i].team.id)) continue;
      const tail = search([...rest.slice(0, i), ...rest.slice(i + 1)], allowRematch);
      if (tail) return [[first, rest[i]], ...tail];
    }
    return null;
  };
  const strict = search(ranked, false);
  if (strict) return strict;
  budget = 20_000;
  const loose = search(ranked, true);
  if (loose) return loose;
  const pairs: Array<[SwissRow, SwissRow]> = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) pairs.push([ranked[i], ranked[i + 1]]);
  return pairs;
}

function pairRound(rows: SwissRow[], round: number, total: number, base: Pick<Match, 'tournamentId' | 'gameId' | 'organizerName' | 'scheduledDate'>, format: MatchFormat): Match[] {
  const pool = [...rows];
  const common = (index: number): Omit<Match, 'score' | 'status'> => ({
    id: `${base.tournamentId}-SW${round}-${index}`, matchNumber: `#S${round}.${index}`, tournamentId: base.tournamentId, gameId: base.gameId,
    round, roundName: `Round ${round}`, bracketType: 'upper', matchFormat: format, scheduledDate: base.scheduledDate || 'Day 1',
    scheduledTime: `Round ${round}`, organizerName: base.organizerName, tournamentFormat: 'swiss', swissRounds: total,
  });
  let resting: SwissRow | undefined;
  if (pool.length % 2) {
    resting = [...pool].reverse().find(r => !r.byes) || pool[pool.length - 1];
    pool.splice(pool.indexOf(resting), 1);
  }
  const matches: Match[] = pairSwiss(pool).map(([a, b], i) => ({ ...common(i + 1), team1: a.team, team2: b.team, score: { team1Score: 0, team2Score: 0 }, status: 'upcoming' }));
  if (resting) matches.push({
    ...common(matches.length + 1), team1: resting.team, team2: byeTeam(`${base.tournamentId}-SW${round}`), status: 'completed',
    winnerId: resting.team.id, score: { team1Score: seriesWinsNeeded(format), team2Score: 0 }, scheduledTime: 'Automatic Advance',
  });
  return matches;
}

/** Round 1, paired by seed: the top half meets the bottom half (1 v n/2+1, 2 v n/2+2, ...). */
export function swiss(teams: Team[], base: Match, format: MatchFormat, rounds = swissRoundCount(teams.length)): Match[] {
  if (teams.length < 2) throw new Error('A Swiss event needs at least 2 teams.');
  if (teams.length > SWISS_MAX_TEAMS) throw new Error(`Swiss supports up to ${SWISS_MAX_TEAMS} teams per bracket.`);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds >= teams.length) throw new Error(`Choose 1 to ${teams.length - 1} Swiss rounds.`);
  if (teams.some(team => team.isBye) || new Set(teams.map(team => team.id)).size !== teams.length) throw new Error('Swiss needs distinct active teams. Byes are assigned automatically.');
  const total = rounds;
  const rows = [...teams].sort((a, b) => a.seed - b.seed).map(team => swissStandings([], [team])[0]);
  const odd = rows.length % 2 ? rows.slice(-1) : [];
  const even = rows.slice(0, rows.length - odd.length), half = even.length / 2;
  const folded = even.slice(0, half).flatMap((top, i) => [top, even[half + i]]);
  // The bye goes to the last seed in round 1; pairSwiss keeps the folded order, so 1 meets n/2+1.
  return pairRound([...folded, ...odd], 1, total, base, format);
}

/** A round has started once any of its real (non-bye) matches is live, scored or finished. */
const started = (match: Match) => !match.team1?.isBye && !match.team2?.isBye
  && (match.status !== 'upcoming' || match.score.team1Score > 0 || match.score.team2Score > 0);

/**
 * Applies one result to a Swiss event and keeps its rounds consistent:
 * - when every match of the latest round is complete, the next round is paired, until the last round;
 * - a correction in an earlier round re-pairs the later rounds, but only while none of their matches has
 *   started. Once a later round is under way its pairings stand, as in any Swiss event; standings update.
 */
export function advanceSwiss(matches: Match[], updated?: Match): Match[] {
  const previous = updated && matches.find(match => match.id === updated.id);
  if (updated && !previous) return matches;
  let next = updated ? matches.map(match => match.id === updated.id ? updated : match) : matches;
  const first = next.find(match => match.tournamentFormat === 'swiss');
  if (!first) return next;
  const teams = new Map<string, Team>();
  for (const match of next) for (const team of [match.team1, match.team2]) if (team && !team.isBye) teams.set(team.id, team);
  const total = first.swissRounds || swissRoundCount(teams.size);
  // Renames, schedule edits and unchanged results must preserve the next round's published schedule.
  const resultKey = (match: Match) => JSON.stringify([match.status === 'completed', match.winnerId, match.score, match.team1?.id, match.team2?.id]);
  if (updated && previous && resultKey(previous) !== resultKey(updated)) {
    const later = next.filter(match => match.round > updated.round);
    if (later.length && !later.some(started)) next = next.filter(match => match.round <= updated.round);
  }
  const latest = Math.max(...next.map(match => match.round));
  const current = next.filter(match => match.round === latest);
  if (latest >= total || current.some(match => match.status !== 'completed')) return next;
  return [...next, ...pairRound(swissStandings(next, [...teams.values()]), latest + 1, total, first, first.matchFormat)];
}

/** True when the event is finished: every round paired and every match completed. */
export function swissComplete(matches: Match[]): boolean {
  const first = matches.find(match => match.tournamentFormat === 'swiss');
  if (!first) return false;
  const latest = Math.max(...matches.map(match => match.round));
  return latest >= (first.swissRounds || 1) && matches.every(match => match.status === 'completed');
}
