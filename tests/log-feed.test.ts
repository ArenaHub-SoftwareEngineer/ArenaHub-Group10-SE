import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityBuckets, collapseBursts } from '../src/lib/logFeed.ts';
import type { LogEntry } from '../src/lib/adminInsights.ts';

const NOW = Date.UTC(2026, 10, 26, 0, 30); // 08:30 Manila
const signup = (n: number, at: number): LogEntry => ({ id: `joined-u${n}`, category: 'accounts', tone: 'success', actor: `Player ${n}`, text: 'created an account', at });
const staff = (id: string, at: number): LogEntry => ({ id, category: 'brackets', tone: 'success', actor: 'Admin', text: 'published bracket', at });

test('folds three or more neighbouring sign-ups into one burst and keeps order', () => {
  const feed = collapseBursts([signup(1, 9), signup(2, 8), signup(3, 7), staff('a1', 6), signup(4, 5), signup(5, 4)]);
  assert.equal(feed.length, 4);
  assert.equal(feed[0].kind, 'burst');
  assert.equal(feed[0].kind === 'burst' && feed[0].label, '3 players created accounts');
  assert.equal(feed[0].kind === 'burst' && feed[0].entries.length, 3);
  assert.equal(feed[1].kind === 'entry' && feed[1].entry.id, 'a1');
  // Two sign-ups are not a burst: they stay as rows.
  assert.deepEqual(feed.slice(2).map(item => item.kind), ['entry', 'entry']);
});

test('staff actions never fold, even when repeated', () => {
  const feed = collapseBursts([staff('a', 3), staff('b', 2), staff('c', 1)]);
  assert.deepEqual(feed.map(item => item.kind), ['entry', 'entry', 'entry']);
});

test('24 hour buckets end at the current hour and count by category', () => {
  const buckets = activityBuckets([signup(1, NOW - 60_000), staff('x', NOW - 2 * 3_600_000), signup(2, NOW - 30 * 3_600_000)], NOW, 'day');
  assert.equal(buckets.length, 24);
  assert.ok(NOW >= buckets[23].start && NOW < buckets[23].end);
  assert.equal(buckets[23].byCategory.accounts, 1);
  assert.equal(buckets[21].byCategory.brackets, 1);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.total, 0), 2, 'older than 24 h is left out');
});

test('7 day buckets follow Manila days', () => {
  // 23:30 Manila yesterday and 00:10 Manila today fall on different days.
  const lateYesterday = Date.UTC(2026, 10, 25, 15, 30);
  const earlyToday = Date.UTC(2026, 10, 25, 16, 10);
  const buckets = activityBuckets([signup(1, lateYesterday), signup(2, earlyToday)], NOW, 'week');
  assert.equal(buckets.length, 7);
  assert.equal(buckets[6].total, 1);
  assert.equal(buckets[5].total, 1);
  assert.equal(buckets[6].start, Date.UTC(2026, 10, 25, 16, 0));
});
