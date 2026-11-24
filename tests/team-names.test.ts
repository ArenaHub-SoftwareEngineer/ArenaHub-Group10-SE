import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertUniqueTeamNames, duplicateNames, duplicateTeamNames, teamNameProblem } from '../src/lib/teamNames';
import { matchName } from '../src/lib/matchName';
import { parseStreamSchedule } from '../src/lib/streamSchedule';
import type { Match, Team } from '../src/lib/types';

const team = (id: string, name: string, extra: Partial<Team> = {}): Team =>
  ({ id, name, collegeId: 'c', collegeCode: 'C', gameId: 'game-mlbb', seed: 1, winRate: 0, record: '0W-0L', players: [], ...extra });
const match = (id: string, team1?: Team, team2?: Team, extra: Partial<Match> = {}) =>
  ({ id, matchNumber: `#${id}`, tournamentId: 't', gameId: 'game-mlbb', round: 1, roundName: 'Round 1', bracketType: 'upper', team1, team2,
    matchFormat: 'Bo3', score: { team1Score: 0, team2Score: 0 }, status: 'upcoming', ...extra }) as unknown as Match;

test('two different teams with the same name are rejected, ignoring case and spacing', () => {
  const draft = { teams: [], matches: [match('M1', team('a', 'Team 1'), team('b', 'Team 8')), match('M2', team('c', '  team   1 '), team('d', 'Team 9'))] };
  const duplicates = duplicateTeamNames(draft);
  assert.deepEqual(duplicates.map(item => [item.name, item.count]), [['Team 1', 2]]);
  assert.throws(() => assertUniqueTeamNames(draft), /Team names must be unique\. "Team 1" \(2 teams\) is used more than once/);
});

test('a team that advances appears in later matches without counting as a duplicate', () => {
  const winner = team('a', 'Crimson Wolves');
  const draft = { teams: [], matches: [match('M1', winner, team('b', 'Blue Owls')), match('M3', winner, team('c', 'Gold Hawks'), { round: 2 })] };
  assert.equal(teamNameProblem(draft), null);
});

test('BYE slots, placeholders and blank names', () => {
  const byes = { teams: [], matches: [match('M1', team('a', 'Alpha'), team('x', 'BYE', { isBye: true })), match('M2', team('b', 'Beta'), team('y', 'BYE', { isBye: true }))] };
  assert.equal(teamNameProblem(byes), null);
  assert.match(teamNameProblem({ teams: [], matches: [match('M1', team('a', ''), team('b', 'Beta'))] }) || '', /A team has no name/);
});

test('CSV-style name lists and drafts without match teams are checked too', () => {
  assert.equal(duplicateNames([{ id: '0', name: 'CCS' }, { id: '1', name: 'ccs' }, { id: '2', name: 'COE' }]).length, 1);
  assert.match(teamNameProblem({ matches: [], teams: [{ name: 'A' } as any, { name: 'A' } as any] }) || '', /"A" \(2 teams\)/);
});

test('match numbers read as words, without "#"', () => {
  assert.equal(matchName({ matchNumber: '#M1' }), 'Match 1');
  assert.equal(matchName('#L3'), 'Lower match 3');
  assert.equal(matchName('#F7'), 'Final match 7');
  assert.equal(matchName('#RR4'), 'Match 4');
  assert.equal(matchName('#G2'), 'Game 2');
  assert.equal(matchName('#S1.2'), 'Round 1 match 2');
  assert.equal(matchName('Custom'), 'Custom');
  assert.equal(matchName(undefined), '');
});

test('stream schedules accept the readable name as well as the code', () => {
  const matches = [match('M1', team('a', 'A'), team('b', 'B'), { scheduledDate: 'Day 1', scheduledTime: 'Round 1' })];
  assert.equal(parseStreamSchedule('Match 1 on 2026-12-04 at 19:30', matches)[0].id, 'M1');
  assert.equal(parseStreamSchedule('Schedule #M1 on 2026-12-04 at 19:30', matches)[0].id, 'M1');
});
