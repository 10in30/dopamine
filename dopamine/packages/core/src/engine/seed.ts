/** Deterministic, seedable PRNG so a given `seed` always yields the same look. */

export type Rng = () => number;

/**
 * mulberry32 — tiny, fast, good-enough-for-visuals PRNG. Returns values in
 * [0, 1). Deterministic for a given 32-bit seed.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 32-bit seed — used when the caller doesn't pin one. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
