import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { bracketProgress, canScoreMatch, scoredMatch, winnerScores } from '../src/lib/liveResults';

const bracket = () => createBracketFromTeams({
  title: 'Cup', gameName: 'Dota 2', format: 'Single Elimination', matchFormat: 'Bo3', explicitBracketSize: 4,
  teams: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, index) => ({ name, seed: index + 1 })),
});

test('a team that reaches the winning score wins and moves into the next match', () => {
  const draft = bracket();
  const first = draft.matches.find(match => match.round === 1 && canScoreMatch(match))!;
  const done = scoredMatch(first, 2, 1);
  assert.equal(done.status, 'completed');
  assert.equal(done.winnerId, first.team1!.id);
  const next = updateMatchAndAdvance(draft.matches, done).find(match => match.id === first.nextMatchId)!;
  assert.ok([next.team1?.id, next.team2?.id].includes(first.team1!.id));
});

test('lowering a finished score reopens the match as live, and 0-0 makes it upcoming again', () => {
  const first = bracket().matches.find(match => match.round === 1 && canScoreMatch(match))!;
  const done = scoredMatch(first, 2, 0);
  const reopened = scoredMatch(done, 1, 0);
  assert.equal(reopened.status, 'live');
  assert.equal(reopened.winnerId, undefined);
  assert.equal(scoredMatch(done, 0, 0).status, 'upcoming');
});

test('impossible scores are refused', () => {
  const first = bracket().matches.find(match => match.round === 1 && canScoreMatch(match))!;
  assert.throws(() => scoredMatch(first, 3, 0));
  assert.throws(() => scoredMatch(first, 2, 2));
});

test('"Won" gives the team the winning score and keeps the other side below it', () => {
  const first = bracket().matches.find(match => match.round === 1 && canScoreMatch(match))!;
  assert.deepEqual(winnerScores({ ...first, score: { team1Score: 1, team2Score: 1 } }, 2), [1, 2]);
  assert.deepEqual(winnerScores({ ...first, score: { team1Score: 0, team2Score: 2 } }, 1), [2, 1]);
});

test('progress counts played and live matches and names the champion at the end', () => {
  const draft = bracket();
  assert.equal(bracketProgress(draft).played, 0);
  let matches = draft.matches;
  for (let open = matches.find(entry => entry.status !== 'completed' && canScoreMatch(entry)); open;
    open = matches.find(entry => entry.status !== 'completed' && canScoreMatch(entry))) {
    const [a, b] = winnerScores(open, 1);
    matches = updateMatchAndAdvance(matches, scoredMatch(open, a, b));
  }
  const progress = bracketProgress({ ...draft, matches });
  assert.equal(progress.played, progress.total);
  assert.ok(progress.champion);
});
