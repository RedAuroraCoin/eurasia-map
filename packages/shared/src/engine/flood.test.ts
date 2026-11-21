import { describe, expect, it } from 'vitest';
import { BALANCE, MS_PER_DAY, dayIndex } from '../balance';
import { getMap } from '../map';
import type { Ctx, GameState } from './types';
import { applyFlood, createInitialState, reduce } from './reduce';

/**
 * Flooding is part of the day settlement, so these tests drive it through
 * `reduce`, exactly the way the browser and the room do — no private shortcuts.
 *
 * Ground height is what decides, so every test states the elevation it cares
 * about instead of inferring it: `ctx(now, { 4: 100 })` puts cell 4 at 100 m and
 * leaves the rest of the grid on a safe plateau.
 */

const T0 = Date.UTC(2026, 0, 1);
const DAY = MS_PER_DAY;
const FLOOD = BALANCE.flood;

/** Any cell without an explicit height is high ground the sea never reaches. */
const SAFE = 3000;

function ctx(nowMs: number, heights: Record<number, number> = {}): Ctx {
  const elev = Array.from({ length: 100 }, (_, index) => heights[index] ?? SAFE);
  return {
    nowMs,
    isLand: (cell) => cell >= 0 && cell < 100,
    cellCount: 100,
    cols: 10,
    elev,
  };
}

/** A city of `cells` claimed by slot 0, with the king on the last one. */
function city(cells: readonly number[], heights: Record<number, number> = {}, at = T0): GameState {
  let state = createInitialState(7, at);
  // Flooding is what is under test, not the wallet: keep the builder solvent.
  state = { ...state, coins: [1_000, 1_000] };
  for (const cell of cells) {
    const result = reduce(state, { k: 'claim', cell, slot: 0 }, ctx(at, heights));
    if (!result.ok) throw new Error(`test setup could not claim ${cell}: ${result.code}`);
    state = result.state;
  }
  return state;
}

/** Days needed for the sea to reach `metres`, rounded up. */
const daysTo = (metres: number): number => Math.ceil(metres / FLOOD.metresPerDay);

describe('the rising sea', () => {
  it('climbs by the daily amount per settled day', () => {
    const after = reduce(city([4]), { k: 'tick' }, ctx(T0 + DAY));
    expect(after.state.seaLevel).toBe(FLOOD.startLevel + FLOOD.metresPerDay);
  });

  it('settles many days at once, not one day per call', () => {
    const after = reduce(city([4]), { k: 'tick' }, ctx(T0 + 3 * DAY));
    expect(after.state.seaLevel).toBe(FLOOD.startLevel + 3 * FLOOD.metresPerDay);
  });

  it('does not rise twice within the same day', () => {
    const once = reduce(city([4]), { k: 'tick' }, ctx(T0 + DAY));
    const twice = reduce(once.state, { k: 'tick' }, ctx(T0 + DAY + 1000));
    expect(twice.state.seaLevel).toBe(once.state.seaLevel);
  });

  it('stops at the maximum however long the player was away', () => {
    const after = applyFlood(city([4]), 10_000, ctx(T0));
    expect(after.state.seaLevel).toBe(FLOOD.maxLevel);
  });

  it('starts every game at the level in the balance file', () => {
    expect(createInitialState(1, T0).seaLevel).toBe(FLOOD.startLevel);
  });
});

describe('drowning', () => {
  it('takes the cells below the waterline and leaves the high ground', () => {
    const before = city([4, 5], { 4: 100, 5: 1500 });
    const after = reduce(before, { k: 'tick' }, ctx(T0 + daysTo(200) * DAY, { 4: 100, 5: 1500 }));

    expect(after.state.cells['4']).toBeUndefined();
    expect(after.state.cells['5']).toBeDefined();
    expect(after.state.claimed[0]).toBe(1);
  });

  it('takes a whole lowland city at once', () => {
    const heights = { 4: 50, 5: 60, 6: 70 };
    const before = city([4, 5, 6], heights);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + daysTo(500) * DAY, heights));

    expect(Object.keys(after.state.cells)).toEqual([]);
    expect(after.state.claimed[0]).toBe(0);
  });

  it('reports the new level and how many cells it took, per slot', () => {
    const heights = { 4: 100, 5: 2000 };
    const before = city([4, 5], heights);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + daysTo(200) * DAY, heights));

    expect(after.events.find((e) => e.t === 'flood')).toEqual({
      t: 'flood',
      level: daysTo(200) * FLOOD.metresPerDay,
      destroyed: 1,
      bySlot: [1, 0],
    });
  });

  it('moves the king off a cell that drowns under it', () => {
    const heights = { 4: 100, 5: 2500 };
    const before = city([4, 5], heights);
    // The last claim left the king on 5; put it back on the low capital.
    const moved: GameState = { ...before, kings: [4, -1] };
    const after = reduce(moved, { k: 'tick' }, ctx(T0 + daysTo(200) * DAY, heights));

    expect(after.state.kings[0]).toBe(5);
  });

  it('loses the capital when the drowning cell has no owned neighbour', () => {
    const after = reduce(
      city([4], { 4: 100 }),
      { k: 'tick' },
      ctx(T0 + daysTo(200) * DAY, { 4: 100 }),
    );
    expect(after.state.kings[0]).toBe(-1);
  });

  it('refuses to build on land the sea has taken', () => {
    const heights = { 4: 100 };
    // Four days of rise puts the sea at 200 m, over cell 4.
    const risen = reduce(city([], heights), { k: 'tick' }, ctx(T0 + daysTo(200) * DAY, heights));
    const claim = reduce(
      risen.state,
      { k: 'claim', cell: 4, slot: 0 },
      ctx(T0 + daysTo(200) * DAY, heights),
    );

    if (claim.ok) throw new Error('the sea should have refused the claim');
    expect(claim.code).toBe('flooded');
  });

  it('leaves a city above the waterline untouched, with no event at all', () => {
    const before = city([4, 5], { 4: 3000, 5: 3100 });
    const after = reduce(before, { k: 'tick' }, ctx(T0 + DAY, { 4: 3000, 5: 3100 }));

    expect(after.state.cells['4']).toBeDefined();
    expect(after.state.cells['5']).toBeDefined();
    expect(after.events.find((e) => e.t === 'flood')).toBeUndefined();
  });
});

describe('storm surge', () => {
  it('lifts the water only at the cells the hurricane hit', () => {
    const heights = { 4: 1000, 5: 1000 };
    const after = reduce(city([4, 5], heights), { k: 'damage', cells: [4] }, ctx(T0, heights));

    expect(after.state.cells['4']?.surge).toBe(FLOOD.stormSurge);
    expect(after.state.cells['5']?.surge).toBeUndefined();
    expect(after.state.seaLevel).toBe(FLOOD.startLevel);
  });

  it('drowns a low cell the level itself has not reached yet', () => {
    const heights = { 4: 100 };
    const after = reduce(city([4], heights), { k: 'damage', cells: [4] }, ctx(T0, heights));

    expect(after.state.cells['4']).toBeUndefined();
    expect(after.events.find((e) => e.t === 'damaged')).toMatchObject({ destroyed: true });
  });

  it('does not drown high ground, even hit repeatedly', () => {
    const heights = { 4: 2000 };
    let state = city([4], heights);
    // Two hits: 100 hp / 35 per hit would leave the tower standing, and the
    // surge would still be far below 2000 m.
    for (let i = 0; i < 2; i++) {
      state = reduce(state, { k: 'damage', cells: [4] }, ctx(T0, heights)).state;
    }

    expect(state.cells['4']).toBeDefined();
    expect(state.cells['4']?.hp).toBe(
      BALANCE.hurricane.cellHp - 2 * BALANCE.hurricane.damagePerHit,
    );
    expect(state.cells['4']?.surge).toBe(2 * FLOOD.stormSurge);
  });
});

describe('the sea against the real terrain', () => {
  it('takes the lowlands first and leaves the plateau last', () => {
    const map = getMap(500);
    const land = [...map.mask].filter((c) => c === '#').length;
    const above = (level: number): number =>
      [...map.mask].filter((c, i) => c === '#' && (map.elev[i] ?? 0) >= level).length;

    // The curve the mechanic is built on: monotonic, and steep at the bottom.
    expect(above(0)).toBe(land);
    expect(above(200)).toBeLessThan(above(0));
    expect(above(1000)).toBeLessThan(above(200));
    expect(above(2000)).toBeLessThan(above(1000));
    // At 2000 m only the highlands are left — a few percent, not a continent.
    expect(above(2000) / land).toBeLessThan(0.1);
    expect(above(2000)).toBeGreaterThan(0);
  });
});

describe('the flood switch', () => {
  it('does nothing at all when the caller turns it off', () => {
    const before = city([4], { 4: 100 });
    const after = reduce(before, { k: 'tick' }, { ...ctx(T0 + DAY, { 4: 100 }), flood: false });

    expect(after.state.seaLevel).toBe(FLOOD.startLevel);
    expect(after.state.cells['4']).toBeDefined();
    expect(after.events.find((e) => e.t === 'flood')).toBeUndefined();
  });

  it('still pays income while the water is off', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'tick' }, { ...ctx(T0 + DAY), flood: false });

    expect(after.state.coins[0]).toBeGreaterThan(before.coins[0]);
  });

  it('defaults to on when the caller says nothing', () => {
    const after = reduce(city([4]), { k: 'tick' }, ctx(T0 + DAY));
    expect(after.state.seaLevel).toBe(FLOOD.startLevel + FLOOD.metresPerDay);
  });
});

describe('flood and the save clock', () => {
  it('is keyed on lastDay, so a clock moved backwards raises nothing', () => {
    const after = reduce(city([4]), { k: 'tick' }, ctx(T0 - DAY));

    expect(after.state.seaLevel).toBe(FLOOD.startLevel);
    expect(after.state.lastDay).toBe(dayIndex(T0 - DAY));
  });

  it('a claim on a later day settles the rise in the same call', () => {
    const after = reduce(city([4]), { k: 'claim', cell: 5, slot: 0 }, ctx(T0 + DAY));

    expect(after.ok).toBe(true);
    expect(after.state.seaLevel).toBe(FLOOD.startLevel + FLOOD.metresPerDay);
  });
});
