import {
  BALANCE,
  MS_PER_DAY,
  createInitialState,
  getMap,
  landColor,
  reduce,
  seaColor,
} from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import {
  buildBuildings,
  buildTerrain,
  depthTextureData,
  OWNER_TINT,
  popScale,
  unitColor,
} from './geometry';

const T0 = Date.UTC(2026, 0, 1);
const ctx = (nowMs: number) => ({
  nowMs,
  isLand: (cell: number) => getMap(500).mask[cell] === '#',
  cellCount: getMap(500).rows * getMap(500).cols,
  cols: getMap(500).cols,
  elev: getMap(500).elev,
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

/**
 * A connected run of land cells, in walking order: the king can only build one
 * step from where it stands, so tests that need several claims need a path.
 */
const landCells = (count: number): number[] => {
  const map = getMap(500);
  // A straight run east: every step is a king move, and a run cannot dead-end
  // the way a greedy walk can.
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col + count <= map.cols; col++) {
      const run: number[] = [];
      for (let i = 0; i < count; i++) run.push(row * map.cols + col + i);
      if (run.every((cell) => map.mask[cell] === '#')) return run;
    }
  }
  throw new Error(`no straight run of ${count} land cells`);
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

describe('colour space', () => {
  const map = getMap(500);

  it('converts 0..255 ramp colours into the 0..1 three expects', () => {
    expect(unitColor([255, 0, 127])).toEqual([1, 0, 127 / 255]);
    expect(unitColor(OWNER_TINT).every((channel) => channel <= 1)).toBe(true);
  });

  it('keeps every terrain colour inside 0..255 and none of them white', () => {
    const cells = buildTerrain(map, true);
    for (const cell of cells.slice(0, 200)) {
      for (const channel of cell.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
      // the bug this guards: 0..255 handed to setRGB clamps to white
      expect(unitColor(cell.color).every((channel) => channel < 0.99)).toBe(true);
    }
  });

  it('mixes the owner tint into the same space, so claimed land warms up', () => {
    const index = landCells(1)[0] as number;
    const state = claimedState([index]);
    const plain = buildTerrain(map, true).find((cell) => cell.index === index);
    const owned = buildTerrain(map, true, state.cells).find((cell) => cell.index === index);
    expect(plain).toBeDefined();
    expect(owned).toBeDefined();
    expect((owned?.color[0] ?? 0) / 255).toBeGreaterThan((plain?.color[0] ?? 0) / 255);
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

  it('stops drawing the ground the sea has taken, and keeps the high ground', () => {
    const map500 = getMap(500);
    const low = map500.elev.findIndex((e, i) => map500.mask[i] === '#' && e < 400);
    const high = map500.elev.findIndex((e, i) => map500.mask[i] === '#' && e > 4500);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeGreaterThanOrEqual(0);

    const dry = buildTerrain(map500, true, {}, 0);
    const risen = buildTerrain(map500, true, {}, 600);

    expect(dry.some((cell) => cell.index === low)).toBe(true);
    expect(risen.some((cell) => cell.index === low)).toBe(false);
    expect(risen.some((cell) => cell.index === high)).toBe(true);
    // The board genuinely loses cells as the level climbs.
    expect(risen.length).toBeLessThan(dry.length);
  });

  it('paints drowned cells as sea when the board is flat, instead of cutting holes', () => {
    const map500 = getMap(500);
    const low = map500.elev.findIndex((e, i) => map500.mask[i] === '#' && e < 400);
    expect(low).toBeGreaterThanOrEqual(0);
    const level = 600;

    // Relief on: the plate is gone, the sea plane covers the space.
    expect(buildTerrain(map500, true, {}, level).some((c) => c.index === low)).toBe(false);

    // Relief off: every cell is the same height, so cutting one would leave a
    // hole down to the water. It stays, painted as sea.
    const flat = buildTerrain(map500, false, {}, level);
    const cell = flat.find((c) => c.index === low);
    expect(cell).toBeDefined();
    expect(cell?.color).not.toEqual(landColor(map500.elev[low] ?? 0));
    const expected = seaColor((map500.elev[low] ?? 0) - level);
    expect(cell?.color.map((v) => Math.round(v * 1000))).toEqual(
      expected.map((v) => Math.round(v * 1000)),
    );
  });

  it('does not draw a building the sea has taken', () => {
    const [cell] = landCells(1) as [number];
    const base = claimedState([cell]);
    const ground = map.elev[cell] ?? 0;
    const now = T0 + 60 * MS_PER_DAY;

    expect(buildBuildings(map, base, now, true, ground).length).toBe(1);
    expect(buildBuildings(map, base, now, true, ground + 1).length).toBe(0);
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
      cells: {
        [String(sea)]: { o: 0 as const, t: T0, hp: BALANCE.hurricane.cellHp },
      },
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
