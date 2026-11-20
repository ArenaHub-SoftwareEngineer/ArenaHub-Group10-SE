// Turns a tool result into blocks the chat shows beside the answer (tables, match cards), and into a
// short label for the "thinking" steps. Built from the same records the model read, so the numbers in a
// table are the records themselves, not the model's retelling of them.
import { MAX_ROWS, type AnswerBlock, type MatchCard, type TableBlock } from '../../src/lib/aiBlocks.ts';

const GAME_NAMES: Record<string, string> = { mlbb: 'MLBB', dota2: 'Dota 2', 'codm-mp': 'CODM Multiplayer', 'codm-br': 'CODM Battle Royale' };
const gameText = (args: any) => typeof args?.game === 'string' && GAME_NAMES[args.game] ? `${GAME_NAMES[args.game]} ` : '';
const quoted = (value: unknown) => typeof value === 'string' && value.trim() ? `“${value.trim().slice(0, 40)}”` : '';

/** What the assistant is doing, in plain words, for the thinking panel. */
export function stepLabel(tool: string, args: any): string {
  switch (tool) {
    case 'listTournaments': return `Listing ${gameText(args)}tournaments`;
    case 'getBracket': return `Reading the ${quoted(args?.tournament) || 'tournament'} bracket`;
    case 'getMatch': return 'Opening the match record';
    case 'getLiveMatches': return `Checking ${gameText(args)}live matches`;
    case 'getSchedule': return `Checking the ${gameText(args)}schedule${args?.date ? ` for ${args.date}` : ''}`;
    case 'getStandings': return `Reading ${quoted(args?.tournament) || 'tournament'} standings`;
    case 'getTeam': return `Looking up ${quoted(args?.name) || 'a team'}`;
    case 'getHeadToHead': return `Comparing ${quoted(args?.teamA)} and ${quoted(args?.teamB)} head to head`;
    case 'getTeamForm': return `Checking ${quoted(args?.name)}’s recent form`;
    case 'getPlayerLeaderboard': return args?.player ? `Looking up player ${quoted(args.player)}` : `Ranking ${gameText(args)}players${args?.sort && args.sort !== 'kda' ? ` by ${args.sort}` : ''}`;
    case 'explainFormat': return 'Reviewing the format rules';
    case 'getPlatformHelp': return 'Checking how ArenaHub works';
    case 'getRules': return 'Checking the tournament rules';
    case 'listOpenReports': return 'Checking open fair-play cases';
    default: return 'Checking the records';
  }
}

function card(m: any, label?: string): MatchCard {
  const when = [m?.date, m?.time].filter(Boolean).join(' · ') || null;
  if (m?.lobby) return { label: label || m.round || '', team1: `${m.lobby.squads} squads`, team2: 'Lobby', score: null, status: m.status || '', when, ...(m.lobby.winner ? { winner: m.lobby.winner } : {}) };
  return {
    label: label || [m?.number, m?.round].filter(Boolean).join(' · '), team1: m?.team1?.name || 'To be decided', team2: m?.team2?.name || 'To be decided',
    ...(m?.team1?.college ? { college1: m.team1.college } : {}), ...(m?.team2?.college ? { college2: m.team2.college } : {}),
    score: typeof m?.score === 'string' ? m.score : null, status: m?.status || '', when, ...(m?.winner ? { winner: m.winner } : {}),
  };
}
/** Rows keep only the columns shown, so nothing else from a tool result reaches the browser. */
const table = (block: Omit<TableBlock, 'kind'>): TableBlock => ({
  kind: 'table', ...block,
  rows: block.rows.slice(0, MAX_ROWS).map(row => Object.fromEntries(block.columns.map(c => [c.key, row[c.key] ?? null]))),
});

/** Blocks for one tool result. Unknown tools, errors and empty results produce none. */
export function blocksFor(tool: string, args: any, data: any): AnswerBlock[] {
  if (!data || typeof data !== 'object' || data.error) return [];
  switch (tool) {
    case 'listTournaments':
      return Array.isArray(data) && data.length ? [table({ title: 'Tournaments', columns: [
        { key: 'title', label: 'Tournament' }, { key: 'game', label: 'Game' }, { key: 'format', label: 'Format' },
        { key: 'live', label: 'Live', align: 'right' }, { key: 'upcoming', label: 'Upcoming', align: 'right' }, { key: 'finished', label: 'Finished', align: 'right' }, { key: 'champion', label: 'Champion' },
      ], rows: data.map((t: any) => ({ title: t.title, game: t.game, format: t.format, live: t.live, upcoming: t.upcoming, finished: t.finished, champion: t.champion || '—' })) })] : [];
    case 'getBracket':
      return Array.isArray(data.matches) && data.matches.length ? [{ kind: 'matches', title: `${data.title} · ${data.format}`, matches: data.matches.slice(0, 12).map((m: any) => card(m)) }] : [];
    case 'getMatch':
      return data.match ? [{ kind: 'matches', title: data.tournament || 'Match', matches: [card(data.match)] }] : [];
    case 'getLiveMatches':
      return Array.isArray(data) && data.length ? [{ kind: 'matches', title: 'Live now (scores are not final)', matches: data.slice(0, 12).map((m: any) => card(m, `${m.tournament} · ${m.round}`)) }] : [];
    case 'getSchedule':
      return Array.isArray(data.matches) && data.matches.length ? [{ kind: 'matches', title: 'Coming up (Manila time)', matches: data.matches.slice(0, 12).map((m: any) => card(m, `${m.tournament} · ${m.round}`)) }] : [];
    case 'getStandings': {
      if (!Array.isArray(data.rows) || !data.rows.length) return [];
      if (data.kind === 'placement points') return [table({ title: data.title, subtitle: data.final ? 'Final standings' : `After ${data.gamesFinished} of ${data.gamesPlanned} games (not final)`, columns: [
        { key: 'rank', label: '#', align: 'right' }, { key: 'squad', label: 'Squad' }, { key: 'college', label: 'College' },
        { key: 'points', label: 'Points', align: 'right', bar: true }, { key: 'eliminations', label: 'Elims', align: 'right' }, { key: 'wins', label: 'Wins', align: 'right' },
      ], rows: data.rows })];
      const swiss = data.rows.some((r: any) => r.buchholz !== undefined);
      return [table({ title: data.title, subtitle: data.kind === 'Swiss standings' ? 'Swiss standings' : 'Series records', columns: [
        { key: 'team', label: 'Team' }, { key: 'college', label: 'College' }, { key: 'wins', label: 'W', align: 'right', bar: true }, { key: 'losses', label: 'L', align: 'right' }, { key: 'games', label: 'Games', align: 'right' },
        ...(swiss ? [{ key: 'buchholz', label: 'Buchholz', align: 'right' as const }] : []),
      ], rows: data.rows })];
    }
    case 'getTeam':
      return Array.isArray(data) && data.length ? [table({ title: typeof args?.name === 'string' && args.name.trim() ? `Teams matching “${args.name.trim().slice(0, 40)}”` : 'Teams found', columns: [
        { key: 'team', label: 'Team' }, { key: 'college', label: 'College' }, { key: 'tournament', label: 'Tournament' }, { key: 'record', label: 'Record', align: 'right' }, { key: 'players', label: 'Players' },
      ], rows: data.map((t: any) => ({ team: t.team, college: t.college, tournament: t.tournament, record: t.points !== undefined ? `${t.points} pts${t.rank ? ` · #${t.rank}` : ''}` : `${t.wins}–${t.losses}`, players: Array.isArray(t.players) ? t.players.map((p: any) => p.ign).join(', ') : '' })) })] : [];
    case 'getHeadToHead':
      return Array.isArray(data.series) && data.series.length ? [table({ title: 'Head to head', subtitle: data.record ? `Record ${data.record}` : undefined, columns: [
        { key: 'tournament', label: 'Tournament' }, { key: 'round', label: 'Round' }, { key: 'result', label: 'Result' }, { key: 'winner', label: 'Winner' },
      ], rows: data.series })] : [];
    case 'getTeamForm':
      return Array.isArray(data.results) && data.results.length ? [table({ title: `${data.results[0].team} recent form`, subtitle: data.streak || undefined, columns: [
        { key: 'outcome', label: 'Result' }, { key: 'opponent', label: 'Opponent' }, { key: 'score', label: 'Score', align: 'right' }, { key: 'round', label: 'Round' }, { key: 'tournament', label: 'Tournament' },
      ], rows: data.results.map((r: any) => ({ ...r, outcome: r.outcome === 'won' ? 'Won' : 'Lost' })) })] : [];
    case 'getPlayerLeaderboard': {
      if (Array.isArray(data.players)) return data.players.slice(0, 2).map((p: any) => table({
        title: `${p.ign} · ${p.game}`, subtitle: `${p.team}${p.college ? ` (${p.college})` : ''} · KDA ${p.kda ?? '—'} · ${p.kills}/${p.deaths}/${p.assists} over ${p.gamesWithStats} games · ${p.seriesWon}–${p.seriesLost} in series · ${p.mvpAwards} MVP`,
        columns: [{ key: 'outcome', label: 'Result' }, { key: 'opponent', label: 'Opponent' }, { key: 'series', label: 'Series', align: 'right' }, { key: 'kda', label: 'K/D/A', align: 'right' }, { key: 'mvp', label: 'MVP' }, { key: 'tournament', label: 'Tournament' }],
        rows: (p.recentMatches || []).map((h: any) => ({ outcome: h.outcome === 'won' ? 'Won' : 'Lost', opponent: h.opponent, series: h.series, kda: h.kda || '—', mvp: h.mvp ? 'MVP' : '', tournament: h.tournament })),
      }));
      if (!Array.isArray(data.games)) return [];
      const sortKey: Record<string, string> = { KDA: 'kda', Kills: 'kills', Assists: 'assists', 'MVP awards': 'mvpAwards', 'Series wins': 'seriesWon' };
      const bar = sortKey[data.rankedBy] || 'kda';
      return data.games.filter((g: any) => Array.isArray(g.top) && g.top.length).map((g: any) => table({
        title: `${g.game} players`, subtitle: `Ranked by ${String(data.rankedBy || 'KDA').toLowerCase()} · ${(g.tournamentsCounted || []).join(', ')}`,
        columns: [
          { key: 'rank', label: '#', align: 'right' }, { key: 'ign', label: 'Player' }, { key: 'team', label: 'Team' }, { key: 'gamesWithStats', label: 'Games', align: 'right' },
          { key: 'kda', label: 'KDA', align: 'right', bar: bar === 'kda' }, { key: 'kills', label: 'K', align: 'right', bar: bar === 'kills' }, { key: 'deaths', label: 'D', align: 'right' },
          { key: 'assists', label: 'A', align: 'right', bar: bar === 'assists' }, { key: 'mvpAwards', label: 'MVP', align: 'right', bar: bar === 'mvpAwards' },
        ],
        rows: g.top.map((r: any) => ({ ...r, kda: r.kda === null ? null : Number(r.kda) })),
        note: g.liveMatchesNotCounted ? `${g.liveMatchesNotCounted} live match(es) count once final.` : undefined,
      }));
    }
    default: return [];
  }
}
