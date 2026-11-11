import { describe, expect, it } from 'vitest';
import { BALANCE, MS_PER_DAY } from '../balance';
import { growthProgress, heightVariation, isGrown } from './growth';

const BORN = Date.UTC(2026, 0, 1);
const GROWN_MS = BALANCE.growth.days * MS_PER_DAY;

describe('growth curve', () => {
  it('is zero before the cell exists and one after the full period', () => {
    expect(growthProgress(1, 0, BORN + 1000)).toBe(0);
    expect(growthProgress(1, BORN, BORN + GROWN_MS)).toBe(1);
    expect(growthProgress(1, BORN, BORN + GROWN_MS * 2)).toBe(1);
  });

  it('never decreases', () => {
    let prev = -1;
    for (let day = 0; day <= BALANCE.growth.days; day++) {
      const v = growthProgress(3, BORN, BORN + day * MS_PER_DAY);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('front-loads the visible work', () => {
    const half = growthProgress(3, BORN, BORN + GROWN_MS / 2);
    expect(half).toBeGreaterThan(0.5);
  });

  it('flags a cell as grown only at the end', () => {
    expect(isGrown(3, BORN, BORN + GROWN_MS)).toBe(true);
    expect(isGrown(3, BORN, BORN + GROWN_MS - MS_PER_DAY)).toBe(false);
  });
});

describe('per-cell variation', () => {
  it('stays inside the configured band and is stable', () => {
    const v = BALANCE.growth.variation;
    for (let cell = 0; cell < 500; cell++) {
      const h = heightVariation(cell);
      expect(h).toBeGreaterThanOrEqual(1 - v / 2 - 1e-9);
      expect(h).toBeLessThanOrEqual(1 + v / 2 + 1e-9);
      expect(heightVariation(cell)).toBe(h);
    }
  });

  it('makes neighbouring cells visibly different', () => {
    const heights = [0, 1, 2, 3, 4].map((c) => heightVariation(c));
    expect(new Set(heights).size).toBe(heights.length);
  });
});
