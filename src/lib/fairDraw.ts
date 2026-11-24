// Fair random draw for bracket seeding. Uses the platform's cryptographic random source (crypto.getRandomValues),
// not Math.random, and rejection sampling so every order of teams is equally likely (no modulo bias).
// Nobody, including the organizer, can predict or repeat a draw by re-entering the same prompt.

const MAX = 0x1_0000_0000; // 2^32

/** A uniformly random integer from 0 to n - 1. `random` returns 32-bit unsigned integers (injectable for tests). */
export function randomIndex(n: number, random: () => number = cryptoUint32): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('randomIndex needs a positive whole number.');
  const limit = MAX - (MAX % n); // values at or above this would favour the low indexes
  let value = random();
  while (value >= limit) value = random();
  return value % n;
}

export function cryptoUint32(): number {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) throw new Error('A secure random source is not available, so the draw cannot be made fairly.');
  return source.getRandomValues(new Uint32Array(1))[0];
}

/** Fisher-Yates shuffle into a new array. */
export function fairShuffle<T>(items: readonly T[], random?: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True for seeding rules that mean "draw at random". */
export const isRandomDraw = (rule?: string | null) => /random|draw/i.test(rule || '') && !/manual/i.test(rule || '');
