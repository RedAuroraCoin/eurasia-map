import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { getMap } from '../map';
import { planStorm, stormCells, stormPointAt } from './index';

const T0 = Date.UTC(2026, 0, 1);
const plan = (seed: number, side = 12_000) =>
  planStorm({ seed, id: 1, startAt: T0, durationMs: side, rows: 29, cols: 35 });

describe('storm plan', () => {
  it('is deterministic: the same seed gives the same storm', () => {
    expect(plan(1234)).toEqual(plan(1234));
    expect(plan(1234)).not.toEqual(plan(4321));
  });

  it('enters from one edge and leaves by the other', () => {
    for (const seed of [1, 7, 99, 12_345]) {
      const storm = plan(seed);
      const first = storm.path[0] as readonly [number, number];
      const last = storm.path[4] as readonly [number, number];
      const radius = storm.radius;

      if (storm.side === 'west') {
        expect(first[0]).toBeLessThan(0);
        expect(last[0]).toBeGreaterThan(35);
      } else {
        expect(first[0]).toBeGreaterThan(35);
        expect(last[0]).toBeLessThan(0);
      }
      void radius;
    }
  });

  it('stays inside the rows, so the funnel never leaves the map sideways', () => {
    for (let seed = 1; seed < 60; seed++) {
      for (const [, row] of plan(seed * 7919).path) {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThanOrEqual(29);
      }
    }
  });

  it('winds: the path does not stay on one row', () => {
    const storms = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => plan(seed * 101));
    const spread = storms.map((storm) => {
      const rows = storm.path.map(([, row]) => row);
      return Math.max(...rows) - Math.min(...rows);
    });
    // at least half the storms must visibly bend, or the path generator is broken
    expect(spread.filter((value) => value > 0.5).length).toBeGreaterThanOrEqual(4);
  });

  it('moves monotonically across the map', () => {
    const storm = plan(4242);
    const xs: number[] = [];
    for (let i = 0; i <= 20; i++) {
      xs.push(stormPointAt(storm, storm.startAt + ((storm.endsAt - storm.startAt) * i) / 20)[0]);
    }
    const west = storm.side === 'west';
    for (let i = 1; i < xs.length; i++) {
      if (west) expect(xs[i] as number).toBeGreaterThan(xs[i - 1] as number);
      else expect(xs[i] as number).toBeLessThan(xs[i - 1] as number);
    }
  });

  it('damage lands while the storm is still on the map', () => {
    const storm = plan(777);
    expect(storm.damageAt).toBeGreaterThan(storm.startAt);
    expect(storm.damageAt).toBeLessThan(storm.endsAt);
    expect(storm.damageAt).toBeCloseTo(
      storm.startAt + (storm.endsAt - storm.startAt) * BALANCE.hurricane.damageAtRatio,
      6,
    );
  });
});

describe('storm cells', () => {
  const map = getMap(300);

  it('only ever returns land cells', () => {
    for (let seed = 1; seed < 12; seed++) {
      for (const cell of stormCells(plan(seed * 31, 8000), map)) {
        expect(map.mask[cell]).toBe('#');
      }
    }
  });

  it('hits a band, not the whole map', () => {
    const cells = stormCells(plan(2024, 8000), map);
    const land = map.mask.split('').filter((ch) => ch === '#').length;
    expect(cells.length).toBeGreaterThan(3);
    expect(cells.length).toBeLessThan(land * 0.55);
  });

  it('is deterministic and duplicate free', () => {
    const a = stormCells(plan(31337, 8000), map);
    const b = stormCells(plan(31337, 8000), map);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
