import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineStatSheets, hasPlayerStats, matchStatSheets, seriesPlayerStats } from '../src/lib/matchStats';
import { mvpCandidates } from '../src/lib/matchHighlights';
import type { Match, Player, Team } from '../src/lib/types';

const player = (id: string, ign: string): Player => ({ id, name: ign, ign, role: 'Jungler', collegeId: '', isVerified: true });
const team = (id: string, code: string, players: Player[]): Team => ({ id, name: `${code} Team`, collegeId: '', collegeCode: code, gameId: 'game-mlbb', seed: 1, winRate: 0, record: '', players });
const sheet = (stats: Record<string, Record<string, unknown>>) => ({ playerStats: stats as any, notes: '' });
function match(score: [number, number], games: Record<string, ReturnType<typeof sheet>> | undefined, extra: Partial<Match> = {}): Match {
  return {
    id: 'm', matchNumber: 'M1', tournamentId: 't', gameId: 'game-mlbb', round: 1, roundName: 'Final', bracketType: 'final', matchFormat: 'Bo3',
    status: 'completed', score: { team1Score: score[0], team2Score: score[1] }, scheduledDate: '', scheduledTime: '', organizerName: '',
    team1: team('a', 'CCS', [player('a1', 'Riley'), player('a2', 'Nova')]), team2: team('b', 'COE', [player('b1', 'Bolt')]),
    statGames: games, playerStats: games ? Object.values(games).at(-1)?.playerStats : undefined, ...extra,
  } as Match;
}
const games = {
  1: sheet({ a1: { kills: 5, deaths: 1, assists: 3, gold: '9000' }, b1: { kills: 2, deaths: 4, assists: 1 } }),
  2: sheet({ a1: { kills: 1, deaths: 3, assists: 2, gold: '7500' }, b1: { kills: 6, deaths: 2, assists: 0 } }),
  3: sheet({ a1: { kills: 4, deaths: 0, assists: 7, gold: '11000' }, b1: { kills: 1, deaths: 3, assists: 2 } }),
};

test('series totals add every played game, not the last sheet saved', () => {
  const totals = seriesPlayerStats(match([2, 1], games));
  assert.deepEqual([totals.a1.kills, totals.a1.deaths, totals.a1.assists, totals.a1.games], [10, 4, 12, 3]);
  assert.deepEqual([totals.b1.kills, totals.b1.deaths, totals.b1.assists], [9, 9, 3]);
  assert.equal(totals.a1.gold, '27,500');
});

test('one game shows that game only, with the value the organizer typed', () => {
  const m = match([2, 1], games);
  const g2 = combineStatSheets(m, matchStatSheets(m).filter(s => s.game === 2));
  assert.deepEqual([g2.a1.kills, g2.a1.deaths, g2.a1.assists, g2.a1.gold], [1, 3, 2, '7500']);
});

test('a finished series ignores sheets for games that were not played; a live one keeps them', () => {
  assert.deepEqual(matchStatSheets(match([2, 0], games)).map(s => s.game), [1, 2]);
  assert.deepEqual(matchStatSheets(match([1, 1], games, { status: 'live' })).map(s => s.game), [1, 2, 3]);
  assert.deepEqual(matchStatSheets(match([1, 0], { 9: games[1] }, { status: 'live' })).map(s => s.game), [], 'beyond a Bo3');
});

test('older records with only playerStats count as one unnumbered game', () => {
  const m = match([2, 0], undefined, { playerStats: { a1: { kills: 3, deaths: 1, assists: 2 } } });
  assert.deepEqual(matchStatSheets(m).map(s => s.game), [null]);
  assert.equal(seriesPlayerStats(m).a1.kills, 3);
  assert.equal(hasPlayerStats(match([0, 0], undefined, { status: 'upcoming' })), false);
});

test('lines keyed by IGN join the roster player; invalid and duplicate lines are left out', () => {
  const m = match([2, 0], {
    1: sheet({ a1: { kills: 2, deaths: 1, assists: 1 }, RILEY: { kills: 9, deaths: 0, assists: 0, ign: 'riley' }, a2: { kills: -1, deaths: 0, assists: 0 } }),
    2: sheet({ nova: { kills: 3, deaths: 2, assists: 4, ign: 'Nova' }, a1: { kills: 1, deaths: 1, assists: 1 } }),
  });
  const totals = seriesPlayerStats(m);
  assert.deepEqual([totals.a1.kills, totals.a1.games], [3, 2], 'the second Riley line in game 1 is a duplicate');
  assert.deepEqual([totals.a2.kills, totals.a2.games, totals.a2.ign], [3, 1, 'Nova'], 'game 1 for Nova was invalid');
});

test('gold that is not a plain number is not summed across games', () => {
  const m = match([2, 0], { 1: sheet({ a1: { kills: 1, deaths: 1, assists: 1, gold: '12.5k' } }), 2: sheet({ a1: { kills: 1, deaths: 1, assists: 1, gold: '8000' } }) });
  assert.equal(seriesPlayerStats(m).a1.gold, undefined);
});

test('the MVP picker shows series K/D/A', () => {
  const candidates = mvpCandidates(match([2, 1], games));
  assert.deepEqual(candidates.map(c => [c.ign, c.kda]), [['Riley', '10/4/12'], ['Nova', undefined], ['Bolt', '9/9/3']]);
});
