// Per-person Arena AI allowance: model tokens per rolling window (5 hours by default).
// The window starts with the first model answer after the previous window ended, like a session, and
// everything resets when it ends. Only tokens a model actually used are counted: refusals, live-records
// answers and reused (cached) answers are free. The browser can read its own allowance, never change it.
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';

export interface Allowance {
  used: number; limit: number; windowHours: number;
  /** When the current window started and ends; null when no window is open (the next question starts one). */
  startedAt: number | null; resetsAt: number | null;
  exhausted: boolean;
}
export interface UsageRecord { used: number; startedAt: number | null }
export interface UsageStore {
  read(uid: string): Promise<UsageRecord>;
  /** Adds tokens to the open window, or opens a new one at `startedAt` (when the question was asked). */
  add(uid: string, tokens: number, startedAt: number): Promise<UsageRecord>;
}
export interface UsagePolicy { tokensPerWindow: number; windowHours: number; staffMultiplier: number }

const HOUR = 3_600_000;

/** The allowance as of `now`, from what the store holds. An ended window counts as empty. */
export function allowanceOf(record: UsageRecord, policy: UsagePolicy, staff: boolean, now: number): Allowance {
  const limit = policy.tokensPerWindow * (staff ? policy.staffMultiplier : 1), span = policy.windowHours * HOUR;
  const open = record.startedAt !== null && now < record.startedAt + span;
  const used = open ? record.used : 0;
  return { used, limit, windowHours: policy.windowHours, startedAt: open ? record.startedAt : null, resetsAt: open ? record.startedAt! + span : null, exhausted: used >= limit };
}

/** The record after adding tokens: same window if it is still open at `now`, otherwise a new one. */
export function addTokens(record: UsageRecord, tokens: number, startedAt: number, windowHours: number, now: number): UsageRecord {
  const span = windowHours * HOUR;
  if (record.startedAt !== null && now < record.startedAt + span) return { used: record.used + tokens, startedAt: record.startedAt };
  // A question asked before the old window ended but finished after it opens the new window now.
  const start = record.startedAt !== null && startedAt < record.startedAt + span ? now : Math.min(startedAt, now);
  return { used: tokens, startedAt: start };
}

export class MemoryUsageStore implements UsageStore {
  private records = new Map<string, UsageRecord>();
  constructor(private readonly windowHours: number, private readonly now: () => number = Date.now) {}
  async read(uid: string) { return this.records.get(uid) || { used: 0, startedAt: null }; }
  async add(uid: string, tokens: number, startedAt: number) {
    if (this.records.size > 20_000) for (const [key, value] of this.records) if (value.startedAt === null || value.startedAt + this.windowHours * HOUR <= this.now()) this.records.delete(key);
    const next = addTokens(await this.read(uid), tokens, startedAt, this.windowHours, this.now());
    this.records.set(uid, next);
    return next;
  }
}

/**
 * aiUsage/{uid}: { used, windowStart, expiresAt }. Updated in a transaction so two server instances
 * cannot lose each other's tokens. Clients have no access (firestore.rules); the API reports it.
 */
export class FirestoreUsageStore implements UsageStore {
  constructor(private readonly app: App, private readonly windowHours: number, private readonly now: () => number = Date.now) {}
  private ref(uid: string) { return getFirestore(this.app).doc(`aiUsage/${uid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)}`); }
  private static parse(data: FirebaseFirestore.DocumentData | undefined): UsageRecord {
    const start = data?.windowStart?.toMillis?.();
    return { used: Number(data?.used) || 0, startedAt: Number.isFinite(start) ? start : null };
  }
  async read(uid: string) { return FirestoreUsageStore.parse((await this.ref(uid).get()).data()); }
  async add(uid: string, tokens: number, startedAt: number) {
    const ref = this.ref(uid);
    return getFirestore(this.app).runTransaction(async tx => {
      const next = addTokens(FirestoreUsageStore.parse((await tx.get(ref)).data()), tokens, startedAt, this.windowHours, this.now());
      tx.set(ref, { used: next.used, windowStart: Timestamp.fromMillis(next.startedAt!), updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(next.startedAt! + this.windowHours * HOUR + 24 * HOUR) });
      return next;
    });
  }
}
