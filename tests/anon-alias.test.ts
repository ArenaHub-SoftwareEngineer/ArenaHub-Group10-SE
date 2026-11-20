import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADJECTIVES, ANIMALS, ANON_PATTERN, aliasAvatar, aliasOf, isAnonAuthor, newAlias } from '../src/lib/anonAlias.ts';

test('every word fits the shape firestore.rules accepts', () => {
  for (const word of [...ADJECTIVES, ...ANIMALS]) assert.match(word, /^[A-Z][a-z]{2,11}$/, word);
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length);
  assert.equal(new Set(ANIMALS).size, ANIMALS.length);
  for (let i = 0; i < 200; i++) assert.match(newAlias(), ANON_PATTERN);
});

test('a new alias never repeats a name already in the chat', () => {
  const taken = new Set<string>();
  for (let i = 0; i < 1500; i++) { const alias = newAlias(taken); assert.ok(!taken.has(alias)); taken.add(alias); }
});

test('aliases read back as names, real names do not', () => {
  assert.equal(aliasOf('Anonymous Swift Kraken'), 'Swift Kraken');
  assert.equal(aliasOf('Anonymous'), null);
  assert.equal(aliasOf('Maria Santos'), null);
  assert.ok(isAnonAuthor('Anonymous'));
  assert.ok(!isAnonAuthor('Anonymous swift kraken'));
});

test('the avatar is stable for an alias and differs between aliases', () => {
  assert.deepEqual(aliasAvatar('Swift Kraken'), aliasAvatar('Swift Kraken'));
  assert.notDeepEqual(aliasAvatar('Swift Kraken'), aliasAvatar('Silent Falcon'));
  for (const [x, y] of aliasAvatar('Swift Kraken').cells) assert.ok(x >= 0 && x < 5 && y >= 0 && y < 5);
});
