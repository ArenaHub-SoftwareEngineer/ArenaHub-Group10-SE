// One place that turns a failed network call into words a student or organizer can act on.
// Firebase, fetch and timeout errors get a plain message for what went wrong; errors that ArenaHub
// throws itself (validation such as "Two squads cannot both finish #1.") keep their own message.

export type ErrorKind = 'offline' | 'permission' | 'auth' | 'quota' | 'timeout' | 'not-found' | 'conflict' | 'invalid' | 'unknown';

export interface FriendlyError {
  kind: ErrorKind;
  message: string;
  /** Trying the same thing again can work (connection, quota, timeout, a concurrent edit). */
  retryable: boolean;
}

const MESSAGES: Record<Exclude<ErrorKind, 'unknown' | 'invalid'>, string> = {
  offline: 'You appear to be offline. Check your connection, then try again.',
  permission: "Your account doesn't have access to do this. If it should, sign out and sign in again so your role is refreshed.",
  auth: 'Your sign-in has expired. Sign in again to continue.',
  quota: 'ArenaHub has reached its usage limit for the moment. Wait a minute, then try again.',
  timeout: 'This is taking too long. Check your connection, then try again.',
  'not-found': 'This record no longer exists. Reload the page to see the current version.',
  conflict: 'Someone else changed this at the same time. Reload, then make your change again.',
};
const RETRYABLE: ErrorKind[] = ['offline', 'quota', 'timeout', 'conflict', 'unknown'];

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** What kind of failure this is, from a Firebase code, an HTTP status, or the browser's own errors. */
export function errorKind(error: unknown): ErrorKind {
  if (!isOnline()) return 'offline';
  const e = (error ?? {}) as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code.replace(/^(firestore|auth|storage|functions)\//, '') : '';
  const status = typeof e.status === 'number' ? e.status : 0;
  const message = typeof e.message === 'string' ? e.message : '';
  if (code === 'unavailable' || code === 'network-request-failed' || code === 'retry-limit-exceeded' || (e.name === 'TypeError' && /fetch|network|load failed/i.test(message))) return 'offline';
  if (code === 'permission-denied' || code === 'unauthorized' || status === 403 || /missing or insufficient permissions/i.test(message)) return 'permission';
  if (code === 'unauthenticated' || code === 'user-token-expired' || code === 'requires-recent-login' || code === 'id-token-expired' || status === 401) return 'auth';
  if (code === 'resource-exhausted' || code === 'quota-exceeded' || code === 'too-many-requests' || status === 429) return 'quota';
  if (code === 'deadline-exceeded' || e.name === 'TimeoutError' || status === 504 || status === 408) return 'timeout';
  if (code === 'not-found' || code === 'object-not-found' || status === 404) return 'not-found';
  if (code === 'aborted' || code === 'failed-precondition' || code === 'already-exists' || status === 409) return 'conflict';
  if (code === 'invalid-argument' || status === 400) return 'invalid';
  return 'unknown';
}

/** A Firebase, HTTP or browser error, as opposed to one ArenaHub threw with its own wording. */
function isSystemError(error: unknown) {
  const e = error as { code?: unknown; status?: unknown; name?: unknown };
  return !!e && (typeof e.code === 'string' || typeof e.status === 'number' || e.name === 'FirebaseError' || e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError');
}

export function friendlyError(error: unknown, fallback = 'That did not work. Try again.'): FriendlyError {
  const kind = errorKind(error);
  const retryable = RETRYABLE.includes(kind);
  if (kind !== 'unknown' && kind !== 'invalid') return { kind, message: MESSAGES[kind], retryable };
  // ArenaHub's own validation messages are written for people; keep them.
  if (error instanceof Error && error.message && !isSystemError(error)) return { kind, message: error.message, retryable: kind === 'unknown' };
  return { kind, message: fallback, retryable };
}

/** Drop-in for `error instanceof Error ? error.message : fallback`. */
export const errorMessage = (error: unknown, fallback?: string) => friendlyError(error, fallback).message;
