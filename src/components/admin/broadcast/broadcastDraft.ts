import { useSyncExternalStore } from 'react';

export type BroadcastStep = 1 | 2 | 3;

export interface BroadcastPosition {
  entry: string | null;
  scope: string;
  gameId: string;
  matchId: string;
  step: BroadcastStep;
}

interface BroadcastDraft {
  url?: string;
  title?: string;
  customThumb?: string;
}

const fallback = new Map<string, string | null>();
const draftEvent = 'arenahub:broadcast-draft';
const keyFor = (userId: string, item: string) => `arenahub:broadcast:${encodeURIComponent(userId)}:${item}`;

function read(key: string): string | null {
  if (fallback.has(key)) return fallback.get(key) ?? null;
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    fallback.delete(key);
  } catch {
    fallback.set(key, value);
  }
}

function parse<T>(value: string | null): Partial<T> {
  try { return value ? JSON.parse(value) ?? {} : {}; }
  catch { return {}; }
}

export function readBroadcastPosition(userId: string): BroadcastPosition | undefined {
  const position = parse<BroadcastPosition>(read(keyFor(userId, 'position')));
  if ((position.step === 1 || position.step === 2 || position.step === 3)
    && (typeof position.entry === 'string' || position.entry === null)
    && typeof position.scope === 'string' && typeof position.matchId === 'string' && typeof position.gameId === 'string') {
    return { entry: position.entry, scope: position.scope, gameId: position.gameId, matchId: position.matchId, step: position.step };
  }
}

export function saveBroadcastPosition(userId: string, position: BroadcastPosition) {
  write(keyFor(userId, 'position'), JSON.stringify(position));
}

function subscribeDrafts(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(draftEvent, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(draftEvent, notify);
  };
}

export function useBroadcastDraft(userId: string, matchId?: string) {
  const key = keyFor(userId, `match:${matchId}`);
  const snapshot = useSyncExternalStore(subscribeDrafts, () => matchId ? read(key) : null);
  const draft = parse<BroadcastDraft>(snapshot);

  return {
    draft,
    hasDraft: snapshot !== null,
    edit(changes: BroadcastDraft) {
      if (!matchId) return;
      write(key, JSON.stringify({ ...parse<BroadcastDraft>(read(key)), ...changes }));
      window.dispatchEvent(new Event(draftEvent));
    },
    discard(onlyIfUnchanged = false) {
      if (!matchId || (onlyIfUnchanged && read(key) !== snapshot)) return;
      write(key, null);
      window.dispatchEvent(new Event(draftEvent));
    },
  };
}
