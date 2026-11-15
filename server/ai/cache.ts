// Small in-memory answer cache. Keys always include the data revision, so a score change makes every
// cached answer about it unreachable at once; the TTL only bounds memory.
export class AnswerCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs = 60_000, private readonly max = 300, private readonly now: () => number = Date.now) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) { this.entries.delete(key); return undefined; }
    // Refresh recency so the oldest unused entry is evicted first.
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
}

/** Case, spacing and punctuation do not change the answer. */
export function normalizeQuestion(text: string) {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}#@ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
