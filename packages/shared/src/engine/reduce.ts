import { BALANCE, MS_PER_DAY, dayIndex } from '../balance';
import type { CellState, Ctx, Command, GameEvent, GameState, Result, Slot } from './types';
import { SAVE_VERSION } from './types';

const SLOTS: readonly Slot[] = [0, 1];

export function createInitialState(seed: number, nowMs: number): GameState {
  const start = BALANCE.claim.startCoins;
  return {
    v: SAVE_VERSION,
    seed,
    cells: {},
    coins: [start, start],
    claimed: [0, 0],
    lastDay: dayIndex(nowMs),
  };
}

const key = (cell: number): string => String(cell);

/**
 * Credits income for every UTC day that has passed since the last visit.
 * One settlement, not a loop over days: the count is multiplied, never iterated,
 * so a three-month absence costs the same as a one-day one.
 */
export function accrue(state: GameState, nowMs: number): { state: GameState; events: GameEvent[] } {
  const today = dayIndex(nowMs);
  const days = today - state.lastDay;
  // A backwards clock (timezone change, manual date) must never mint coins.
  if (days <= 0) {
    return { state: days < 0 ? { ...state, lastDay: today } : state, events: [] };
  }

  const coins: [number, number] = [state.coins[0], state.coins[1]];
  const events: GameEvent[] = [];

  for (const slot of SLOTS) {
    const cells = state.claimed[slot];
    const amount = cells * BALANCE.income.perCellPerDay * days;
    coins[slot] += amount;
    if (amount > 0) {
      events.push({ t: 'income', slot, days, amount, cells });
    }
  }

  return { state: { ...state, coins, lastDay: today }, events };
}

function reject(
  state: GameState,
  code: Extract<GameEvent, { t: 'rejected' }>['code'],
  events: GameEvent[],
  cell?: number,
): Result {
  const event: GameEvent =
    cell === undefined ? { t: 'rejected', code } : { t: 'rejected', code, cell };
  return { ok: false, code, state, events: [...events, event] };
}

/**
 * The single entry point for changing the world.
 *
 * Pure: same (state, command, ctx) always yields the same (state, events).
 * Income is settled before every command, so a player who returns after a week
 * and immediately claims a cell is not charged against stale coins.
 */
export function reduce(state: GameState, cmd: Command, ctx: Ctx): Result {
  const settled = accrue(state, ctx.nowMs);
  const s = settled.state;
  const events: GameEvent[] = [...settled.events];

  switch (cmd.k) {
    case 'tick':
      return { ok: true, state: s, events };

    case 'claim': {
      const { cell, slot } = cmd;
      if (!Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) {
        return reject(s, 'out_of_bounds', events, cell);
      }
      if (!ctx.isLand(cell)) {
        return reject(s, 'sea', events, cell);
      }
      const existing = s.cells[key(cell)];
      if (existing !== undefined) {
        return reject(s, existing.o === slot ? 'already_owned' : 'taken', events, cell);
      }
      if (s.coins[slot] < BALANCE.claim.cost) {
        return reject(s, 'no_coins', events, cell);
      }

      const coins: [number, number] = [s.coins[0], s.coins[1]];
      const claimed: [number, number] = [s.claimed[0], s.claimed[1]];
      coins[slot] -= BALANCE.claim.cost;
      claimed[slot] += 1;

      const next: CellState = { o: slot, t: ctx.nowMs };
      const nextState: GameState = {
        ...s,
        cells: { ...s.cells, [key(cell)]: next },
        coins,
        claimed,
      };
      events.push({ t: 'claimed', cell, slot, cost: BALANCE.claim.cost });
      return { ok: true, state: nextState, events };
    }

    case 'unclaim': {
      const { cell, slot } = cmd;
      if (!Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) {
        return reject(s, 'out_of_bounds', events, cell);
      }
      const existing = s.cells[key(cell)];
      if (existing === undefined || existing.o !== slot) {
        return reject(s, 'not_owned', events, cell);
      }

      const coins: [number, number] = [s.coins[0], s.coins[1]];
      const claimed: [number, number] = [s.claimed[0], s.claimed[1]];
      coins[slot] += BALANCE.claim.refund;
      claimed[slot] = Math.max(0, claimed[slot] - 1);

      const cells: Record<string, CellState> = {};
      for (const k of Object.keys(s.cells)) {
        if (k !== key(cell)) cells[k] = s.cells[k] as CellState;
      }

      const nextState: GameState = { ...s, cells, coins, claimed };
      events.push({ t: 'unclaimed', cell, slot, refund: BALANCE.claim.refund });
      return { ok: true, state: nextState, events };
    }

    default:
      return reject(s, 'unknown_command', events);
  }
}

/** Income a slot would receive right now, without mutating anything. */
export function pendingIncome(
  state: GameState,
  slot: Slot,
  nowMs: number,
): { days: number; amount: number } {
  const days = Math.max(0, dayIndex(nowMs) - state.lastDay);
  return {
    days,
    amount: days * state.claimed[slot] * BALANCE.income.perCellPerDay,
  };
}

export { MS_PER_DAY };
