import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_W, COL_GAP, layoutBracket } from '../src/lib/bracketLayout.ts';
import type { Match } from '../src/lib/types.ts';

const team = (id: string) => ({ id, name: id, collegeCode: id, players: [] }) as unknown as Match['team1'];
const m = (id: string, round: number, extra: Partial<Match> = {}): Match => ({
  id, matchNumber: `#${id}`, tournamentId: 't', gameId: 'g', round, roundName: `R${round}`, bracketType: 'upper',
  score: { team1Score: 0, team2Score: 0 }, status: 'upcoming', matchFormat: 'Bo3', scheduledTime: '', scheduledDate: '', organizerName: '', ...extra,
} as Match);

test('single elimination: a match sits level between its two feeders and the champion follows the final', () => {
  const final = m('F', 2, { team1: team('A'), team2: team('C'), status: 'completed', winnerId: 'A', score: { team1Score: 2, team2Score: 1 } });
  const layout = layoutBracket([m('S1', 1, { nextMatchId: 'F' }), m('S2', 1, { nextMatchId: 'F' }), final]);
  const at = (id: string) => layout.placed.find(p => p.match.id === id)!;
  assert.equal(at('F').y, (at('S1').y + at('S2').y) / 2);
  assert.equal(layout.links.length, 2);
  assert.equal(layout.champion?.team?.id, 'A');
  assert.equal(layout.champion?.x, at('F').x + CARD_W + COL_GAP);
});

test('double elimination: lower lane under the upper lane, grand final to the right, reset final ignored until played', () => {
  const matches = [
    m('U1', 1, { nextMatchId: 'UF' }), m('U2', 1, { nextMatchId: 'UF' }), m('UF', 2, { nextMatchId: 'GF' }),
    m('L1', 1, { bracketType: 'lower', sources: [{ matchId: 'U1', result: 'loser' }, { matchId: 'U2', result: 'loser' }], nextMatchId: 'LF' }),
    m('LF', 2, { bracketType: 'lower', sources: [{ matchId: 'L1', result: 'winner' }, { matchId: 'UF', result: 'loser' }], nextMatchId: 'GF' }),
    m('GF', 3, { bracketType: 'final', sources: [{ matchId: 'UF', result: 'winner' }, { matchId: 'LF', result: 'winner' }] }),
    m('GF2', 4, { bracketType: 'final', inactive: true, sources: [{ matchId: 'GF', result: 'winner' }, { matchId: 'GF', result: 'loser' }] }),
  ];
  const layout = layoutBracket(matches);
  const at = (id: string) => layout.placed.find(p => p.match.id === id)!;
  assert.deepEqual(layout.laneLabels.map(l => l.title), ['Upper bracket', 'Lower bracket']);
  assert.ok(Math.min(at('L1').y, at('LF').y) > Math.max(at('U1').y, at('U2').y, at('UF').y), 'lower lane is below the upper lane');
  assert.ok(at('GF').x > Math.max(at('UF').x, at('LF').x), 'grand final is right of both lanes');
  assert.equal(at('GF').y, (at('UF').y + at('LF').y) / 2);
  assert.equal(layout.champion?.from?.match.id, 'GF', 'an unplayed reset final does not decide the champion');
  // Loser drops are labelled in the cards, not drawn as lines.
  assert.ok(!layout.links.some(link => link.from.match.id === 'U1' && link.to.match.id === 'L1'));
});

test('round robin: rounds become columns, no paths, champion from standings only when every match is played', () => {
  const rr = (id: string, round: number, done: boolean) => m(id, round, { tournamentFormat: 'round-robin', team1: team('A'), team2: team('B'),
    status: done ? 'completed' : 'upcoming', winnerId: done ? 'A' : undefined, score: done ? { team1Score: 1, team2Score: 0 } : { team1Score: 0, team2Score: 0 }, matchFormat: 'Bo1' });
  const open = layoutBracket([rr('a', 1, true), rr('b', 2, false)]);
  assert.equal(open.mode, 'rounds');
  assert.equal(open.links.length, 0);
  assert.equal(open.champion?.team, undefined);
  const done = layoutBracket([rr('a', 1, true), rr('b', 2, true)]);
  assert.equal(done.champion?.team?.id, 'A');
  assert.equal(done.champion?.byStandings, true);
});
