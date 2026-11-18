import test from 'node:test';
import assert from 'node:assert/strict';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { seriesWinsNeeded, type Match } from '../src/lib/types';
import { inspectCheckIn, matchTeamIds, parseLineup, parseRoster, type Registration, type CheckIn } from '../src/lib/tournamentOperations';
import { reviewSampleTimes, validateFrameFindings } from '../src/lib/videoReview';
const make = (n: number, format: string) => createBracketFromTeams({ title: 'Test event', teams: Array.from({ length: n }, (_, i) => ({ name: `Team ${i + 1}` })), format });
const finish = (matches: Match[], match: Match, side: 1 | 2 = 1) => updateMatchAndAdvance(matches, { ...match, score: { team1Score: side === 1 ? seriesWinsNeeded(match.matchFormat) : 0, team2Score: side === 2 ? seriesWinsNeeded(match.matchFormat) : 0 }, status: 'completed', winnerId: (side === 1 ? match.team1 : match.team2)?.id });
test('double elimination gives every eliminated team exactly two played losses for arbitrary sizes', () => {
  for (let n = 2; n <= 19; n++) for (const reset of [false, true]) {
    let matches = make(n, 'Double Elimination').matches;
    const losses = new Map<string, number>(); let played = 0;
    while (true) {
      const match = matches.find(m => !m.inactive && m.status !== 'completed' && m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye);
      if (!match) break;
      assert.notEqual(match.team1!.id, match.team2!.id);
      const side = match.roundName === 'Grand final' && reset ? 2 : 1;
      const loser = side === 1 ? match.team2! : match.team1!;
      losses.set(loser.id, (losses.get(loser.id) || 0) + 1);
      matches = finish(matches, match, side); assert.ok(++played <= n * 2);
    }
    const final = [...matches].reverse().find(m => m.bracketType === 'final' && !m.inactive);
    assert.equal(final?.status, 'completed', `No champion for ${n} teams`);
    assert.equal(played, reset ? 2 * n - 1 : 2 * n - 2);
    for (const [team, count] of losses) assert.equal(count, team === final!.winnerId ? 1 : 2);
  }
});
test('correcting an upper result invalidates stale lower and final results', () => {
  let matches = make(8, 'Double Elimination').matches;
  while (true) { const match = matches.find(m => !m.inactive && m.status !== 'completed' && m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye); if (!match) break; matches = finish(matches, match); }
  const first = matches[0], formerWinner = first.winnerId;
  matches = finish(matches, first, 2);
  const upperNext = matches.find(m => m.id === first.nextMatchId)!;
  assert.equal(upperNext.status, 'upcoming'); assert.ok(![upperNext.team1?.id, upperNext.team2?.id].includes(formerWinner));
  assert.equal(matches.find(m => m.roundName === 'Grand final')?.status, 'upcoming');
  assert.equal(matches.at(-1)?.inactive, true);
});
test('round robin pairs every team exactly once with no team double booked in a round', () => {
  for (const n of [3, 4, 5, 7, 12, 32]) {
    const matches = make(n, 'Round Robin').matches;
    assert.equal(matches.length, n * (n - 1) / 2);
    assert.equal(new Set(matches.map(m => [m.team1!.id, m.team2!.id].sort().join('|'))).size, matches.length);
    for (const round of new Set(matches.map(m => m.round))) { const ids = matches.filter(m => m.round === round).flatMap(m => [m.team1!.id, m.team2!.id]); assert.equal(ids.length, new Set(ids).size); }
  }
  assert.throws(() => make(33, 'Round Robin'));
});
test('roster checks explain unapproved players, account mismatches, duplicates and stale revisions', () => {
  const players = parseRoster('Player One | IGN | S-001 | account001 | starter');
  const registration = { status: 'locked', sanction: 'none', revision: 3, players, teamId: 'a' } as Registration;
  const checkIn = { rosterRevision: 2, lineup: parseLineup('s-001 | wrongaccount\ns-002 | wrongaccount') } as CheckIn;
  const codes = inspectCheckIn(registration, checkIn, { tournamentId: 't', gameId: 'g', playersRequired: 1, maxSubstitutes: 1, registrationOpen: true }).map(f => f.code);
  for (const code of ['STALE_ROSTER', 'LINEUP_SIZE', 'ACCOUNT_MISMATCH', 'UNAPPROVED_PLAYER', 'DUPLICATE_PLAYER']) assert.ok(codes.includes(code));
  assert.throws(() => parseRoster('A | IGN | same | account | starter\nB | IGN2 | SAME | other | sub'));
});

test('referee roster validation recognizes every lobby squad and rejects outside teams', async () => {
  const { createPlacementEvent, scheduleMatches } = await import('../src/lib/formats/placement');
  const draft = createPlacementEvent({ title: 'Squad readiness', teams: [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }], games: 1, config: { pointsTable: [10, 6, 3], killPoints: 1 } });
  const match = scheduleMatches(draft)[0];
  const players = parseRoster('Player One | IGN | S-001 | account001 | starter');
  const registration = { status: 'locked', sanction: 'none', revision: 1, players, teamId: draft.placement!.teams[2].id } as Registration;
  const checkIn = { rosterRevision: 1, lineup: parseLineup('s-001 | account001') } as CheckIn;
  const policy = { tournamentId: draft.id, gameId: 'game-codm-br', playersRequired: 1, maxSubstitutes: 0, registrationOpen: true };
  assert.equal(matchTeamIds(match).length, 3);
  assert.deepEqual(inspectCheckIn(registration, checkIn, policy, match), []);
  assert.deepEqual(inspectCheckIn({ ...registration, teamId: 'other-event-team' }, checkIn, policy, match).map(flag => flag.code), ['WRONG_MATCH']);
});
test('video sampling respects the selected segment and rejects invented or missing model frames', () => {
  assert.deepEqual(reviewSampleTimes(1.2), [0, .5, 1]);
  assert.equal(reviewSampleTimes(400, 120).length, 60);
  assert.equal(reviewSampleTimes(400, 120).at(-1), 149.5);
  assert.throws(() => reviewSampleTimes(Infinity));
  assert.throws(() => validateFrameFindings({ frames: [] }, [{ timestamp: 1 }]));
  assert.throws(() => validateFrameFindings({ frames: [{ timestamp: 999, classification: 'review' }] }, [{ timestamp: 1 }]));
});


import { readHistoryTab } from '../src/lib/navigation';
test('team and tournament desk routes remain reachable with notification links and browser history', () => {
  assert.equal(readHistoryTab('arena', '#/arena/operations', 'home'), 'operations');
  assert.equal(readHistoryTab('admin', '#/admin/operations?entity=private-record', 'overview'), 'operations');
  assert.equal(readHistoryTab('arena', '#/arena/operations?entity=match-1', 'home'), 'operations');
  assert.equal(readHistoryTab('arena', '#/arena/integrity?case=case-1', 'home'), 'integrity');
  assert.equal(readHistoryTab('arena', '#/admin/operations', 'home'), 'home');
  assert.equal(readHistoryTab('admin', '#/admin/unknown', 'overview'), 'overview');
});
