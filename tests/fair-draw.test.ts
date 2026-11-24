import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fairShuffle, isRandomDraw, randomIndex } from '../src/lib/fairDraw';
import { createBracketFromTeams } from '../src/lib/bracketUtils';
import { resolveBracketRequest } from '../src/lib/bracketRequest';

const names = ['Iron Owls', 'Storm Bears', 'Night Ravens', 'Phantom Five', 'Gold Hawks'];
const build = (seedingRule: string) => createBracketFromTeams({ title: 'Cup', teams: names.map(name => ({ name })), gameName: 'Dota 2', seedingRule, explicitBracketSize: names.length });
const round1 = (draft: ReturnType<typeof build>) => draft.matches.filter(match => match.round === 1).map(match => `${match.team1?.name}|${match.team2?.name}`).join(',');

test('every order of three teams is about equally likely', () => {
  const counts = new Map<string, number>();
  const runs = 12000;
  for (let i = 0; i < runs; i++) { const key = fairShuffle(['A', 'B', 'C']).join(''); counts.set(key, (counts.get(key) || 0) + 1); }
  assert.equal(counts.size, 6);
  for (const [order, count] of counts) assert.ok(Math.abs(count - runs / 6) < runs / 6 * 0.12, `${order} drawn ${count} times`);
});

test('values that would bias the draw are rejected, not wrapped', () => {
  // 2^32 is not a multiple of 3: the top value must be redrawn instead of mapped to index 0.
  const values = [0xFFFF_FFFF, 5];
  assert.equal(randomIndex(3, () => values.shift()!), 2);
  assert.throws(() => randomIndex(0), /positive whole number/);
});

test('the same prompt gives different random draws, with every team placed once', () => {
  const draws = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const draft = build('Random draw');
    assert.deepEqual(draft.teams.map(team => team.name).sort(), [...names].sort());
    assert.deepEqual(draft.teams.map(team => team.seed), [1, 2, 3, 4, 5]);
    draws.add(round1(draft));
  }
  // 120 orders of 5 teams; 20 builds landing on one round-1 layout would mean the draw is not random.
  assert.ok(draws.size > 1, 'every build produced the same bracket');
});

test('back-to-back draws of a two-team roster always change sides', () => {
  const teams = names.slice(0, 2).map(name => ({ name }));
  const options = { title: 'Cup', teams, seedingRule: 'Random draw' };
  let draft = createBracketFromTeams(options);
  for (let draw = 0; draw < 30; draw++) {
    const previous = draft;
    draft = createBracketFromTeams({ ...options, previousDraw: previous.teams.map(team => team.name) });
    assert.notEqual(round1(draft), round1(previous));
    assert.equal(draft.matches[0].team1?.name, previous.matches[0].team2?.name);
  }
});

test('asked-for seeding and manual brackets keep the listed order', () => {
  assert.equal(round1(build('Win rate')), round1(build('Win rate')));
  assert.deepEqual(build('Skill rating').teams.map(team => team.name), names);
  assert.equal(isRandomDraw('Manual Draw'), false);
  assert.equal(isRandomDraw('Random draw'), true);
});

test('a prompt that says nothing about seeding is drawn at random', () => {
  const result = resolveBracketRequest(`Dota 2 cup with ${names.join(', ')}`, { title: null, game: 'Dota 2', format: null, matchFormat: null, finalMatchFormat: null, teams: names.map(name => ({ name })), seeding: null, constraints: [] });
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') { assert.equal(result.request.seeding, 'Random draw'); assert.ok(result.request.defaults.includes('seeding')); }
});

test('natural phrasing and comma-separated teams are extracted and randomized', () => {
  const colleges = ['CCS', 'COE', 'CLA', 'CN', 'CBA', 'CTE', 'CCJE', 'CSWCD'];
  const prompt = `Create an 8-team MLBB tournament for ${colleges.join(', ')} with Bo3 matches`;
  const result = resolveBracketRequest(prompt, { title: null, game: null, format: null, matchFormat: null, finalMatchFormat: null, teams: [], seeding: null, constraints: [] });
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') {
    assert.equal(result.request.game, 'Mobile Legends: Bang Bang');
    assert.deepEqual(result.request.teams.map(t => t.name), colleges);
    assert.equal(result.request.seeding, 'Random draw');
  }
});
