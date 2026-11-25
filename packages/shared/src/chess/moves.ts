import { BALANCE } from '../balance';
import type { ChessCtx, ChessState, Piece, Side } from './types';

/**
 * Chess movement on a terrain grid.
 *
 * Everything here is pure: it answers "where can this piece go" and "where may
 * the king build" without touching the state, so the client can highlight the
 * same squares the reducer will accept.
 */

export interface Spot {
  readonly row: number;
  readonly col: number;
}

export const spotOf = (cell: number, cols: number): Spot => ({
  row: Math.floor(cell / cols),
  col: cell % cols,
});

export const cellOf = (row: number, col: number, ctx: ChessCtx): number | null =>
  row < 0 || col < 0 || row >= ctx.rows || col >= ctx.cols ? null : row * ctx.cols + col;

/**
 * How far a sliding piece may travel in one direction. The map is 44 cells wide,
 * and an unlimited rook on an open continent is a sniper: seven squares keeps
 * the long vectors long without letting one piece command half the board.
 */
export const SLIDE_LIMIT = 7;

const ORTHO: readonly [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const DIAGONAL: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ALL8: readonly [number, number][] = [...ORTHO, ...DIAGONAL];
const KNIGHT: readonly [number, number][] = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];

/** Land above the waterline. Towers and pieces are handled by the callers. */
export const isDryLand = (cell: number, state: ChessState, ctx: ChessCtx): boolean =>
  ctx.isLand(cell) && (ctx.elev[cell] ?? 0) >= state.seaLevel;

/** Eight neighbours, for the king's step and for building next to it. */
export function neighbours(cell: number, ctx: ChessCtx): number[] {
  const { row, col } = spotOf(cell, ctx.cols);
  const out: number[] = [];
  for (const [dr, dc] of ALL8) {
    const next = cellOf(row + dr, col + dc, ctx);
    if (next !== null) out.push(next);
  }
  return out;
}

/**
 * Every cell this piece may legally enter right now.
 *
 * The rules are chess rules with three map additions: water is a wall, the map
 * edge is the board edge, and a tower is a capturable obstacle.
 */
export function legalTargets(state: ChessState, piece: Piece, ctx: ChessCtx): number[] {
  const occupied = new Map<number, Piece>();
  for (const other of state.pieces) {
    if (other.id !== piece.id) occupied.set(other.cell, other);
  }

  const structureOwner = (cell: number): Side | null => {
    const side = state.towers[String(cell)] ?? state.rockets[String(cell)];
    return side === undefined ? null : (side as Side);
  };

  /** 0 = cannot enter, 1 = enter and stop (capture), 2 = free. */
  const entry = (cell: number): 0 | 1 | 2 => {
    if (!isDryLand(cell, state, ctx)) return 0;
    const other = occupied.get(cell);
    if (other) return other.side === piece.side ? 0 : 1;
    // A tower and a rocket base are both structures: yours blocks, theirs can be
    // taken by landing on it.
    const structure = structureOwner(cell);
    if (structure !== null) return structure === piece.side ? 0 : 1;
    return 2;
  };

  const out: number[] = [];
  const { row, col } = spotOf(piece.cell, ctx.cols);

  const slide = (directions: readonly (readonly [number, number])[], maxSteps: number): void => {
    for (const [dr, dc] of directions) {
      for (let step = 1; step <= maxSteps; step++) {
        const next = cellOf(row + dr * step, col + dc * step, ctx);
        if (next === null) break;
        const kind = entry(next);
        if (kind === 0) break;
        out.push(next);
        if (kind === 1) break;
      }
    }
  };

  switch (piece.kind) {
    case 'rook':
      slide(ORTHO, SLIDE_LIMIT);
      break;
    case 'bishop':
      slide(DIAGONAL, SLIDE_LIMIT);
      break;
    case 'queen':
      slide(ALL8, SLIDE_LIMIT);
      break;
    case 'king':
      slide(ALL8, 1);
      break;
    case 'knight':
      for (const [dr, dc] of KNIGHT) {
        const next = cellOf(row + dr, col + dc, ctx);
        if (next === null) continue;
        // A knight jumps: it only cares about the landing square.
        if (entry(next) !== 0) out.push(next);
      }
      break;
    case 'pawn': {
      // A pawn walks in a straight line — one of the four directions — one or two
      // squares, at any time. The two-square step is no longer a privilege of the
      // starting square: a pawn is slow enough with the sea rising behind it.
      for (const [dr, dc] of ORTHO) {
        const first = cellOf(row + dr, col + dc, ctx);
        if (first === null || entry(first) !== 2) continue;
        out.push(first);
        // It never jumps: the second square has to be free as well.
        const second = cellOf(row + dr * 2, col + dc * 2, ctx);
        if (second !== null && entry(second) === 2) out.push(second);
      }
      // But it still fights on the diagonals only: one step, one direction for
      // walking and another for taking, the way a pawn always has.
      for (const [dr, dc] of DIAGONAL) {
        const target = cellOf(row + dr, col + dc, ctx);
        if (target !== null && entry(target) === 1) out.push(target);
      }
      break;
    }
    default:
      break;
  }

  return out;
}

/** Cells the side's king could fortify right now: dry, empty, next to it. */
export function buildSpots(state: ChessState, ctx: ChessCtx): number[] {
  const king = state.pieces.find((p) => p.side === state.turn && p.kind === 'king');
  if (!king) return [];
  const taken = new Set(state.pieces.map((p) => p.cell));
  return neighbours(king.cell, ctx).filter(
    (cell) =>
      isDryLand(cell, state, ctx) &&
      !taken.has(cell) &&
      state.towers[String(cell)] === undefined &&
      state.rockets[String(cell)] === undefined,
  );
}

/** One cell a base can aim at, and how close to the base it is. */
export interface ReachCell {
  readonly cell: number;
  /** 1 at the base, falling to ~0 at the edge of the range. */
  readonly strength: number;
}

/**
 * Every cell a rocket base can put the middle of its 3x3 blast on: Chebyshev
 * distance up to the range, land only — a blast over open water has nothing to hit.
 *
 * This is display data, not a rule: the shot itself is validated by the reducer.
 */
export function rocketReach(base: number, ctx: ChessCtx): ReachCell[] {
  const range = BALANCE.chess.rocketRange;
  const row = Math.floor(base / ctx.cols);
  const col = base % ctx.cols;
  const out: ReachCell[] = [];

  for (let dr = -range; dr <= range; dr++) {
    const r = row + dr;
    if (r < 0 || r >= ctx.rows) continue;
    for (let dc = -range; dc <= range; dc++) {
      const c = col + dc;
      if (c < 0 || c >= ctx.cols) continue;
      const cell = r * ctx.cols + c;
      if (!ctx.isLand(cell)) continue;
      const distance = Math.max(Math.abs(dr), Math.abs(dc));
      out.push({ cell, strength: 1 - distance / (range + 1) });
    }
  }

  return out;
}

/** The side's own rocket bases. */
export function rocketCells(state: ChessState, side: Side): number[] {
  return Object.entries(state.rockets)
    .filter(([, owner]) => owner === side)
    .map(([cell]) => Number(cell))
    .sort((a, b) => a - b);
}

/**
 * Towers the side to move could recruit a pawn into.
 *
 * A tower is a garrison as well as an obstacle: its own pawn cannot be reached by
 * the owner, but an enemy that takes the tower takes the pawn with it. So a
 * garrison is a sheltered square, not a safe one.
 */
export function recruitSpots(state: ChessState, ctx: ChessCtx): number[] {
  const taken = new Set(state.pieces.map((p) => p.cell));
  return Object.entries(state.towers)
    .filter(([, side]) => side === state.turn)
    .map(([cell]) => Number(cell))
    .filter(
      (cell) =>
        !taken.has(cell) &&
        isDryLand(cell, state, ctx) &&
        state.rockets[String(cell)] === undefined,
    )
    .sort((a, b) => a - b);
}
