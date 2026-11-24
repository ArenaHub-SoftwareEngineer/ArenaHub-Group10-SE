import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBracketSyncErrorMessage } from '../src/components/admin/bracket-studio/shared';
import { parseBracketPromptLocally, resolveBracketRequest, UNASSIGNED_BRACKET_GAME } from '../src/lib/bracketRequest';
import { createBracketFromTeams } from '../src/lib/bracketUtils';
import { splitBracketSchedule } from '../src/lib/streamSchedule';
import { mlbbPairs, mlbbPrompt } from './bracket-prompt-fixture';

test('an unpublish failure says the bracket is still published, never "on this device"', () => {
  const denied = getBracketSyncErrorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, 'Unpublished');
  assert.match(denied, /^The bracket is still published: Firebase denied the write/);
  assert.doesNotMatch(denied, /on this device/);
  assert.match(getBracketSyncErrorMessage(new Error('A newer version of this bracket was saved. Reload before unpublishing.'), 'Unpublished'), /another organizer changed it first/);
  assert.match(getBracketSyncErrorMessage({ code: 'unavailable' }, 'Unpublished'), /still published: Firebase is currently unreachable/);
});

test('save and publish failures keep their wording', () => {
  assert.match(getBracketSyncErrorMessage({ code: 'unavailable' }, 'Saved'), /^Saved on this device, but Firebase is currently unreachable/);
  assert.match(getBracketSyncErrorMessage('boom', 'Published'), /^Published on this device, but live sync failed/);
});

test('the graphic prompt preserves all 16 names, positions and Bo3 through the final even if the model misses them', () => {
  const local = parseBracketPromptLocally(mlbbPrompt);
  for (const parsed of [local, { ...local, title: null, teams: [{ name: 'Invented team' }], matchFormat: 'Bo1', finalMatchFormat: 'Bo5', seeding: 'Random draw' }]) {
    const result = resolveBracketRequest(mlbbPrompt, parsed);
    assert.equal(result.kind, 'ready');
    if (result.kind !== 'ready') continue;
    const request = result.request;
    assert.equal(request.title, 'MLBB 16-TEAM BO3 CHAMPIONSHIP');
    assert.deepEqual(request.openingMatches?.map(match => match.teams), mlbbPairs);
    assert.equal(request.teamStyles?.['lag spike']?.motif, 'lightning bolt');
    assert.equal(new Set(Object.values(request.teamStyles || {}).map(style => style.color)).size, 16);
    assert.deepEqual(request.appearance, { theme: 'navy-gold', wideImage: true, exportFooter: true });
    const draft = createBracketFromTeams({ ...request, gameName: request.game, explicitBracketSize: request.teamsCount, seedingRule: request.seeding });
    assert.equal(draft.matches.length, 15);
    assert.deepEqual(draft.matches.slice(0, 8).map(match => [match.team1?.name, match.team2?.name]), mlbbPairs);
    assert.ok(draft.matches.every(match => match.matchFormat === 'Bo3'));
    assert.ok(draft.matches.slice(8).every(match => !match.team1 && !match.team2));
  }
});

test('incomplete and conflicting matchup instructions require a correction instead of generating placeholder names', () => {
  const prompt = '4-team MLBB single elimination\nMatch 1: Alpha vs Bravo\nMatch 2: Alpha vs Delta';
  const duplicate = resolveBracketRequest(prompt, parseBracketPromptLocally(prompt));
  assert.equal(duplicate.kind, 'question');
  if (duplicate.kind === 'question') assert.match(duplicate.text, /appears more than once/);
  const partial = prompt.split('\nMatch 2')[0];
  const missing = resolveBracketRequest(partial, parseBracketPromptLocally(partial));
  assert.equal(missing.kind, 'question');
  if (missing.kind === 'question') assert.match(missing.text, /says 4 teams.*name 2/);
});

test('an informal inline roster can start a random draft before the game is chosen', () => {
  const { bracket } = splitBracketSchedule('Can you shuffle a bracket for Iron Owls; Storm Bears; Night Ravens and Saltwater?');
  const result = resolveBracketRequest(bracket, parseBracketPromptLocally(bracket));
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.request.game, UNASSIGNED_BRACKET_GAME);
  assert.equal(result.request.seeding, 'Random draw');
  assert.deepEqual(result.request.teams.map(team => team.name), ['Iron Owls', 'Storm Bears', 'Night Ravens', 'Saltwater']);
});

test('a named roster that disagrees with the stated count needs a correction', () => {
  const prompt = 'Make a 6-team Dota 2 bracket. Teams: Iron Owls, Storm Bears, Night Ravens';
  const result = resolveBracketRequest(prompt, parseBracketPromptLocally(prompt));
  assert.equal(result.kind, 'question');
  if (result.kind === 'question') assert.match(result.text, /read 3 names.*6 teams/);
});
