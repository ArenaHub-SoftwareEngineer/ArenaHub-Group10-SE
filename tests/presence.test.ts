import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceStore } from '../server/presence.ts';
import { formatViewers } from '../src/lib/presence.ts';

const id = (n: number) => `session-${String(n).padStart(12, '0')}`;

test('counts each session once, on the match it is watching now', () => {
  let now = 1_000;
  const store = createPresenceStore({ now: () => now });
  assert.equal(store.beat(id(1), 'match-a', '10.0.0.1'), true);
  assert.equal(store.beat(id(2), 'match-a', '10.0.0.2'), true);
  assert.equal(store.beat(id(3), 'match-b', '10.0.0.3'), true);
  assert.deepEqual(store.counts(['match-a', 'match-b', 'match-c']), { 'match-a': 2, 'match-b': 1, 'match-c': 0 });
  // Switching matches moves the viewer instead of counting them twice.
  store.beat(id(1), 'match-b', '10.0.0.1');
  assert.deepEqual(store.counts(['match-a', 'match-b']), { 'match-a': 1, 'match-b': 2 });
  now += 5_000;
  store.leave(id(2));
  assert.deepEqual(store.counts(['match-a']), { 'match-a': 0 });
});

test('viewers who stop sending heartbeats drop out after the time limit', () => {
  let now = 0;
  const store = createPresenceStore({ ttlMs: 70_000, now: () => now });
  store.beat(id(1), 'match-a', '10.0.0.1');
  now = 69_000;
  assert.equal(store.counts(['match-a'])['match-a'], 1);
  now = 71_000;
  assert.equal(store.counts(['match-a'])['match-a'], 0);
});

test('one address cannot inflate a count, and a session cannot be taken over from another address', () => {
  const store = createPresenceStore({ now: () => 0 });
  let accepted = 0;
  for (let i = 0; i < 40; i++) if (store.beat(id(i), 'match-a', '10.0.0.9')) accepted++;
  assert.equal(accepted, 12);
  assert.equal(store.counts(['match-a'])['match-a'], 12);
  assert.equal(store.beat(id(0), 'match-a', '10.0.0.10'), false);
});

test('malformed ids are refused', () => {
  const store = createPresenceStore({ now: () => 0 });
  assert.equal(store.beat('short', 'match-a', 'ip'), false);
  assert.equal(store.beat(id(1), 'bad id with spaces', 'ip'), false);
  assert.equal(store.beat(id(1), 'x'.repeat(200), 'ip'), false);
  assert.deepEqual(store.counts(['<script>']), {});
});

test('viewer counts read like a streaming site', () => {
  assert.equal(formatViewers(0), '0 viewers');
  assert.equal(formatViewers(1), '1 viewer');
  assert.equal(formatViewers(221), '221 viewers');
  assert.equal(formatViewers(1_000), '1K viewers');
  assert.equal(formatViewers(5_300), '5.3K viewers');
  assert.equal(formatViewers(45_800), '45.8K viewers');
  assert.equal(formatViewers(91_000), '91K viewers');
  assert.equal(formatViewers(1_250_000), '1.3M viewers');
});
