// Exam Prep Mock — deterministic seeded randomness.
//
// Paper generation is history-blind and fully deterministic for a fixed
// profile + seed: same seed => same question ids, same source task ids, same
// order. `Math.random()` is never used inside the paper builder; a session
// generates its seed once via crypto and stores it in the session record.

/** xmur3 string hash -> 32-bit seed for mulberry32. */
export const hashMockSeedString = (value: string): number => {
  let h = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    h = Math.imul(h ^ value.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
};

/** mulberry32 PRNG seeded from a string. Returns numbers in [0, 1). */
export const createSeededMockRng = (seed: string): (() => number) => {
  let state = hashMockSeedString(seed) || 0x9e3779b9;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Random session seed via crypto (Math.random fallback when unavailable). */
export const randomMockSeed = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** Deterministic Fisher–Yates shuffle over the input (never mutates it). */
export const seededMockShuffle = <T>(input: readonly T[], seed: string): T[] => {
  const items = input.slice();
  const rng = createSeededMockRng(seed);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const value = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = value;
  }
  return items;
};
