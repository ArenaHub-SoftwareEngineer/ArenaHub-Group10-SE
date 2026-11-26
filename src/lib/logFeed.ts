// Helpers for the System log page that keep a busy event readable:
// - muting whole categories (saved per browser), so a flood of sign-ups does not bury staff actions;
// - folding bursts of the same kind of entry ("38 players created accounts") into one expandable row;
// - hourly or daily buckets for the 3D activity skyline.
// The pure functions are unit-tested in tests/log-feed.test.ts.
import { useEffect, useState } from 'react';
import type { LogCategory, LogEntry } from './adminInsights';

const MUTE_KEY = 'ah.log.muted';
const MUTE_EVENT = 'ah-log-muted';

function readMuted(): LogCategory[] {
  try { const value = JSON.parse(localStorage.getItem(MUTE_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

/** Categories this admin has muted, shared by every page that shows the log (Logs page, Overview). */
export function useMutedCategories(): [LogCategory[], (next: LogCategory[]) => void] {
  const [muted, setMuted] = useState<LogCategory[]>(readMuted);
  useEffect(() => {
    const sync = () => setMuted(readMuted());
    window.addEventListener(MUTE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(MUTE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const update = (next: LogCategory[]) => {
    try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)); } catch { /* private mode: keep it for this page only */ }
    setMuted(next);
    window.dispatchEvent(new Event(MUTE_EVENT));
  };
  return [muted, update];
}

export type FeedItem =
  | { kind: 'entry'; entry: LogEntry }
  | { kind: 'burst'; id: string; category: LogCategory; label: string; entries: LogEntry[] };

/** What a burst of one kind of entry is called. Only repetitive, low-value kinds fold. */
function burstKind(entry: LogEntry): string | null {
  if (entry.id.startsWith('joined-')) return 'signup';
  if (entry.id.startsWith('report-')) return 'report';
  return null;
}
const BURST_LABEL: Record<string, (n: number) => string> = {
  signup: n => `${n} players created accounts`,
  report: n => `${n} chat messages reported`,
};

/** Folds runs of at least `min` neighbouring sign-ups (or reports) into one row. Order is kept. */
export function collapseBursts(entries: LogEntry[], min = 3): FeedItem[] {
  const out: FeedItem[] = [];
  let run: LogEntry[] = [];
  let runKind: string | null = null;
  const flush = () => {
    if (runKind && run.length >= min) out.push({ kind: 'burst', id: `burst-${run[0].id}`, category: run[0].category, label: BURST_LABEL[runKind](run.length), entries: run });
    else run.forEach(entry => out.push({ kind: 'entry', entry }));
    run = []; runKind = null;
  };
  for (const entry of entries) {
    const kind = burstKind(entry);
    if (kind && kind === runKind) { run.push(entry); continue; }
    flush();
    if (kind) { run = [entry]; runKind = kind; } else out.push({ kind: 'entry', entry });
  }
  flush();
  return out;
}

export type ActivityRange = 'day' | 'week';
export interface ActivityBucket { key: string; start: number; end: number; label: string; total: number; byCategory: Partial<Record<LogCategory, number>> }

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 24 hourly buckets (last 24 h) or 7 daily buckets (last 7 days, Manila days), oldest first. */
export function activityBuckets(entries: LogEntry[], now: number, range: ActivityRange): ActivityBucket[] {
  const buckets: ActivityBucket[] = [];
  if (range === 'day') {
    const top = Math.floor(now / HOUR) * HOUR + HOUR;
    for (let i = 23; i >= 0; i--) {
      const start = top - (i + 1) * HOUR;
      buckets.push({ key: String(start), start, end: start + HOUR, total: 0, byCategory: {},
        label: new Date(start).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric' }) });
    }
  } else {
    // Manila is UTC+8 all year, so a Manila day starts at 16:00 UTC.
    const offset = 8 * HOUR;
    const top = Math.floor((now + offset) / DAY) * DAY - offset + DAY;
    for (let i = 6; i >= 0; i--) {
      const start = top - (i + 1) * DAY;
      buckets.push({ key: String(start), start, end: start + DAY, total: 0, byCategory: {},
        label: new Date(start + HOUR).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short' }) });
    }
  }
  for (const entry of entries) {
    if (!entry.at) continue;
    const bucket = buckets.find(item => entry.at! >= item.start && entry.at! < item.end);
    if (!bucket) continue;
    bucket.total++;
    bucket.byCategory[entry.category] = (bucket.byCategory[entry.category] || 0) + 1;
  }
  return buckets;
}
