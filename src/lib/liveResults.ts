// Match results for brackets that are already live. Used by Bracket Studio's Live board and by
// firestoreService.savePublishedMatchResult, so a tap on the board and the saved bracket agree.
import { seriesWinsNeeded, type BracketDraft, type Match, type Team } from './types';
import { validateScore } from './integrityChecks';

const playing = (team?: Team) => Boolean(team && !team.isBye && team.name.trim() && team.name !== 'BYE' && team.name !== 'TBD');

/** Both sides are real teams, so a result can be entered. */
export const canScoreMatch = (match: Match) => !match.inactive && playing(match.team1) && playing(match.team2);

/** The match with new series scores: a team that reaches the winning score wins, and anything less reopens it. */
export function scoredMatch(match: Match, team1Score: number, team2Score: number): Match {
  validateScore(match.matchFormat, team1Score, team2Score);
  const target = seriesWinsNeeded(match.matchFormat);
  const winner = team1Score >= target ? match.team1 : team2Score >= target ? match.team2 : undefined;
  const started = team1Score > 0 || team2Score > 0;
  const status: Match['status'] = winner ? 'completed'
    : match.status === 'completed' ? (started ? 'live' : 'upcoming')
    : started && (match.status === 'upcoming' || match.status === 'pre-match') ? 'live' : match.status;
  return { ...match, score: { ...match.score, team1Score, team2Score }, status, winnerId: winner?.id };
}

/** Scores that make `slot` the winner: they reach the winning score, the other side keeps its games (capped below it). */
export function winnerScores(match: Match, slot: 1 | 2): [number, number] {
  const target = seriesWinsNeeded(match.matchFormat);
  const other = Math.min(slot === 1 ? match.score.team2Score : match.score.team1Score, target - 1);
  return slot === 1 ? [target, other] : [other, target];
}

export interface BracketProgress { total: number; played: number; live: number; next?: Match; champion?: Team }

/** Counts for the Live board cards: matches that can be played, how many are done or live, and the next one up. */
export function bracketProgress(bracket: BracketDraft): BracketProgress {
  const real = bracket.matches.filter(match => !match.inactive && ![match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE'));
  const played = real.filter(match => match.status === 'completed').length;
  const live = real.filter(match => match.status === 'live').length;
  const next = real.find(match => match.status === 'live') ?? real.find(match => match.status !== 'completed' && canScoreMatch(match));
  const final = [...real].sort((a, b) => b.round - a.round).find(match => !match.nextMatchId && match.status === 'completed');
  const champion = played === real.length && final ? [final.team1, final.team2].find(team => team?.id === final.winnerId) : undefined;
  return { total: real.length, played, live, next, champion };
}
