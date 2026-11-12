import institution from '../../institution.config.json' with { type: 'json' };
import type { BracketDraft, College, Team } from './types';
import { completedSeries } from './standings';

/** Colleges come from institution.config.json, so each school configures its own list. */
export const INSTITUTION_COLLEGES: Array<{ id: string; code: string; name: string; color: string }> =
  (institution.colleges || []).map(c => ({ id: `col-${c.code.toLowerCase()}`, code: c.code, name: c.name, color: c.color }));

/** College records with stats computed only from completed, published matches. */
export function collegeStandings(brackets: BracketDraft[]): College[] {
  const matches = brackets.flatMap(b => b.matches);
  const teamsByCollege = new Map<string, Set<string>>();
  const alive = new Set<string>();
  for (const match of matches) for (const team of [match.team1, match.team2]) {
    if (!team || team.isBye || !team.collegeCode) continue;
    const code = team.collegeCode.toUpperCase();
    if (!teamsByCollege.has(code)) teamsByCollege.set(code, new Set());
    teamsByCollege.get(code)!.add(`${team.gameId}:${team.id}`);
    if (['upcoming', 'pre-match', 'live'].includes(match.status) && !match.inactive) alive.add(code);
  }
  const totals = new Map<string, { wins: number; losses: number; gameWins: number; gameLosses: number }>();
  for (const { match, winner, team1, team2 } of completedSeries(matches)) {
    ([[team1, match.score.team1Score, match.score.team2Score], [team2, match.score.team2Score, match.score.team1Score]] as Array<[Team, number, number]>).forEach(([team, won, lost]) => {
      const code = team.collegeCode?.toUpperCase();
      if (!code) return;
      const row = totals.get(code) || { wins: 0, losses: 0, gameWins: 0, gameLosses: 0 };
      row.wins += Number(team.id === winner); row.losses += Number(team.id !== winner);
      row.gameWins += won; row.gameLosses += lost;
      totals.set(code, row);
    });
  }
  return INSTITUTION_COLLEGES.map(college => {
    const stats = totals.get(college.code) || { wins: 0, losses: 0, gameWins: 0, gameLosses: 0 };
    const teams = teamsByCollege.get(college.code)?.size ?? 0;
    return {
      ...college, teamsCount: teams,
      stats: { ...stats, status: teams && !alive.has(college.code) ? 'Eliminated' : 'Active' },
    } as College;
  });
}
