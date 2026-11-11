import { BALANCE, MS_PER_DAY, createInitialState, getMap, reduce } from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import { buildBuildings, buildTerrain, depthTextureData, popScale } from './geometry';

const T0 = Date.UTC(2026, 0, 1);
const ctx = (nowMs: number) => ({
  nowMs,
  isLand: (cell: number) => getMap(500).mask[cell] === '#',
  cellCount: getMap(500).rows * getMap(500).cols,
});

function claimedState(cells: number[]) {
  let state = createInitialState(1, T0);
  // start with enough coins for the cells under test
  state = { ...state, coins: [cells.length * BALANCE.claim.cost + 10, 10] };
  for (const cell of cells) {
    const result = reduce(state, { k: 'claim', cell, slot: 0 }, ctx(T0));
    if (!result.ok) throw new Error(`could not claim ${cell}: ${result.code}`);
    state = result.state;
  }
  return state;
}

const landCells = (count: number): number[] => {
  const map = getMap(500);
  const out: number[] = [];
  for (let i = 0; i < map.mask.length && out.length < count; i++) {
    if (map.mask[i] === '#') out.push(i);
  }
  return out;
};

describe('buildTerrain', () => {
  const map = getMap(500);

  it('creates one slab per land cell and none for the sea', () => {
    const terrain = buildTerrain(map, true);
    expect(terrain).toHaveLength(map.land);
    expect(terrain.every((cell) => map.mask[cell.index] === '#')).toBe(true);
  });

  it('sits on the ground, half its height above zero', () => {
    for (const cell of buildTerrain(map, true)) {
      expect(cell.y).toBeCloseTo(cell.height / 2, 6);
      expect(cell.height).toBeGreaterThan(0);
    }
  });

  it('tints claimed cells without changing their footprint', () => {
    const index = landCells(1)[0] as number;
    const state = claimedState([index]);
    const plain = buildTerrain(map, true).find((cell) => cell.index === index);
    const owned = buildTerrain(map, true, state.cells).find((cell) => cell.index === index);
    expect(plain).toBeDefined();
    expect(owned).toBeDefined();
    expect(owned?.color).not.toEqual(plain?.color);
    expect(owned?.height).toBeCloseTo(plain?.height ?? 0, 6);
  });

  it('flattens when relief is off', () => {
    const heights = new Set(buildTerrain(map, false).map((cell) => cell.height.toFixed(4)));
    expect(heights.size).toBe(1);
  });
});

describe('buildBuildings', () => {
  const map = getMap(500);

  it('returns nothing for an empty map', () => {
    expect(buildBuildings(map, createInitialState(1, T0), T0, true)).toEqual([]);
  });

  it('stands one building per claimed cell', () => {
    const cells = landCells(3);
    const state = claimedState(cells);
    const buildings = buildBuildings(map, state, T0, true);
    expect(buildings.map((b) => b.index)).toEqual(cells);
    for (const building of buildings) {
      expect(building.height).toBeGreaterThan(0);
      expect(building.y).toBeGreaterThan(building.height / 2 - 0.001);
    }
  });

  it('grows over the configured period and then stops', () => {
    const [cell] = landCells(1) as [number];
    const state = claimedState([cell]);
    const at = (day: number) =>
      buildBuildings(map, state, T0 + day * MS_PER_DAY, true)[0]?.height ?? 0;

    const day0 = at(0);
    const day10 = at(10);
    const day29 = at(29);
    const day30 = at(30);
    const day60 = at(60);

    expect(day10).toBeGreaterThan(day0);
    expect(day29).toBeGreaterThan(day10);
    expect(day30).toBeGreaterThan(day29);
    expect(day60).toBeCloseTo(day30, 6);
  });

  it('ignores claimed cells that are not land', () => {
    const map800 = getMap(800);
    let sea = -1;
    for (let i = 0; i < map800.mask.length; i++) {
      if (map800.mask[i] === '.') {
        sea = i;
        break;
      }
    }
    const state = {
      ...createInitialState(1, T0),
      cells: { [String(sea)]: { o: 0 as const, t: T0 } },
      claimed: [1, 0] as [number, number],
    };
    expect(buildBuildings(map800, state, T0, true)).toHaveLength(0);
  });
});

describe('popScale', () => {
  it('is 1 outside the animation window', () => {
    expect(popScale(T0, T0 - 10)).toBe(1);
    expect(popScale(T0, T0 + BALANCE.growth.popMs + 1)).toBe(1);
  });

  it('overshoots just after the claim and comes back', () => {
    const mid = popScale(T0, T0 + BALANCE.growth.popMs * 0.35);
    const end = popScale(T0, T0 + BALANCE.growth.popMs * 0.99);
    expect(mid).toBeGreaterThan(1);
    expect(end).toBeLessThan(mid);
  });
});

describe('depthTextureData', () => {
  const map = getMap(300);

  it('marks land as deep so no foam can glow through the seams', () => {
    const data = depthTextureData(map);
    expect(data).toHaveLength(map.rows * map.cols);
    for (let i = 0; i < data.length; i++) {
      if (map.mask[i] === '#') expect(data[i]).toBe(255);
    }
  });

  it('gets deeper away from the coast', () => {
    const data = depthTextureData(map);
    const values = [...data].filter((_, i) => map.mask[i] === '.');
    expect(Math.max(...values)).toBeGreaterThan(100);
  });
});
