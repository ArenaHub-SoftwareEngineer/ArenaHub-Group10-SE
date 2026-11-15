// Read-only tools the model may call. Each one reads the published snapshot (public documents only:
// team names, college codes, in-game names and roles) and returns scrubbed fields plus references.
// Nothing here can write, and nothing reads the staff-only private roster.
import { z } from 'zod';
import type { BracketDraft, Match, Team } from '../../src/lib/types.ts';
import type { KnowledgeReference } from '../../src/lib/tournamentKnowledge.ts';
import { recordedChampion } from '../../src/lib/tournamentKnowledge.ts';
import { getStandings } from '../../src/lib/standings.ts';
import { computeStandings, scheduleMatches } from '../../src/lib/formats/placement.ts';
import { bracketTeams } from '../../src/lib/data/tournamentDocs.ts';
import { publicationGameKey } from '../../src/lib/bracketPublication.ts';
import { manilaToday, scheduleDate, timeOrder } from '../../src/lib/calendar.ts';
import { sortedTimeline } from '../../src/lib/matchHighlights.ts';

export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolResult { data: unknown; references: KnowledgeReference[] }
export interface Tool extends ToolSpec { run(args: unknown): Promise<ToolResult> }
export interface ToolContext {
  brackets: BracketDraft[];
  checkedAt: string;
  staff: boolean;
  /** Staff only: open fair-play cases, ids and status only. Present when the server has admin access. */
  openReports?: () => Promise<Array<{ id: string; status: string; matchId: string; createdAt: string; evidence: number }>>;
}

const GAMES = ['mlbb', 'dota2', 'codm-mp', 'codm-br'] as const;
const GAME_NAMES: Record<string, string> = { mlbb: 'Mobile Legends: Bang Bang', dota2: 'Dota 2', 'codm-mp': 'Call of Duty: Mobile Multiplayer', 'codm-br': 'Call of Duty: Mobile Battle Royale' };
const gameOf = (b: BracketDraft) => publicationGameKey(b).replace(/^game-/, '');
const ref = (b: BracketDraft, m?: Match): KnowledgeReference => ({ label: m ? `${b.title} · ${m.matchNumber || m.roundName}` : b.title, bracketId: b.id, ...(m ? { matchId: m.id } : {}) });
const playable = (m: Match) => !m.inactive && !m.team1?.isBye && !m.team2?.isBye;
const name = (t?: Team) => t?.name || 'To be decided';

function matchView(m: Match, today: string) {
  const scored = [m.score?.team1Score, m.score?.team2Score].every(Number.isFinite);
  const winner = m.winnerId ? (m.winnerId === m.team1?.id ? m.team1?.name : m.winnerId === m.team2?.id ? m.team2?.name : undefined) : undefined;
  return {
    id: m.id, number: m.matchNumber, round: m.roundName, status: m.status,
    ...(m.lobby ? { lobby: { squads: m.lobby.squads, ...(m.lobby.winner ? { winner: m.lobby.winner } : {}) } } : {
      team1: { name: name(m.team1), college: m.team1?.collegeCode || '' },
      team2: { name: name(m.team2), college: m.team2?.collegeCode || '' },
      score: scored && m.status !== 'upcoming' ? `${m.score.team1Score}-${m.score.team2Score}` : null,
      ...(winner && m.status === 'completed' ? { winner } : {}),
      series: m.matchFormat || '',
    }),
    date: scheduleDate(m.scheduledDate || '', today) || null,
    time: m.scheduledTime && timeOrder(m.scheduledTime) !== 9999 ? `${m.scheduledTime} Manila time` : null,
    ...(m.streamTitle ? { stream: m.streamTitle } : {}),
  };
}

function findBracket(brackets: BracketDraft[], key: string) {
  const k = key.trim().toLowerCase();
  return brackets.find(b => b.id === key) || brackets.find(b => b.title.toLowerCase() === k)
    || brackets.find(b => b.title.toLowerCase().includes(k) || gameOf(b) === k);
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const gameParam = { type: 'string', enum: [...GAMES], description: 'mlbb, dota2, codm-mp (Multiplayer) or codm-br (Battle Royale).' };

const FORMATS: Record<string, string> = {
  'single-elimination': 'Single elimination: lose one series and you are out. The winner of each match advances until one team is left.',
  'double-elimination': 'Double elimination: a team is out only after losing two series. Losers drop to the lower bracket; the upper-bracket finalist may need to be beaten twice in the grand final (a bracket reset).',
  'round-robin': 'Round robin: every team plays every other team in its group. Standings rank teams by series wins, then game difference.',
  'battle-royale': 'Battle Royale points: all squads play the same lobby games. Each game awards placement points plus points per elimination; the event standings add them up. Ties break on placement points, then best placement, then eliminations, then the latest game.',
  'best-of': 'Best of N (Bo1, Bo3, Bo5, Bo7): the first team to win more than half of N games wins the series. A Bo3 ends at 2 wins, a Bo5 at 3.',
};
const HELP: Record<string, string> = {
  schedule: 'Open Schedule for every scheduled match with its date, time (Manila time), teams and round. Organizers set the official schedule.',
  brackets: 'Open Brackets to see each published tournament, its rounds and results. Battle Royale events show placement standings instead of a bracket.',
  live: 'Open Match center for live matches. Each live match has a stream, the score and a live chat for signed-in campus students.',
  chat: 'Live chat is for signed-in campus students. Staff can turn on slow mode, mute or remove viewers, and pin a message. Type @Arena before a question to ask Arena AI about the match.',
  'fair-play': 'Open Fair play to submit evidence about a match: choose the match, add a replay timestamp and a viewable link. Organizers review every report; ArenaHub does not detect in-game cheats.',
  admission: 'Personal accounts join as spectators by scanning a campus student\'s invite QR code. Campus accounts can read everything public after signing in.',
  registration: 'Team registration and rosters are handled by facilitators on the organizer side. Only in-game names, roles and colleges are public.',
  account: 'Sign in with your campus Google account. Organizer access is granted by the project administrator only.',
};

/** Builds the tools for one request. Staff tools exist only for staff callers. */
export function buildTools(ctx: ToolContext): Tool[] {
  const today = manilaToday(new Date(ctx.checkedAt));
  const inGame = (game?: string) => ctx.brackets.filter(b => !game || gameOf(b) === game);
  const tool = <S extends z.ZodTypeAny>(spec: ToolSpec, schema: S, run: (args: z.infer<S>) => ToolResult | Promise<ToolResult>): Tool => ({
    ...spec,
    async run(raw) {
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) return { data: { error: 'Invalid arguments for this tool.' }, references: [] };
      return run(parsed.data);
    },
  });
  const game = z.enum(GAMES).optional();

  const tools: Tool[] = [
    tool({ name: 'listTournaments', description: 'List published tournaments, optionally for one game, with counts of live, upcoming and finished matches and the champion if decided.', parameters: object({ game: gameParam }) },
      z.object({ game }), ({ game }) => {
        const list = inGame(game);
        return {
          data: list.map(b => {
            const matches = scheduleMatches(b).filter(playable);
            const champion = b.placement ? null : recordedChampion(b);
            return {
              id: b.id, title: b.title, game: b.gameName, format: b.format, series: b.matchFormat,
              teams: b.placement ? b.placement.teams.length : bracketTeams(b).length,
              live: matches.filter(m => m.status === 'live').length, upcoming: matches.filter(m => m.status === 'upcoming' || m.status === 'pre-match').length,
              finished: matches.filter(m => m.status === 'completed').length,
              champion: champion ? (champion.winner === champion.team1.id ? champion.team1.name : champion.team2.name) : null,
            };
          }),
          references: list.map(b => ref(b)),
        };
      }),
    tool({ name: 'getBracket', description: 'Rounds and matches of one tournament (by id, title or game). For Battle Royale, the lobby games.', parameters: object({ tournament: { type: 'string', description: 'Tournament id, title, or game key.' } }, ['tournament']) },
      z.object({ tournament: z.string().min(1).max(160) }), ({ tournament }) => {
        const b = findBracket(ctx.brackets, tournament);
        if (!b) return { data: { error: 'No published tournament matches that.' }, references: [] };
        const matches = scheduleMatches(b).filter(playable).slice(0, 64);
        return { data: { id: b.id, title: b.title, game: b.gameName, format: b.format, series: b.matchFormat, matches: matches.map(m => matchView(m, today)) }, references: [ref(b)] };
      }),
    tool({ name: 'getMatch', description: 'One match: teams, score, status, schedule, both rosters (in-game names and roles), recorded timeline and MVP.', parameters: object({ matchId: { type: 'string' } }, ['matchId']) },
      z.object({ matchId: z.string().min(1).max(160) }), ({ matchId }) => {
        for (const b of ctx.brackets) {
          const m = scheduleMatches(b).find(x => x.id === matchId || x.matchNumber === matchId);
          if (!m) continue;
          const roster = (t?: Team) => t ? { team: t.name, college: t.collegeCode, players: (t.players || []).slice(0, 12).map(p => ({ ign: p.ign, role: p.role || '' })) } : null;
          const mvp = typeof m.mvp === 'object' && m.mvp ? { ign: m.mvp.ign, role: m.mvp.role, team: m.mvp.teamCode } : null;
          return { data: { tournament: b.title, game: b.gameName, match: matchView(m, today), rosters: [roster(m.team1), roster(m.team2)].filter(Boolean), timeline: sortedTimeline(m.timelineEvents || []).slice(-20).map(e => ({ time: e.time, type: e.type || '', team: e.team || '', text: e.text })), mvp }, references: [ref(b, m)] };
        }
        return { data: { error: 'No published match has that id.' }, references: [] };
      }),
    tool({ name: 'getLiveMatches', description: 'Every match that is live right now, with the current (not final) score.', parameters: object({ game: gameParam }) },
      z.object({ game }), ({ game }) => {
        const live = inGame(game).flatMap(b => scheduleMatches(b).filter(m => playable(m) && m.status === 'live').map(m => ({ b, m })));
        return { data: live.map(({ b, m }) => ({ tournament: b.title, game: b.gameName, ...matchView(m, today) })), references: live.map(({ b, m }) => ref(b, m)) };
      }),
    tool({ name: 'getSchedule', description: 'Upcoming matches in date and time order (Manila time). Optionally one game or one date (YYYY-MM-DD).', parameters: object({ game: gameParam, date: { type: 'string', description: 'YYYY-MM-DD' } }) },
      z.object({ game, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), ({ game, date }) => {
        const rows = inGame(game).flatMap(b => scheduleMatches(b).filter(m => playable(m) && ['upcoming', 'pre-match'].includes(m.status)).map(m => ({ b, m, day: scheduleDate(m.scheduledDate || '', today) })))
          .filter(row => !date || row.day === date)
          .sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || timeOrder(a.m.scheduledTime || '') - timeOrder(b.m.scheduledTime || ''))
          .slice(0, 20);
        return { data: { today, matches: rows.map(({ b, m }) => ({ tournament: b.title, game: b.gameName, ...matchView(m, today) })) }, references: rows.map(({ b, m }) => ref(b, m)) };
      }),
    tool({ name: 'getStandings', description: 'Standings of one tournament: series records, or placement points for Battle Royale.', parameters: object({ tournament: { type: 'string' } }, ['tournament']) },
      z.object({ tournament: z.string().min(1).max(160) }), ({ tournament }) => {
        const b = findBracket(ctx.brackets, tournament);
        if (!b) return { data: { error: 'No published tournament matches that.' }, references: [] };
        if (b.placement) {
          const event = b.placement, done = event.games.filter(g => g.status === 'completed').length;
          return { data: { title: b.title, kind: 'placement points', gamesFinished: done, gamesPlanned: event.games.length, final: done === event.games.length && done > 0, rows: computeStandings(event).map(r => ({ rank: r.rank, squad: r.name, college: r.collegeCode, points: r.total, eliminations: r.kills, wins: r.wins })) }, references: [ref(b)] };
        }
        return { data: { title: b.title, kind: 'series records', rows: getStandings(b.matches).map(r => ({ team: r.team.name, college: r.team.collegeCode, wins: r.wins, losses: r.losses, games: `${r.gameWins}-${r.gameLosses}` })) }, references: [ref(b)] };
      }),
    tool({ name: 'getTeam', description: 'Find a team by name or college code: its tournaments, roster (in-game names and roles) and series record.', parameters: object({ name: { type: 'string' } }, ['name']) },
      z.object({ name: z.string().min(2).max(80) }), ({ name: query }) => {
        const q = query.trim().toLowerCase(), found: Array<{ b: BracketDraft; data: unknown }> = [];
        for (const b of ctx.brackets) {
          if (b.placement) {
            for (const t of b.placement.teams) if (t.name.toLowerCase().includes(q) || t.collegeCode.toLowerCase() === q) {
              const row = computeStandings(b.placement).find(r => r.teamId === t.id);
              found.push({ b, data: { team: t.name, college: t.collegeCode, tournament: b.title, rank: row?.rank ?? null, points: row?.total ?? 0 } });
            }
            continue;
          }
          const standings = getStandings(b.matches);
          for (const t of bracketTeams(b)) if (t.name.toLowerCase().includes(q) || t.collegeCode?.toLowerCase() === q) {
            const row = standings.find(r => r.team.id === t.id);
            found.push({ b, data: { team: t.name, college: t.collegeCode, tournament: b.title, players: (t.players || []).slice(0, 12).map(p => ({ ign: p.ign, role: p.role || '' })), wins: row?.wins ?? 0, losses: row?.losses ?? 0 } });
          }
        }
        return { data: found.slice(0, 6).map(f => f.data), references: found.slice(0, 6).map(f => ref(f.b)) };
      }),
    tool({ name: 'explainFormat', description: 'Explain a competition format.', parameters: object({ format: { type: 'string', enum: Object.keys(FORMATS) } }, ['format']) },
      z.object({ format: z.enum(Object.keys(FORMATS) as [string, ...string[]]) }), ({ format }) => ({ data: { format, explanation: FORMATS[format] }, references: [] })),
    tool({ name: 'getPlatformHelp', description: 'How to use ArenaHub: schedule, brackets, live, chat, fair-play, admission, registration, account.', parameters: object({ topic: { type: 'string', enum: Object.keys(HELP) } }, ['topic']) },
      z.object({ topic: z.enum(Object.keys(HELP) as [string, ...string[]]) }), ({ topic }) => ({ data: { topic, help: HELP[topic] }, references: [] })),
    tool({ name: 'getRules', description: 'The rules ArenaHub enforces for a tournament: series lengths, Battle Royale points, chat and fair-play rules. Not the organizers\' full rulebook.', parameters: object({ tournament: { type: 'string' } }) },
      z.object({ tournament: z.string().min(1).max(160).optional() }), ({ tournament }) => {
        const b = tournament ? findBracket(ctx.brackets, tournament) : undefined;
        const finals = b && !b.placement ? [...new Set(b.matches.filter(m => !m.nextMatchId && !m.inactive).map(m => m.matchFormat).filter(Boolean))] : [];
        return {
          data: {
            note: 'The organizers\' official rulebook is not published in ArenaHub. For eligibility, disputes or penalties, ask the tournament organizers.',
            ...(b ? { tournament: b.title, format: b.format, series: b.matchFormat, ...(finals.length ? { finalSeries: finals.join(', ') } : {}),
              ...(b.placement ? { pointsPerPlacement: b.placement.config.pointsTable, pointsPerElimination: b.placement.config.killPoints, games: b.placement.games.length } : {}) } : {}),
            chat: 'Be respectful. Staff can mute, remove or slow down chat. Messages are limited to 500 characters.',
            fairPlay: 'Submit evidence through Fair play. Organizers review it; a replay alone cannot prove hidden software.',
          },
          references: b ? [ref(b)] : [],
        };
      }),
  ];

  if (ctx.staff && ctx.openReports) {
    const openReports = ctx.openReports;
    tools.push(tool({ name: 'listOpenReports', description: 'Staff only: open fair-play cases waiting for review (case id, status, match, age, evidence count). No reporter details.', parameters: object({}) },
      z.object({}), async () => ({ data: await openReports(), references: [] })));
  }
  return tools;
}

export const gameLabel = (key: string) => GAME_NAMES[key] || key;
