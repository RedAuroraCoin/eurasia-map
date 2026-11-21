import { describe, expect, it } from 'vitest';
import { BALANCE, MS_PER_DAY, dayIndex } from '../balance';
import type { Ctx, GameState } from './types';
import { applyFlood, createInitialState, reduce } from './reduce';

/**
 * Flooding is part of the day settlement, so these tests drive it through
 * `reduce`, exactly the way the browser and the room do — no private shortcuts.
 */

const T0 = Date.UTC(2026, 0, 1);
const DAY = MS_PER_DAY;
const FLOOD = BALANCE.flood;

const ctx = (nowMs: number): Ctx => ({
  nowMs,
  isLand: (cell) => cell >= 0 && cell < 100,
  cellCount: 100,
  cols: 10,
});

/** A city of `cells` claimed by slot 0, with the king on the first one. */
function city(cells: readonly number[], at = T0): GameState {
  let state = createInitialState(7, at);
  // Flooding is what is under test, not the wallet: keep the builder solvent.
  state = { ...state, coins: [1_000, 1_000] };
  for (const cell of cells) {
    const result = reduce(state, { k: 'claim', cell, slot: 0 }, ctx(at));
    if (!result.ok) throw new Error(`test setup could not claim ${cell}: ${result.code}`);
    state = result.state;
  }
  return state;
}

/** The same city, but the named cells are already close to drowning. */
function wetCity(
  water: number,
  wet: readonly number[] = [4],
  cells: readonly number[] = wet,
): GameState {
  const state = city(cells);
  const next: Record<string, GameState['cells'][string]> = {};
  for (const [key, cell] of Object.entries(state.cells)) {
    next[key] = wet.includes(Number(key)) ? { ...cell, water } : cell;
  }
  return { ...state, cells: next };
}

describe('daily flooding', () => {
  it('raises every owned cell by the daily amount', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + DAY));

    expect(after.state.cells['4']?.water).toBeCloseTo(FLOOD.baseRisePerDay, 6);
    expect(after.state.claimed[0]).toBe(1);
  });

  it('settles many days at once, not one day per call', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + 3 * DAY));

    expect(after.state.cells['4']?.water).toBeCloseTo(3 * FLOOD.baseRisePerDay, 6);
  });

  it('does not rise twice within the same day', () => {
    const once = reduce(city([4]), { k: 'tick' }, ctx(T0 + DAY));
    const twice = reduce(once.state, { k: 'tick' }, ctx(T0 + DAY + 1000));

    expect(twice.state.cells['4']?.water).toBeCloseTo(once.state.cells['4']?.water ?? 0, 6);
  });

  it('costs health in proportion to the rise', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + DAY));
    const expected =
      BALANCE.hurricane.cellHp - Math.round(FLOOD.baseRisePerDay * FLOOD.damagePerLevel);

    expect(after.state.cells['4']?.hp).toBe(expected);
  });

  it('reports how many cells rose, per slot', () => {
    const after = reduce(city([4, 5, 6]), { k: 'tick' }, ctx(T0 + DAY));
    const event = after.events.find((e) => e.t === 'flood');

    expect(event).toEqual({ t: 'flood', risen: 3, destroyed: 0, bySlot: [3, 0] });
  });

  it('leaves a dry map exactly as it was — no event, no new field', () => {
    const empty = createInitialState(7, T0);
    const after = reduce(empty, { k: 'tick' }, ctx(T0 + DAY));

    expect(after.state.cells).toEqual({});
    expect(after.events.find((e) => e.t === 'flood')).toBeUndefined();
  });

  it('drowns a cell that reaches the maximum and stops counting it', () => {
    const before = wetCity(FLOOD.maxLevel - FLOOD.baseRisePerDay / 2);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + DAY));

    expect(after.state.cells['4']).toBeUndefined();
    expect(after.state.claimed[0]).toBe(0);
    expect(after.events.find((e) => e.t === 'flood')).toMatchObject({ destroyed: 1, risen: 0 });
  });

  it('moves the king off a cell that drowns under it', () => {
    // Only the capital is wet: the neighbour must survive to take the king.
    const before = wetCity(FLOOD.maxLevel - FLOOD.baseRisePerDay / 2, [4], [4, 5]);
    // The king is on 5 after the last claim; make 4 the capital instead.
    const moved: GameState = { ...before, kings: [4, -1] };
    const after = reduce(moved, { k: 'tick' }, ctx(T0 + DAY));

    expect(after.state.kings[0]).toBe(5);
  });

  it('loses the capital when the drowning cell has no owned neighbour', () => {
    const before = wetCity(FLOOD.maxLevel - FLOOD.baseRisePerDay / 2, [4]);
    const after = reduce(before, { k: 'tick' }, ctx(T0 + DAY));

    expect(after.state.kings[0]).toBe(-1);
  });

  it('never exceeds the maximum, even after a very long absence', () => {
    const after = applyFlood(city([4]), 10_000, ctx(T0));
    expect(after.state.cells['4']).toBeUndefined();
  });
});

describe('storm surge', () => {
  it('a hurricane pushes water onto the cells it hits', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'damage', cells: [4] }, ctx(T0));

    expect(after.state.cells['4']?.water).toBeCloseTo(FLOOD.stormBonus, 6);
  });

  it('a surge that fills the cell destroys the tower even with health left', () => {
    const before = wetCity(FLOOD.maxLevel - FLOOD.stormBonus / 2);
    const after = reduce(before, { k: 'damage', cells: [4] }, ctx(T0));

    expect(after.state.cells['4']).toBeUndefined();
    expect(after.state.claimed[0]).toBe(0);
    expect(after.events.find((e) => e.t === 'damaged')).toMatchObject({ destroyed: true });
  });

  it('accumulates the surge between storms instead of resetting it', () => {
    // Two storms, not three: 100 hp / 35 per hit means the third one destroys
    // the tower by damage, which would hide what this asserts.
    let state = city([4]);
    for (let i = 0; i < 2; i++) {
      state = reduce(state, { k: 'damage', cells: [4] }, ctx(T0)).state;
    }
    expect(state.cells['4']?.water).toBeCloseTo(2 * FLOOD.stormBonus, 6);
  });
});

describe('flood and the save clock', () => {
  it('is keyed on lastDay, so a clock moved backwards adds no water', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'tick' }, ctx(T0 - DAY));

    expect(after.state.cells['4']?.water ?? 0).toBe(0);
    expect(after.state.lastDay).toBe(dayIndex(T0 - DAY));
  });

  it('a claim on a later day settles the flood in the same call', () => {
    const before = city([4]);
    const after = reduce(before, { k: 'claim', cell: 5, slot: 0 }, ctx(T0 + DAY));

    expect(after.ok).toBe(true);
    expect(after.state.cells['4']?.water).toBeCloseTo(FLOOD.baseRisePerDay, 6);
    // The new cell is claimed today, so it has no water yet.
    expect(after.state.cells['5']?.water ?? 0).toBe(0);
  });
});
