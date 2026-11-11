import { describe, expect, it } from 'vitest';
import { hash01, hashString, makeRng, stream } from './rng';

const sequence = (seed: number, n = 20): number[] => {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('makeRng', () => {
  it('is reproducible for a seed', () => {
    expect(sequence(99)).toEqual(sequence(99));
  });

  it('produces different sequences for different seeds', () => {
    expect(sequence(1)).not.toEqual(sequence(2));
  });

  it('stays inside the requested bounds', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      const r = rng.range(-3, 3);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThanOrEqual(3);
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = makeRng(2024);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const b = rng.int(10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    for (const b of buckets) {
      expect(Math.abs(b / n - 0.1)).toBeLessThan(0.01);
    }
  });
});

describe('named streams', () => {
  it('gives each system an independent sequence', () => {
    const weather = stream(5, 'weather');
    const growth = stream(5, 'growth');
    expect(Array.from({ length: 5 }, () => weather.next())).not.toEqual(
      Array.from({ length: 5 }, () => growth.next()),
    );
  });

  it('is stable across calls', () => {
    expect(stream(5, 'weather').next()).toBe(stream(5, 'weather').next());
  });
});

describe('hashes', () => {
  it('is stable and well spread', () => {
    expect(hashString('eurasia')).toBe(hashString('eurasia'));
    expect(hashString('a')).not.toBe(hashString('b'));
    const values = Array.from({ length: 2000 }, (_, i) => hash01(i));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
  });
});
