// Anonymous chat names: "Anonymous Swift Kraken" instead of a crowd of identical "Anonymous" posts.
//
// - One alias per match per browser session (sessionStorage), so a viewer keeps the same alias across reloads
//   while they watch, and gets a fresh one in a new session or another match.
// - A new alias avoids every name already in the visible chat, so two people never share one.
// - It is not derived from the account, so it cannot be traced back to anyone; staff still see the real account
//   through the private author record, as with any message.
// - firestore.rules accepts exactly this shape: "Anonymous " + two capitalised words of 3 to 12 letters.

export const ANON_PREFIX = 'Anonymous ';
export const ANON_PATTERN = /^Anonymous [A-Z][a-z]{2,11} [A-Z][a-z]{2,11}$/;

export const ADJECTIVES = [
  'Swift', 'Silent', 'Brave', 'Clever', 'Lucky', 'Mighty', 'Nimble', 'Bold', 'Calm', 'Crimson', 'Golden', 'Hidden',
  'Iron', 'Jolly', 'Keen', 'Lunar', 'Mystic', 'Noble', 'Quick', 'Rapid', 'Sharp', 'Solar', 'Stellar', 'Steady',
  'Sunny', 'Tidal', 'Vivid', 'Wild', 'Witty', 'Zesty', 'Arcane', 'Blazing', 'Cosmic', 'Daring', 'Electric', 'Frosty',
  'Gentle', 'Humble', 'Jade', 'Kind', 'Loyal', 'Misty', 'Neon', 'Polar', 'Royal', 'Shadow', 'Thunder', 'Velvet',
];
export const ANIMALS = [
  'Kraken', 'Falcon', 'Tiger', 'Panda', 'Otter', 'Phoenix', 'Wolf', 'Eagle', 'Lynx', 'Raven', 'Dolphin', 'Fox',
  'Gecko', 'Hawk', 'Jaguar', 'Koala', 'Lion', 'Manta', 'Owl', 'Puma', 'Quokka', 'Rhino', 'Shark', 'Turtle',
  'Viper', 'Whale', 'Yak', 'Zebra', 'Badger', 'Cobra', 'Dragon', 'Ferret', 'Griffin', 'Heron', 'Ibis', 'Mantis',
  'Narwhal', 'Orca', 'Pelican', 'Stingray', 'Tarsier', 'Bison', 'Carabao', 'Tamaraw', 'Pawikan', 'Agila', 'Mongoose', 'Hornbill',
];

const pick = <T,>(list: readonly T[]) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];

export const isAnonAuthor = (author: string) => author === 'Anonymous' || ANON_PATTERN.test(author);
/** "Swift Kraken" for "Anonymous Swift Kraken"; null for real names and the old plain "Anonymous". */
export const aliasOf = (author: string) => ANON_PATTERN.test(author) ? author.slice(ANON_PREFIX.length) : null;

/** A fresh alias that no one in `taken` (author names already in the chat) is using. */
export function newAlias(taken: Iterable<string> = []) {
  const used = new Set(taken);
  for (let i = 0; i < 40; i++) {
    const name = `${ANON_PREFIX}${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
    if (!used.has(name)) return name;
  }
  // 2,304 combinations; reaching this means a very busy chat. Walk the list in order for a free one.
  for (const a of ADJECTIVES) for (const b of ANIMALS) { const name = `${ANON_PREFIX}${a} ${b}`; if (!used.has(name)) return name; }
  return `${ANON_PREFIX}${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

const key = (matchId: string) => `arenahub.anon.${matchId}`;
/** This viewer's alias for the match, created on first use and kept for the browser session. */
export function sessionAlias(matchId: string, taken: Iterable<string> = []) {
  try {
    const saved = sessionStorage.getItem(key(matchId));
    if (saved && ANON_PATTERN.test(saved)) return saved;
    const alias = newAlias(taken);
    sessionStorage.setItem(key(matchId), alias);
    return alias;
  } catch { return newAlias(taken); }
}
/** Swaps this viewer's alias for a new one (the "New name" button). */
export function rerollAlias(matchId: string, taken: Iterable<string> = []) {
  const alias = newAlias(taken);
  try { sessionStorage.setItem(key(matchId), alias); } catch { /* private mode: kept in memory by the caller */ }
  return alias;
}

/** Stable 32-bit hash for picking an avatar from an alias. */
export function hashString(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A 5 x 5 mirrored pattern (like a GitHub identicon) and a hue, both from the alias. */
export function aliasAvatar(alias: string) {
  const h = hashString(alias);
  const hue = h % 360;
  const cells: Array<[number, number]> = [];
  let bits = hashString(`${alias}#cells`);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (bits & 1) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
    bits >>>= 1;
    if (!bits) bits = hashString(`${alias}#${y}${x}`);
  }
  return { hue, cells };
}
