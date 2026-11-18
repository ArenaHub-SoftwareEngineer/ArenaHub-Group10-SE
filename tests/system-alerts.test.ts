// M11: only items that arrive after the page loaded, and are unread, become system notifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshAlerts } from '../src/lib/systemAlerts';
import type { ArenaNotification } from '../src/lib/notificationService';

const item = (id: string, read = false): ArenaNotification => ({ id, kind: 'live', title: id, body: '', tab: 'schedule', entityId: '', createdAt: null, readAt: read ? { seconds: 1 } : null });

test('the first snapshot is remembered, not announced', () => {
  const first = freshAlerts(null, [item('a'), item('b')]);
  assert.deepEqual(first.fresh, []);
  assert.deepEqual([...first.seen].sort(), ['a', 'b']);
});

test('later unread arrivals are announced once; read ones and repeats are not', () => {
  const start = freshAlerts(null, [item('a')]).seen;
  const next = freshAlerts(start, [item('c'), item('b', true), item('a')]);
  assert.deepEqual(next.fresh.map(x => x.id), ['c']);
  assert.deepEqual(freshAlerts(next.seen, [item('c'), item('b', true), item('a')]).fresh, []);
});
