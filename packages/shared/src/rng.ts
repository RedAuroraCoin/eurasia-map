/**
 * Deterministic PRNG. xoshiro128** is small, fast and has no hidden state outside
 * the four words we hand out, which is what makes replays and server/client
 * agreement possible.
 *
 * Rules of use (enforced by review, because a linter cannot see intent):
 *   - never seed from Math.random() or Date.now() inside the engine;
 *   - derive one stream per system (`stream(seed, 'weather')`) so that adding a
 *     system cannot shift the sequence another system depends on.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform integer in [min, max], both inclusive. */
  range(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Roughly normal, mean 0, sd 1 (sum of 3 uniforms, cheap and bounded). */
  gauss(): number;
  pick<T>(items: readonly T[]): T;
}

/** FNV-1a, 32 bit. Stable across runs and platforms. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 — used only to expand one seed into the four state words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export function makeRng(seed: number): Rng {
  const expand = splitmix32(seed >>> 0);
  let s0 = expand();
  let s1 = expand();
  let s2 = expand();
  let s3 = expand();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const next = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result / 0x1_0000_0000;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    int,
    range: (min, max) => min + int(max - min + 1),
    float: (min, max) => min + next() * (max - min),
    gauss: () => (next() + next() + next() - 1.5) * 1.1547,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() on an empty array');
      return items[int(items.length)] as (typeof items)[number];
    },
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** An independent stream per named system, derived from the same seed. */
export function stream(seed: number, label: string): Rng {
  return makeRng((seed ^ hashString(label)) >>> 0);
}

/** Deterministic value in [0,1) for a cell index — no PRNG state involved. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0x1_0000_0000;
}
