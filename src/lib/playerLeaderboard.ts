/**
 * Cross-tournament player leaderboard (M10). Pure functions only, so every rule below is unit-tested.
 *
 * What counts:
 * - Finished series with a valid result (the same check as team standings, lib/standings.ts). Live, upcoming,
 *   "if needed" and BYE matches never count, and neither do demo or withdrawn brackets.
 * - Per-game stats from `statGames`, summed over the games actually played (team1Score + team2Score).
 *   `playerStats` alone holds only the last game an organizer saved, so it is used only for older records
 *   that have no per-game entries, and then it counts as a single game.
 * - A stat row is credited only when it resolves to exactly one player in the two published rosters, or, for a
 *   roster that was never filled in, to exactly one side by college code. Anything ambiguous is left out.
 * - Kills, deaths and assists must be whole numbers from 0 to 999, as the organizer form requires.
 *
 * The same person is one row per game title: published rosters give each tournament new player IDs, so players
 * are matched on game + college code + in-game name. Private roster data (names, student IDs) is never used.
 */
import type { BracketDraft, Match, Player, Team } from './types';
import { completedSeries } from './standings';
import { publicationGameKey } from './bracketPublication';
import { RANK_GAMES, isRetiredGame } from './gameRanks';
import { matchStatSheets, validStat } from './matchStats';

/** A player needs this many games with stats before a KDA rank is given; fewer games make KDA swing too much. */
export const KDA_MIN_GAMES = 3;

export type LeaderboardSort = 'kda' | 'kills' | 'assists' | 'mvps' | 'wins';
export const LEADERBOARD_SORTS: Array<{ id: LeaderboardSort; label: string }> = [
  { id: 'kda', label: 'KDA' }, { id: 'kills', label: 'Kills' }, { id: 'assists', label: 'Assists' },
  { id: 'mvps', label: 'MVP awards' }, { id: 'wins', label: 'Series wins' },
];

/** `current` is true for a tournament that is published now, false for an archived past event. */
export interface LeaderboardSource { bracket: BracketDraft; current: boolean }

export interface PlayerMatchLine {
  tournamentId: string; tournamentTitle: string; matchId: string; matchNumber: string; roundName: string; date: string;
  opponent: string; won: boolean; seriesScore: string; games: number; kills: number; deaths: number; assists: number; mvp: boolean;
}

export interface LeaderboardRow {
  key: string; ign: string; role: string; teamName: string; collegeCode: string;
  games: number; matches: number; wins: number; losses: number;
  kills: number; deaths: number; assists: number; mvps: number;
  /** (kills + assists) / deaths, with zero deaths counted as one. */
  kda: number; tournaments: number;
  /** Has at least KDA_MIN_GAMES games with stats. */
  qualified: boolean;
  /** Competition rank for the chosen sort (ties share a rank). Null when not ranked, e.g. too few games for KDA. */
  rank: number | null;
  history: PlayerMatchLine[];
}

export interface LeaderboardTournament { id: string; title: string; current: boolean; countedMatches: number }

export interface GameLeaderboard {
  gameKey: string; label: string;
  /** False for Battle Royale: lobby results are recorded per squad, not per player. */
  tracksPlayers: boolean;
  rows: LeaderboardRow[];
  tournaments: LeaderboardTournament[];
  /** Matches being played now. Their stats join the leaderboard when the result is final. */
  liveMatches: number;
  /** Finished series with no player stats and no MVP entered yet. */
  finishedWithoutStats: number;
  /** Stat rows left out: invalid numbers, or a player who is not on either roster. */
  skippedRows: number;
}

type StatRow = { kills?: unknown; deaths?: unknown; assists?: unknown; ign?: unknown; playerId?: unknown; teamCode?: unknown; role?: unknown };
interface Credit { team: Team; ign: string; role: string }

const text = (value: unknown) => typeof value === 'string' ? value : '';
/** Case, width and spacing differences in an IGN are the same player. */
export const normalizeIgn = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const code = (team: Team) => (team.collegeCode || '').trim().toUpperCase();

export function playerKey(gameKey: string, team: Team, ign: string): string {
  return `${gameKey}|${code(team) || `team:${normalizeIgn(team.name || team.id)}`}|${normalizeIgn(ign)}`;
}

/** Labels and keys follow publicationGameKey, which already merges "MLBB", "Mobile Legends" and the game ID. */
export function leaderboardGameKey(bracket: Pick<BracketDraft, 'gameName' | 'gameId'>): string {
  return publicationGameKey({ gameName: bracket.gameName || '', gameId: bracket.gameId });
}

function credit(key: string, stat: StatRow, team1: Team, team2: Team): Credit | null {
  const sides = [team1, team2];
  const byId = (id: string) => sides.flatMap(team => team.players.filter(p => p.id === id).map(player => ({ team, player })));
  const toCredit = ({ team, player }: { team: Team; player: Player }): Credit => ({ team, ign: player.ign, role: player.role || '' });
  // Organizer entries are keyed by roster player ID.
  const exact = byId(key);
  if (exact.length === 1) return toCredit(exact[0]);
  const declaredId = text(stat.playerId);
  if (declaredId) { const found = byId(declaredId); if (found.length === 1) return toCredit(found[0]); }
  const ign = text(stat.ign) || key;
  const teamCode = text(stat.teamCode).trim().toUpperCase();
  let named = sides.flatMap(team => team.players.filter(p => p.ign && normalizeIgn(p.ign) === normalizeIgn(ign)).map(player => ({ team, player })));
  if (named.length > 1 && teamCode) named = named.filter(entry => code(entry.team) === teamCode);
  if (named.length === 1) return toCredit(named[0]);
  if (named.length > 1) return null;
  // A roster that was never filled in: the row's own IGN, if its college code picks exactly one side.
  const unlisted = sides.filter(team => !team.players.length && teamCode && code(team) === teamCode);
  if (text(stat.ign).trim() && unlisted.length === 1 && code(team1) !== code(team2)) return { team: unlisted[0], ign: text(stat.ign).trim(), role: text(stat.role) };
  return null;
}

function mvpCredit(match: Match, team1: Team, team2: Team): Credit | null {
  if (!match.mvp) return null;
  const ign = typeof match.mvp === 'string' ? match.mvp : match.mvp.ign || match.mvp.playerName || '';
  const teamCode = typeof match.mvp === 'string' ? '' : (match.mvp.teamCode || '').trim().toUpperCase();
  if (!ign.trim()) return null;
  return credit(ign, { ign, teamCode }, team1, team2);
}

/** The stat sheets for each game actually played in a finished series (shared with the match page). */
function playedGames(match: Match): Array<Record<string, StatRow>> {
  return matchStatSheets(match).map(sheet => sheet.stats as Record<string, StatRow>);
}

interface Totals { ign: string; role: string; team: Team; games: number; kills: number; deaths: number; assists: number; mvp: boolean }

function newRow(key: string, entry: Totals): LeaderboardRow {
  return { key, ign: entry.ign, role: entry.role, teamName: entry.team.name, collegeCode: code(entry.team), games: 0, matches: 0, wins: 0, losses: 0,
    kills: 0, deaths: 0, assists: 0, mvps: 0, kda: 0, tournaments: 0, qualified: false, rank: null, history: [] };
}

/** Builds one leaderboard per game title from published and archived tournaments. Rows come back ranked by KDA. */
export function buildPlayerLeaderboards(sources: LeaderboardSource[]): GameLeaderboard[] {
  // A tournament can briefly appear in both lists while it is restored; the published copy wins.
  const byId = new Map<string, LeaderboardSource>();
  for (const source of sources) if (!byId.has(source.bracket.id) || source.current) byId.set(source.bracket.id, source);
  // Past events first, so the newest team name and role are the ones shown.
  const ordered = [...byId.values()].sort((a, b) => Number(a.current) - Number(b.current));
  type Board = GameLeaderboard & { tournamentSets: Map<string, Set<string>> };
  const boards = new Map<string, Board>();

  for (const { bracket, current } of ordered) {
    if (bracket.demo || isRetiredGame({ gameId: bracket.gameId, gameName: bracket.gameName })) continue;
    const gameKey = leaderboardGameKey(bracket);
    const board: Board = boards.get(gameKey) || { gameKey, label: RANK_GAMES.find(g => g.gameId === gameKey)?.name || bracket.gameName, tracksPlayers: gameKey !== 'game-codm-br',
      rows: [], tournaments: [], liveMatches: 0, finishedWithoutStats: 0, skippedRows: 0, tournamentSets: new Map() };
    boards.set(gameKey, board);
    const tournament: LeaderboardTournament = { id: bracket.id, title: bracket.title, current, countedMatches: 0 };
    board.tournaments.push(tournament);
    board.liveMatches += bracket.matches.filter(match => match.status === 'live' && !match.inactive).length;

    for (const { match, winner, team1, team2 } of completedSeries(bracket.matches)) {
      const totals = new Map<string, Totals>();
      const add = (who: Credit) => {
        const key = playerKey(gameKey, who.team, who.ign);
        const entry = totals.get(key) || { ign: who.ign, role: who.role, team: who.team, games: 0, kills: 0, deaths: 0, assists: 0, mvp: false };
        totals.set(key, entry);
        return entry;
      };
      for (const sheet of playedGames(match)) {
        const seen = new Set<string>();
        for (const [key, stat] of Object.entries(sheet)) {
          const who = stat && validStat(stat.kills) && validStat(stat.deaths) && validStat(stat.assists) ? credit(key, stat, team1, team2) : null;
          // One line per player per game: a second row for the same player is a duplicate, not extra kills.
          if (!who || seen.has(playerKey(gameKey, who.team, who.ign))) { board.skippedRows++; continue; }
          seen.add(playerKey(gameKey, who.team, who.ign));
          const entry = add(who);
          entry.games++; entry.kills += stat.kills as number; entry.deaths += stat.deaths as number; entry.assists += stat.assists as number;
        }
      }
      const mvp = mvpCredit(match, team1, team2);
      if (mvp) add(mvp).mvp = true;
      if (!totals.size) { board.finishedWithoutStats++; continue; }
      tournament.countedMatches++;

      for (const [key, entry] of totals) {
        const row = board.rows.find(item => item.key === key) || newRow(key, entry);
        if (!board.rows.includes(row)) board.rows.push(row);
        const won = entry.team.id === winner, opponent = entry.team.id === team1.id ? team2 : team1;
        const ownScore = entry.team.id === team1.id ? match.score.team1Score : match.score.team2Score;
        Object.assign(row, { ign: entry.ign, role: entry.role || row.role, teamName: entry.team.name, collegeCode: code(entry.team) || row.collegeCode });
        row.games += entry.games; row.kills += entry.kills; row.deaths += entry.deaths; row.assists += entry.assists;
        row.matches++; row.wins += Number(won); row.losses += Number(!won); row.mvps += Number(entry.mvp);
        const seenIn = board.tournamentSets.get(key) || new Set<string>();
        seenIn.add(bracket.id); board.tournamentSets.set(key, seenIn);
        row.history.push({ tournamentId: bracket.id, tournamentTitle: bracket.title, matchId: match.id, matchNumber: match.matchNumber, roundName: match.roundName,
          date: match.scheduledDate || '', opponent: opponent.name, won, seriesScore: `${ownScore}–${match.score.team1Score + match.score.team2Score - ownScore}`,
          games: entry.games, kills: entry.kills, deaths: entry.deaths, assists: entry.assists, mvp: entry.mvp });
      }
    }
  }

  return [...boards.values()].map(({ tournamentSets, ...board }) => {
    for (const row of board.rows) {
      row.kda = (row.kills + row.assists) / Math.max(1, row.deaths);
      row.qualified = row.games >= KDA_MIN_GAMES;
      row.tournaments = tournamentSets.get(row.key)?.size || 0;
    }
    return { ...board, rows: rankLeaderboard(board.rows, 'kda') };
  }).sort((a, b) => order(a.gameKey) - order(b.gameKey) || a.label.localeCompare(b.label));
}

const order = (gameKey: string) => { const index = RANK_GAMES.findIndex(g => g.gameId === gameKey); return index < 0 ? RANK_GAMES.length : index; };

/** Exact KDA comparison with whole numbers, so 6/3 and 4/2 tie instead of differing by a rounding error. */
function compareKda(a: LeaderboardRow, b: LeaderboardRow) {
  return (b.kills + b.assists) * Math.max(1, a.deaths) - (a.kills + a.assists) * Math.max(1, b.deaths);
}

/** Negative when `a` ranks above `b`. Zero means a true tie: the two share a rank. */
function compareStats(sort: LeaderboardSort, a: LeaderboardRow, b: LeaderboardRow): number {
  const primary = sort === 'kda' ? Number(b.qualified) - Number(a.qualified) || compareKda(a, b)
    : sort === 'kills' ? b.kills - a.kills
    : sort === 'assists' ? b.assists - a.assists
    : sort === 'mvps' ? b.mvps - a.mvps
    : b.wins - a.wins || a.losses - b.losses;
  return primary || compareKda(a, b) || b.kills - a.kills || b.games - a.games || b.mvps - a.mvps;
}

export function rankLeaderboard(rows: LeaderboardRow[], sort: LeaderboardSort): LeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => compareStats(sort, a, b) || a.ign.localeCompare(b.ign) || a.key.localeCompare(b.key));
  let rank = 0;
  return sorted.map((row, index) => {
    if (sort === 'kda' && !row.qualified) return { ...row, rank: null };
    if (index === 0 || compareStats(sort, sorted[index - 1], row) !== 0) rank = index + 1;
    return { ...row, rank };
  });
}

export const formatKda = (row: Pick<LeaderboardRow, 'kda'>) => row.kda.toFixed(2);
