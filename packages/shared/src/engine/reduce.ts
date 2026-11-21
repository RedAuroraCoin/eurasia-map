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
    kings: [-1, -1],
  };
}

/**
 * The eight cells a chess king could step to, clipped to the grid. Row wrapping
 * is the trap here: cell 27 and cell 28 are neighbours in the array and on
 * opposite edges of the map.
 */
export function kingMoves(cell: number, ctx: Ctx): number[] {
  const cols = ctx.cols;
  const rows = Math.ceil(ctx.cellCount / cols);
  const col = cell % cols;
  const row = Math.floor(cell / cols);
  const moves: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      moves.push(r * cols + c);
    }
  }
  return moves;
}

export const isKingMove = (from: number, to: number, ctx: Ctx): boolean =>
  from >= 0 && kingMoves(from, ctx).includes(to);

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

/**
 * Daily flooding: every owned cell takes on water, loses a little health to it,
 * and is lost to the sea at the maximum.
 *
 * Deliberately part of the day settlement rather than a separate command: the
 * room and the browser then cannot disagree about whether today's rise has been
 * applied, because both settle through the same `lastDay`.
 */
export function applyFlood(
  state: GameState,
  days: number,
  ctx: Ctx,
): { state: GameState; events: GameEvent[] } {
  const rules = BALANCE.flood;
  const rise = rules.baseRisePerDay * days;
  if (ctx.flood === false || days <= 0 || rise <= 0) return { state, events: [] };

  const cells: Record<string, CellState> = { ...state.cells };
  const claimed: [number, number] = [state.claimed[0], state.claimed[1]];
  const kings: [number, number] = [state.kings[0], state.kings[1]];
  const bySlot: [number, number] = [0, 0];
  const damage = Math.round(rise * rules.damagePerLevel);
  let risen = 0;
  let destroyed = 0;

  for (const [k, cell] of Object.entries(state.cells)) {
    const water = Math.min(rules.maxLevel, (cell.water ?? 0) + rise);

    if (water >= rules.maxLevel) {
      delete cells[k];
      claimed[cell.o] = Math.max(0, claimed[cell.o] - 1);
      destroyed++;
      // Same rule as a destroyed tower: the king steps to an owned neighbour,
      // and the capital is gone only when there is nowhere to step.
      if (kings[cell.o] === Number(k)) {
        const fallback = kingMoves(Number(k), ctx).find(
          (neighbour) => cells[key(neighbour)]?.o === cell.o,
        );
        kings[cell.o] = fallback ?? -1;
      }
      continue;
    }

    const hp = Math.max(0, cell.hp - damage);
    cells[k] = hp > 0 ? { ...cell, water, hp } : { ...cell, water };
    bySlot[cell.o] += 1;
    risen++;
  }

  if (risen === 0 && destroyed === 0) return { state, events: [] };

  const events: GameEvent[] = [{ t: 'flood', risen, destroyed, bySlot }];
  return { state: { ...state, cells, claimed, kings }, events };
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
  // How many whole days this call settles. Read before `accrue` moves `lastDay`.
  const elapsed = dayIndex(ctx.nowMs) - state.lastDay;
  const settled = accrue(state, ctx.nowMs);
  const flood = applyFlood(settled.state, elapsed, ctx);
  const s = flood.state;
  const events: GameEvent[] = [...settled.events, ...flood.events];

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
      // Only the king builds, and it builds where it can walk: the first claim
      // founds the capital anywhere, every later one must be one king move away.
      const king = s.kings[slot];
      if (king >= 0 && !isKingMove(king, cell, ctx)) {
        return reject(s, 'not_adjacent', events, cell);
      }

      const coins: [number, number] = [s.coins[0], s.coins[1]];
      const claimed: [number, number] = [s.claimed[0], s.claimed[1]];
      const kings: [number, number] = [s.kings[0], s.kings[1]];
      coins[slot] -= BALANCE.claim.cost;
      claimed[slot] += 1;
      kings[slot] = cell;

      const next: CellState = { o: slot, t: ctx.nowMs, hp: BALANCE.hurricane.cellHp };
      const nextState: GameState = {
        ...s,
        cells: { ...s.cells, [key(cell)]: next },
        coins,
        claimed,
        kings,
      };
      events.push({ t: 'claimed', cell, slot, cost: BALANCE.claim.cost });
      return { ok: true, state: nextState, events };
    }

    case 'damage': {
      const cells: Record<string, CellState> = { ...s.cells };
      const claimed: [number, number] = [s.claimed[0], s.claimed[1]];
      const kings: [number, number] = [s.kings[0], s.kings[1]];
      const damage = BALANCE.hurricane.damagePerHit;
      const bySlot: [number, number] = [0, 0];
      let hits = 0;
      let destroyed = 0;

      const maxWater = BALANCE.flood.maxLevel;
      for (const cell of cmd.cells) {
        const existing = cells[key(cell)];
        if (existing === undefined) continue;
        hits++;
        bySlot[existing.o] += 1;
        const hp = Math.max(0, existing.hp - damage);
        // A hurricane is also a storm surge: it pushes water inland.
        const water = Math.min(maxWater, (existing.water ?? 0) + BALANCE.flood.stormBonus);

        if (hp > 0 && water < maxWater) {
          cells[key(cell)] = { ...existing, hp, water };
          events.push({ t: 'damaged', cell, hp, destroyed: false });
          continue;
        }

        delete cells[key(cell)];
        claimed[existing.o] = Math.max(0, claimed[existing.o] - 1);
        destroyed++;
        events.push({ t: 'damaged', cell, hp: 0, destroyed: true });

        // The king cannot stand on rubble: it falls back to an owned neighbour,
        // and only if there is none does the capital disappear.
        if (kings[existing.o] === cell) {
          const fallback = kingMoves(cell, ctx).find(
            (neighbour) => cells[key(neighbour)]?.o === existing.o,
          );
          kings[existing.o] = fallback ?? -1;
        }
      }

      if (hits === 0) return { ok: true, state: s, events };
      events.push({ t: 'storm', hits, destroyed, bySlot });
      return { ok: true, state: { ...s, cells, claimed, kings }, events };
    }

    case 'move': {
      const { cell, slot } = cmd;
      if (!Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) {
        return reject(s, 'out_of_bounds', events, cell);
      }
      const king = s.kings[slot];
      if (king < 0) return reject(s, 'king_unplaced', events, cell);
      if (!isKingMove(king, cell, ctx)) return reject(s, 'not_adjacent', events, cell);
      const existing = s.cells[key(cell)];
      if (existing === undefined || existing.o !== slot) {
        return reject(s, 'not_owned', events, cell);
      }

      const kings: [number, number] = [s.kings[0], s.kings[1]];
      kings[slot] = cell;
      events.push({ t: 'moved', cell, slot });
      return { ok: true, state: { ...s, kings }, events };
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
      // The king is standing on it: move the king first.
      if (s.kings[slot] === cell) {
        return reject(s, 'king_cell', events, cell);
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
