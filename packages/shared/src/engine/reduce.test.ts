import { describe, expect, it } from 'vitest';
import { BALANCE, MS_PER_DAY, dayIndex } from '../balance';
import type { Ctx, GameState } from './types';
import { accrue, createInitialState, pendingIncome, reduce } from './reduce';

const T0 = Date.UTC(2026, 0, 1); // exactly a UTC midnight, so day boundaries are unambiguous
const DAY = MS_PER_DAY;

const ctx = (nowMs: number, sea: readonly number[] = []): Ctx => ({
  nowMs,
  isLand: (cell) => cell >= 0 && cell < 100 && !sea.includes(cell),
  cellCount: 100,
});

const claim = (state: GameState, cell: number, nowMs = T0, slot: 0 | 1 = 0) =>
  reduce(state, { k: 'claim', cell, slot }, ctx(nowMs));

const unclaim = (state: GameState, cell: number, nowMs = T0, slot: 0 | 1 = 0) =>
  reduce(state, { k: 'unclaim', cell, slot }, ctx(nowMs));

describe('initial state', () => {
  it('starts with the balance starting coins and nothing claimed', () => {
    const s = createInitialState(42, T0);
    expect(s.coins).toEqual([BALANCE.claim.startCoins, BALANCE.claim.startCoins]);
    expect(s.claimed).toEqual([0, 0]);
    expect(Object.keys(s.cells)).toHaveLength(0);
    expect(s.lastDay).toBe(dayIndex(T0));
  });
});

describe('claiming', () => {
  it('charges the claim cost and records the cell', () => {
    const r = claim(createInitialState(1, T0), 7);
    expect(r.ok).toBe(true);
    expect(r.state.coins[0]).toBe(BALANCE.claim.startCoins - BALANCE.claim.cost);
    expect(r.state.claimed[0]).toBe(1);
    expect(r.state.cells['7']).toEqual({ o: 0, t: T0 });
    expect(r.events).toEqual([{ t: 'claimed', cell: 7, slot: 0, cost: BALANCE.claim.cost }]);
  });

  it('rejects a second claim on the same cell by the same player', () => {
    const first = claim(createInitialState(1, T0), 7);
    const second = claim(first.state, 7);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('already_owned');
    expect(second.state).toEqual(first.state);
  });

  it('rejects a claim on a cell owned by the other player', () => {
    const first = claim(createInitialState(1, T0), 7, T0, 0);
    const second = claim(first.state, 7, T0, 1);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('taken');
    expect(second.state.cells['7']).toEqual({ o: 0, t: T0 });
  });

  it('rejects when the player cannot afford it, and says why', () => {
    let s = createInitialState(1, T0);
    s = claim(s, 0).state;
    s = claim(s, 1).state; // 10 coins spent, 0 left
    expect(s.coins[0]).toBe(0);

    const r = claim(s, 2);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('no_coins');
    expect(r.state).toEqual(s);
  });

  it('rejects sea cells and out-of-bounds indices', () => {
    const sea = reduce(createInitialState(1, T0), { k: 'claim', cell: 3, slot: 0 }, ctx(T0, [3]));
    expect(sea.ok === false && sea.code).toBe('sea');

    const outside = claim(createInitialState(1, T0), 500);
    expect(outside.ok === false && outside.code).toBe('out_of_bounds');
    expect(outside.state.coins[0]).toBe(BALANCE.claim.startCoins);
  });
});

describe('unclaiming', () => {
  it('refunds exactly what was paid', () => {
    const claimed = claim(createInitialState(1, T0), 7);
    const removed = unclaim(claimed.state, 7);
    expect(removed.ok).toBe(true);
    expect(removed.state.coins[0]).toBe(BALANCE.claim.startCoins);
    expect(removed.state.claimed[0]).toBe(0);
    expect(removed.state.cells['7']).toBeUndefined();
  });

  it('cannot remove the opponent cells', () => {
    const mine = claim(createInitialState(1, T0), 7, T0, 0);
    const theirs = unclaim(mine.state, 7, T0, 1);
    expect(theirs.ok).toBe(false);
    expect(theirs.ok === false && theirs.code).toBe('not_owned');
    expect(theirs.state.cells['7']).toBeDefined();
  });
});

describe('income', () => {
  it('pays one coin per claimed cell per elapsed UTC day', () => {
    let s = createInitialState(1, T0);
    s = claim(s, 0).state;
    s = claim(s, 1).state; // 2 cells, coins now 0

    const r = reduce(s, { k: 'tick' }, ctx(T0 + 3 * DAY));
    expect(r.state.coins[0]).toBe(6);
    expect(r.events).toContainEqual({ t: 'income', slot: 0, days: 3, amount: 6, cells: 2 });
  });

  it('pays once per day, not once per command', () => {
    let s = createInitialState(1, T0);
    s = claim(s, 0).state;
    const first = reduce(s, { k: 'tick' }, ctx(T0 + DAY));
    const second = reduce(first.state, { k: 'tick' }, ctx(T0 + DAY + 1000));
    expect(first.state.coins[0]).toBe(6); // 5 left + 1
    expect(second.state.coins[0]).toBe(6);
  });

  it('does not mint coins when the clock goes backwards', () => {
    const s = createInitialState(1, T0 + 5 * DAY);
    const back = accrue(s, T0);
    expect(back.state.coins[0]).toBe(BALANCE.claim.startCoins);
    expect(back.state.lastDay).toBe(dayIndex(T0));
    expect(back.events).toEqual([]);
  });

  it('settles income before a claim, so a returning player can afford it', () => {
    let s = createInitialState(1, T0);
    s = claim(s, 0).state;
    s = claim(s, 1).state; // 0 coins
    const r = claim(s, 2, T0 + 5 * DAY);
    expect(r.ok).toBe(true);
    expect(r.state.coins[0]).toBe(BALANCE.claim.startCoins - BALANCE.claim.cost); // 5 + 5 - 5
  });

  it('reports pending income without changing state', () => {
    let s = createInitialState(1, T0);
    s = claim(s, 0).state;
    expect(pendingIncome(s, 0, T0 + 2 * DAY)).toEqual({ days: 2, amount: 2 });
  });
});

describe('purity', () => {
  it('does not mutate the input state', () => {
    const s = createInitialState(1, T0);
    const before = JSON.stringify(s);
    claim(s, 3);
    unclaim(s, 3);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is deterministic: same inputs, same output', () => {
    const a = claim(createInitialState(99, T0), 5);
    const b = claim(createInitialState(99, T0), 5);
    expect(a).toEqual(b);
  });
});
