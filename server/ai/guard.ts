// Input checks that run before any data is read or any model is called.
import { z } from 'zod';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';

const text = (max: number) => z.string().trim().min(1).max(max);
export const askSchema = z.object({
  query: text(4000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: text(4000) }).strict()).max(24).default([])
    .refine(items => items.reduce((sum, item) => sum + item.text.length, 0) <= 20_000, 'History is too long.'),
}).strict();
export const chatAskSchema = z.object({
  matchId: z.string().regex(/^[A-Za-z0-9_#.:-]{1,160}$/),
  question: text(500),
}).strict();
export const bracketSchema = z.object({ prompt: text(6000) }).strict();

export { screenQuestion, type Screen } from '../../src/lib/aiGuard.ts';

/** A fixed-window counter. Firestore when the server has admin access, memory otherwise. */
export interface RateStore { hit(key: string, limit: number, windowSec: number): Promise<boolean> }

export class MemoryRateStore implements RateStore {
  private windows = new Map<string, { until: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, limit: number, windowSec: number) {
    const now = this.now();
    if (this.windows.size > 5000) for (const [k, w] of this.windows) if (w.until <= now) this.windows.delete(k);
    const window = this.windows.get(key);
    if (!window || window.until <= now) { this.windows.set(key, { until: now + windowSec * 1000, count: 1 }); return true; }
    if (window.count >= limit) return false;
    window.count++;
    return true;
  }
}

const bucket = (ms: number, windowSec: number) => {
  const start = new Date(Math.floor(ms / (windowSec * 1000)) * windowSec * 1000);
  // yyyymmddhhmmss of the window start, so 30-second and 60-second windows never share a document.
  return { id: start.toISOString().replace(/[-:T]/g, '').slice(0, 14), start };
};

/**
 * aiRate/{key}_{yyyymmddhhmmss}: one read and one write per counted request, in a transaction so two
 * server instances cannot both spend the last slot. Clients cannot read or write it (no rule matches).
 * expiresAt is for a Firestore TTL policy on the aiRate collection (see docs/DEPLOY.md).
 */
export class FirestoreRateStore implements RateStore {
  constructor(private readonly app: App, private readonly now: () => number = Date.now) {}
  async hit(key: string, limit: number, windowSec: number) {
    const db = getFirestore(this.app);
    const { id, start } = bucket(this.now(), windowSec);
    const ref = db.doc(`aiRate/${key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)}_${id}`);
    return db.runTransaction(async tx => {
      const count = Number((await tx.get(ref)).get('count')) || 0;
      if (count >= limit) return false;
      tx.set(ref, { count: FieldValue.increment(1), expiresAt: Timestamp.fromMillis(start.getTime() + windowSec * 1000 + 3_600_000) }, { merge: true });
      return true;
    });
  }
}
