import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerLeaderboards, rankLeaderboard, KDA_MIN_GAMES, type LeaderboardSource } from '../src/lib/playerLeaderboard';
import type { BracketDraft, Match, Player, Team } from '../src/lib/types';

const player = (id: string, ign: string, role = 'Jungler'): Player => ({ id, name: ign, ign, role, collegeId: '', isVerified: true });
const team = (id: string, name: string, collegeCode: string, players: Player[]): Team =>
  ({ id, name, collegeId: '', collegeCode, gameId: 'game-mlbb', seed: 1, winRate: 0, record: '', players });
type Sheet = Record<string, { kills: number; deaths: number; assists: number; [key: string]: unknown }>;

function match(id: string, t1: Team, t2: Team, score: [number, number], games: Record<string, Sheet> = {}, extra: Partial<Match> = {}): Match {
  return {
    id, matchNumber: `#${id}`, tournamentId: 't', gameId: 'game-mlbb', round: 1, roundName: 'Final', bracketType: 'upper', matchFormat: 'Bo3',
    status: 'completed', score: { team1Score: score[0], team2Score: score[1] }, scheduledDate: '2026-11-20', scheduledTime: '13:00', organizerName: '',
    team1: t1, team2: t2, winnerId: score[0] > score[1] ? t1.id : t2.id,
    statGames: Object.keys(games).length ? Object.fromEntries(Object.entries(games).map(([n, sheet]) => [n, { playerStats: sheet, notes: '' }])) : undefined,
    // playerStats mirrors the last game saved, exactly as firestore.saveMatchPlayerStats writes it.
    playerStats: Object.values(games).at(-1), ...extra,
  } as Match;
}
const bracket = (id: string, matches: Match[], extra: Partial<BracketDraft> = {}): BracketDraft => ({
  id, title: `Cup ${id}`, gameName: 'Mobile Legends: Bang Bang', gameId: 'game-mlbb', format: 'Single Elimination', teamsCount: 2, matchFormat: 'Bo3',
  seedingRule: '', matches, teams: [], parsedParams: {} as BracketDraft['parsedParams'], rawPrompt: '', createdAt: '', status: 'published', ...extra,
});
const board = (sources: LeaderboardSource[], gameKey = 'game-mlbb') => buildPlayerLeaderboards(sources).find(b => b.gameKey === gameKey)!;
const row = (sources: LeaderboardSource[], ign: string) => board(sources).rows.find(r => r.ign.toLowerCase() === ign.toLowerCase());

const alpha = team('a', 'CCS Alpha', 'CCS', [player('a-p0', 'Riley'), player('a-p1', 'Nova', 'Mage')]);
const bravo = team('b', 'COE Bravo', 'COE', [player('b-p0', 'Bolt'), player('b-p1', 'Kite', 'Marksman')]);

test('a series sums every played game, not just the last sheet saved', () => {
  const m = match('m1', alpha, bravo, [2, 1], {
    1: { 'a-p0': { kills: 5, deaths: 1, assists: 3 }, 'b-p0': { kills: 2, deaths: 4, assists: 1 } },
    2: { 'a-p0': { kills: 1, deaths: 3, assists: 2 }, 'b-p0': { kills: 6, deaths: 2, assists: 0 } },
    3: { 'a-p0': { kills: 4, deaths: 0, assists: 7 }, 'b-p0': { kills: 1, deaths: 3, assists: 2 } },
  });
  const riley = row([{ bracket: bracket('t1', [m]), current: true }], 'Riley')!;
  assert.deepEqual([riley.games, riley.kills, riley.deaths, riley.assists], [3, 10, 4, 12]);
  assert.equal(riley.kda, 22 / 4);
  assert.deepEqual([riley.matches, riley.wins, riley.losses], [1, 1, 0]);
  const bolt = row([{ bracket: bracket('t1', [m]), current: true }], 'Bolt')!;
  assert.deepEqual([bolt.kills, bolt.wins, bolt.losses], [9, 0, 1]);
  assert.equal(bolt.history[0].seriesScore, '1–2');
});

test('stats saved for a game that was never played do not count', () => {
  const m = match('m1', alpha, bravo, [2, 0], {
    1: { 'a-p0': { kills: 3, deaths: 1, assists: 1 } },
    2: { 'a-p0': { kills: 2, deaths: 1, assists: 1 } },
    3: { 'a-p0': { kills: 50, deaths: 0, assists: 0 } },
  });
  const riley = row([{ bracket: bracket('t1', [m]), current: true }], 'Riley')!;
  assert.deepEqual([riley.games, riley.kills], [2, 5]);
});

test('only finished series with a valid result count; live matches and empty results are reported', () => {
  const sheet = { 1: { 'a-p0': { kills: 9, deaths: 0, assists: 0 } } };
  const sources = [{ bracket: bracket('t1', [
    match('live', alpha, bravo, [1, 0], sheet, { status: 'live' }),
    match('upcoming', alpha, bravo, [0, 0], sheet, { status: 'upcoming' }),
    match('impossible', alpha, bravo, [3, 0], sheet),
    match('no-winner', alpha, bravo, [1, 1], sheet),
    match('wrong-winner', alpha, bravo, [2, 0], sheet, { winnerId: 'b' }),
    match('bye', alpha, { ...bravo, isBye: true }, [2, 0], sheet),
    match('blank', alpha, bravo, [2, 0]),
  ]), current: true }];
  const b = board(sources);
  assert.equal(b.rows.length, 0);
  assert.equal(b.liveMatches, 1);
  assert.equal(b.finishedWithoutStats, 1, 'only "blank" is a valid finished series');
  assert.equal(b.tournaments[0].countedMatches, 0);
});

test('demo and retired-game brackets are left out', () => {
  const m = match('m1', alpha, bravo, [2, 0], { 1: { 'a-p0': { kills: 3, deaths: 1, assists: 1 } } });
  assert.equal(buildPlayerLeaderboards([{ bracket: bracket('demo', [m], { demo: true }), current: true }]).length, 0);
  assert.equal(buildPlayerLeaderboards([{ bracket: bracket('val', [m], { gameId: 'game-val', gameName: 'Valorant' }), current: true }]).length, 0);
});

test('the same player is merged across a past and a current tournament', () => {
  // Each tournament gives its roster new player IDs; the IGN differs only in case and spacing.
  const past = bracket('past', [match('p1', team('x', 'CCS Alpha', 'ccs', [player('x-p0', ' riley ')]), bravo, [2, 0],
    { 1: { 'x-p0': { kills: 4, deaths: 1, assists: 2 } }, 2: { 'x-p0': { kills: 2, deaths: 2, assists: 2 } } })]);
  const now = bracket('now', [match('n1', team('y', 'CCS Prime', 'CCS', [player('y-p3', 'Riley', 'Gold Laner')]), bravo, [0, 2],
    { 1: { 'y-p3': { kills: 1, deaths: 3, assists: 1 } }, 2: { 'y-p3': { kills: 3, deaths: 2, assists: 0 } } })]);
  const rows = board([{ bracket: now, current: true }, { bracket: past, current: false }]).rows.filter(r => r.ign === 'Riley');
  assert.equal(rows.length, 1);
  const [riley] = rows;
  assert.deepEqual([riley.games, riley.kills, riley.deaths, riley.assists, riley.tournaments], [4, 10, 8, 5, 2]);
  assert.deepEqual([riley.wins, riley.losses], [1, 1]);
  assert.deepEqual([riley.teamName, riley.role], ['CCS Prime', 'Gold Laner'], 'the current tournament supplies the team and role');
  assert.deepEqual(riley.history.map(h => h.tournamentId), ['past', 'now']);
});

test('the same IGN at two colleges is two players', () => {
  const other = team('c', 'CAIS Comets', 'CAIS', [player('c-p0', 'Riley')]);
  const m = match('m1', alpha, other, [2, 0], { 1: { 'a-p0': { kills: 1, deaths: 1, assists: 1 }, 'c-p0': { kills: 2, deaths: 2, assists: 2 } } });
  assert.equal(board([{ bracket: bracket('t1', [m]), current: true }]).rows.filter(r => r.ign === 'Riley').length, 2);
});

test('a tournament present in both lists during a restore is counted once', () => {
  const b = bracket('t1', [match('m1', alpha, bravo, [2, 0], { 1: { 'a-p0': { kills: 3, deaths: 1, assists: 1 } } })]);
  const riley = row([{ bracket: b, current: false }, { bracket: b, current: true }], 'Riley')!;
  assert.deepEqual([riley.kills, riley.matches, riley.tournaments], [3, 1, 1]);
});

test('invalid numbers, strangers and duplicate lines are skipped, not guessed', () => {
  const m = match('m1', alpha, bravo, [2, 0], {
    1: {
      'a-p0': { kills: 2, deaths: 1, assists: 1 },
      'riley-again': { kills: 7, deaths: 0, assists: 0, ign: 'RILEY', teamCode: 'CCS' },
      'a-p1': { kills: -1, deaths: 1, assists: 1 },
      'b-p0': { kills: 1.5, deaths: 1, assists: 1 },
      'b-p1': { kills: 1000, deaths: 1, assists: 1 },
      ghost: { kills: 9, deaths: 0, assists: 9, ign: 'Ghost', teamCode: 'CCS' },
    },
  });
  const b = board([{ bracket: bracket('t1', [m]), current: true }]);
  assert.deepEqual(b.rows.map(r => [r.ign, r.kills]), [['Riley', 2]]);
  assert.equal(b.skippedRows, 5);
});

test('stats keyed by IGN still find the roster player; a missing roster uses the row only when one side matches', () => {
  const byIgn = match('m1', alpha, bravo, [1, 0], { 1: { nova: { kills: 4, deaths: 1, assists: 0, ign: 'Nova', teamCode: 'CCS' } } }, { matchFormat: 'Bo1' });
  assert.equal(row([{ bracket: bracket('t1', [byIgn]), current: true }], 'Nova')!.kills, 4);
  const noRoster = match('m2', { ...alpha, players: [] }, { ...bravo, players: [] }, [1, 0],
    { 1: { x: { kills: 3, deaths: 2, assists: 1, ign: 'Echo', teamCode: 'COE' } } }, { matchFormat: 'Bo1' });
  const echo = row([{ bracket: bracket('t2', [noRoster]), current: true }], 'Echo')!;
  assert.deepEqual([echo.collegeCode, echo.losses], ['COE', 1]);
});

test('older records with only playerStats count as one game', () => {
  const m = match('m1', alpha, bravo, [2, 1], {}, { playerStats: { 'a-p0': { kills: 6, deaths: 2, assists: 4 } }, statGames: undefined });
  const riley = row([{ bracket: bracket('t1', [m]), current: true }], 'Riley')!;
  assert.deepEqual([riley.games, riley.kills, riley.matches], [1, 6, 1]);
});

test('MVP awards count, including for a player without stats', () => {
  const m1 = match('m1', alpha, bravo, [2, 0], { 1: { 'a-p0': { kills: 3, deaths: 1, assists: 1 } } },
    { mvp: { playerName: 'Riley', ign: 'Riley', role: 'Jungler', teamCode: 'CCS' } });
  const m2 = match('m2', alpha, bravo, [0, 2], {}, { mvp: 'kite' });
  const b = board([{ bracket: bracket('t1', [m1, m2]), current: true }]);
  assert.equal(b.rows.find(r => r.ign === 'Riley')!.mvps, 1);
  const kite = b.rows.find(r => r.ign === 'Kite')!;
  assert.deepEqual([kite.mvps, kite.games, kite.matches, kite.wins], [1, 0, 1, 1]);
  assert.equal(b.finishedWithoutStats, 0);
});

test('KDA rank needs enough games; exact ties share a rank', () => {
  const games = (n: number, k: number, d: number, a: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { 'a-p0': { kills: k, deaths: d, assists: a } }]));
  const p = (id: string, ign: string, code: string) => team(id, `${code} Team`, code, [player(`${id}-p0`, ign)]);
  // A clean sweep of n games: Bo1 for one game, Bo5 (3–0) for three.
  const mk = (id: string, t: Team, n: number, k: number, d: number, a: number) =>
    match(id, { ...t, players: [{ ...t.players[0], id: 'a-p0' }] }, bravo, [n, 0], games(n, k, d, a), { matchFormat: n === 1 ? 'Bo1' : 'Bo5' });
  const sources = [{ bracket: bracket('t1', [
    mk('m1', p('t1', 'Ace', 'CCS'), 3, 2, 1, 0),   // 6 kills, 3 deaths: KDA 2.00
    mk('m2', p('t2', 'Bee', 'COE'), 3, 2, 1, 0),   // identical: shares the rank
    mk('m3', p('t3', 'Cid', 'CAIS'), 3, 1, 1, 1),  // KDA 2.00, fewer kills
    mk('m4', p('t4', 'Dot', 'CLA'), 1, 20, 0, 0),  // KDA 20 but only one game
  ]), current: true }];
  const rows = board(sources).rows;
  assert.ok(KDA_MIN_GAMES > 1);
  assert.deepEqual(rows.map(r => [r.ign, r.rank]), [['Ace', 1], ['Bee', 1], ['Cid', 3], ['Dot', null]]);
  const byKills = rankLeaderboard(rows, 'kills');
  assert.deepEqual(byKills.map(r => [r.ign, r.rank]), [['Dot', 1], ['Ace', 2], ['Bee', 2], ['Cid', 4]]);
});

test('series wins rank by wins, then fewer losses', () => {
  const t = (id: string, ign: string, code: string) => team(id, `${code} Team`, code, [player(`${id}-p0`, ign)]);
  const one = t('t1', 'One', 'CCS'), two = t('t2', 'Two', 'COE'), three = t('t3', 'Three', 'CAIS');
  const s = (id: string) => ({ 1: { [`${id}-p0`]: { kills: 1, deaths: 1, assists: 1 } } });
  const both = (a: Team, b: Team) => ({ 1: { ...s(a.id)[1], ...s(b.id)[1] } });
  const sources = [{ bracket: bracket('t', [
    match('m1', one, two, [1, 0], both(one, two), { matchFormat: 'Bo1' }),
    match('m2', one, three, [1, 0], both(one, three), { matchFormat: 'Bo1' }),
    match('m3', three, two, [1, 0], both(three, two), { matchFormat: 'Bo1' }),
  ]), current: true }];
  assert.deepEqual(rankLeaderboard(board(sources).rows, 'wins').map(r => [r.ign, r.wins, r.losses, r.rank]),
    [['One', 2, 0, 1], ['Three', 1, 1, 2], ['Two', 0, 2, 3]]);
});

test('Battle Royale events are listed but do not track individual players', () => {
  const br = bracket('br', [], { gameId: 'game-codm-br', gameName: 'CODM Battle Royale', placement: { config: { pointsTable: [10], killPoints: 1 }, teams: [], games: [] } as unknown as BracketDraft['placement'] });
  const b = board([{ bracket: br, current: true }], 'game-codm-br');
  assert.equal(b.tracksPlayers, false);
  assert.equal(b.rows.length, 0);
});
