import test from 'node:test';
import assert from 'node:assert/strict';
import { errorKind, errorMessage, friendlyError } from '../src/lib/errors.ts';

const firebase = (code: string, message = 'Firebase internal text') => Object.assign(new Error(message), { name: 'FirebaseError', code });

test('each Firebase and HTTP failure maps to a kind, a plain message and whether to retry', () => {
  const cases: Array<[unknown, string, boolean, RegExp]> = [
    [firebase('unavailable'), 'offline', true, /offline/],
    [firebase('auth/network-request-failed'), 'offline', true, /offline/],
    [Object.assign(new TypeError('Failed to fetch')), 'offline', true, /offline/],
    [firebase('permission-denied', 'Missing or insufficient permissions.'), 'permission', false, /doesn't have access.*sign in again/],
    [firebase('storage/unauthorized'), 'permission', false, /access/],
    [{ status: 403 }, 'permission', false, /access/],
    [firebase('unauthenticated'), 'auth', false, /sign-in has expired/],
    [{ status: 401 }, 'auth', false, /sign-in has expired/],
    [firebase('resource-exhausted'), 'quota', true, /usage limit.*Wait a minute/],
    [{ status: 429 }, 'quota', true, /usage limit/],
    [firebase('deadline-exceeded'), 'timeout', true, /too long/],
    [Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }), 'timeout', true, /too long/],
    [firebase('not-found'), 'not-found', false, /no longer exists/],
    [firebase('failed-precondition'), 'conflict', true, /changed this at the same time/],
    [firebase('aborted'), 'conflict', true, /Reload/],
  ];
  for (const [error, kind, retryable, message] of cases) {
    const result = friendlyError(error);
    assert.equal(result.kind, kind, JSON.stringify(error));
    assert.equal(result.retryable, retryable, kind);
    assert.match(result.message, message, kind);
    assert.doesNotMatch(result.message, /Firebase internal text|insufficient permissions/, 'never the raw SDK text');
  }
});

test("ArenaHub's own validation messages are kept; unknown system errors use the fallback", () => {
  assert.equal(errorMessage(new Error('Two squads cannot both finish #1.'), 'Could not save.'), 'Two squads cannot both finish #1.');
  assert.equal(errorMessage(firebase('internal'), 'Could not save these results.'), 'Could not save these results.');
  assert.equal(errorMessage('a thrown string', 'Could not save.'), 'Could not save.');
  assert.equal(errorMessage(undefined), 'That did not work. Try again.');
  assert.equal(errorKind(firebase('invalid-argument')), 'invalid');
});

test('when the browser is offline, every failure reads as offline', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { assert.equal(friendlyError(firebase('permission-denied')).kind, 'offline'); }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete (globalThis as { navigator?: unknown }).navigator; }
});
