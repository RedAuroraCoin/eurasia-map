import { BALANCE } from '../balance';
import { buildSpots, legalTargets, neighbours, spotOf } from './moves';
import type {
  ChessCommand,
  ChessCtx,
  ChessErrorCode,
  ChessEvent,
  ChessState,
  Piece,
  PieceKind,
  Side,
} from './types';

/**
 * The rules of the turn-based mode.
 *
 * A turn is one action: move a piece, or let the king fortify instead of moving.
 * The sea rises once per full round — both sides having moved once — which is
 * what makes the mode a race rather than a stalemate.
 */

export const CHESS_VERSION = 1;

/** Setup order of the back rank, west to east. */
const BACK_RANK: readonly PieceKind[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

/** How many pieces a side fields. */
export const PIECES_PER_SIDE = BACK_RANK.length + 8;

/**
 * The camp: a chess formation, not a scatter.
 *
 * Eight files along the north-south axis and two ranks along the march axis: the
 * back rank behind, the pawns one column toward the enemy. A real coastline does
 * not offer many clean 2x8 patches, so the patch is chosen rather than assumed —
 * the highest ground inside the side's own latitude and longitude band.
 *
 * Ground that is merely dry is allowed: a pawn on a coastal lowland is a pawn
 * that drowns first, which is the mode working as intended. The score prefers
 * high cells, then the highest sum, so a camp sits on hills when it can.
 */
interface Camp {
  /** Eight cells of the back rank, north to south. */
  readonly backs: number[];
  /** The pawn in front of each of them, same order. */
  readonly pawns: number[];
}

const FILES = BACK_RANK.length;
/** Nothing camps below this: the sea starts at 0 and the first rounds are free. */
export const CAMP_FLOOR = 40;

function cellAt(row: number, col: number, ctx: ChessCtx): number | null {
  if (row < 0 || col < 0 || row >= ctx.rows || col >= ctx.cols) return null;
  return row * ctx.cols + col;
}

function findCamp(side: Side, ctx: ChessCtx, preferRow?: number): Camp | null {
  const step = side === 0 ? 1 : -1;
  const elevation = (cell: number): number => ctx.elev[cell] ?? 0;
  const usable = (cell: number): boolean => ctx.isLand(cell) && elevation(cell) >= CAMP_FLOOR;

  const rowBand = ctx.campRows?.[side] ?? null;
  const firstRow = rowBand ? Math.max(0, rowBand[0]) : 0;
  const lastRow = rowBand ? Math.min(ctx.rows - FILES, rowBand[1] - FILES + 1) : ctx.rows - FILES;

  const colBand = ctx.campCols?.[side] ?? null;
  // Without a band the two sides still must not land on each other: white keeps
  // to the western half, black to the eastern one.
  const half = Math.floor(ctx.cols / 2);
  const fallback: readonly [number, number] =
    side === 0 ? [0, Math.max(0, half - 1)] : [Math.min(half, ctx.cols - 2), ctx.cols - 2];
  const band: readonly [number, number] = colBand ?? fallback;
  const firstCol = Math.max(0, band[0]);
  const lastCol = Math.min(ctx.cols - 2, band[1]);

  let best: { camp: Camp; score: number } | null = null;

  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const backs: number[] = [];
      const pawns: number[] = [];
      let score = 0;
      let ok = true;

      for (let file = 0; file < FILES && ok; file++) {
        const back = cellAt(row + file, col, ctx);
        const pawn = cellAt(row + file, col + step, ctx);
        if (back === null || pawn === null || !usable(back) || !usable(pawn)) {
          ok = false;
          break;
        }
        // Land at the camping line counts far more than land a metre above it.
        const bonus = BALANCE.chess.campMinElevation;
        score += (elevation(back) >= bonus ? 1_000 : 0) + (elevation(pawn) >= bonus ? 1_000 : 0);
        score += Math.min(elevation(back), 400) + Math.min(elevation(pawn), 400);
        backs.push(back);
        pawns.push(pawn);
      }

      if (!ok) continue;
      // Facing ranks: a camp in the same rows as the other side's is worth more.
      if (preferRow !== undefined && row === preferRow) score += 500;
      if (!best || score > best.score) best = { camp: { backs, pawns }, score };
    }
  }

  return best ? best.camp : null;
}

/** The sixteen cells of a camp, back rank first. */
function campCells(camp: Camp): number[] {
  return [...camp.backs, ...camp.pawns];
}

/**
 * Builds the opening position. Deterministic, and it reads the mask rather than
 * assuming a rectangle, so a map with a broken coast still starts.
 */
export function createChessGame(
  size: 300 | 500 | 800,
  seed: number,
  ctx: ChessCtx,
  nowMs = 0,
): ChessState {
  void nowMs;
  const pieces: Piece[] = [];
  const homes: number[][] = [[], []];
  let id = 0;

  const whiteCamp = findCamp(0, ctx);
  const whiteRow = whiteCamp ? Math.floor((whiteCamp.backs[0] as number) / ctx.cols) : undefined;
  for (const side of [0, 1] as const) {
    const camp = side === 0 ? whiteCamp : findCamp(1, ctx, whiteRow);
    if (camp) {
      const cells = campCells(camp);
      homes[side] = cells;
      // Back rank first, then the pawns: the order the formation was built in.
      cells.forEach((cell, index) => {
        pieces.push({
          id: id++,
          side,
          kind: index < FILES ? (BACK_RANK[index] as PieceKind) : 'pawn',
          cell,
          promoted: false,
          moved: false,
        });
      });
      continue;
    }

    // No room for a formation: the nearest high ground, back rank behind.
    const cells = homeCells(side, ctx);
    homes[side] = cells;
    const sorted = [...cells].sort((a, b) => {
      const pa = spotOf(a, ctx.cols);
      const pb = spotOf(b, ctx.cols);
      const byColumn = side === 0 ? pa.col - pb.col : pb.col - pa.col;
      if (byColumn !== 0) return byColumn;
      return pa.row - pb.row;
    });
    sorted.slice(0, FILES).forEach((cell, index) => {
      pieces.push({
        id: id++,
        side,
        kind: BACK_RANK[index] as PieceKind,
        cell,
        promoted: false,
        moved: false,
      });
    });
    for (const cell of sorted.slice(FILES)) {
      pieces.push({ id: id++, side, kind: 'pawn', cell, promoted: false, moved: false });
    }
  }

  const start = BALANCE.chess.startCoins;
  return {
    v: CHESS_VERSION,
    seed,
    size,
    pieces,
    turn: 0,
    round: 0,
    seaLevel: BALANCE.flood.startLevel,
    towers: {},
    coins: [start, start],
    winner: null,
    lastMove: null,
  };
}

const reject = (
  state: ChessState,
  code: ChessErrorCode,
): { ok: false; code: ChessErrorCode; state: ChessState; events: ChessEvent[] } => ({
  ok: false,
  code,
  state,
  events: [{ t: 'rejected', code }],
});

/**
 * Ends the turn: swaps sides, and once both have moved, raises the sea and pays
 * the round's coins. Drowning is resolved here, so a piece can never stand in
 * water between turns.
 */
function endTurn(
  state: ChessState,
  ctx: ChessCtx,
  events: ChessEvent[],
  winner: { side: Side; how: 'king' | 'drowned' } | null,
): ChessState {
  const turn: Side = state.turn === 0 ? 1 : 0;
  const round = turn === 0 ? state.round + 1 : state.round;

  let seaLevel = state.seaLevel;
  let coins: [number, number] = [state.coins[0], state.coins[1]];
  if (turn === 0 && BALANCE.chess.metresPerRound > 0) {
    seaLevel = Math.min(BALANCE.flood.maxLevel, seaLevel + BALANCE.chess.metresPerRound);
    coins = [coins[0] + BALANCE.chess.coinsPerRound, coins[1] + BALANCE.chess.coinsPerRound];
  }

  const ground = (cell: number): number => ctx.elev[cell] ?? 0;
  const pieces = state.pieces.filter((piece) => ground(piece.cell) >= seaLevel);
  const towers: Record<string, Side> = {};
  for (const [cell, side] of Object.entries(state.towers)) {
    if (ground(Number(cell)) >= seaLevel) towers[cell] = side;
  }

  const drowned = state.pieces.length - pieces.length;
  const towersLost = Object.keys(state.towers).length - Object.keys(towers).length;
  if (drowned > 0 || towersLost > 0)
    events.push({ t: 'drowned', pieces: drowned, towers: towersLost });
  if (seaLevel !== state.seaLevel) events.push({ t: 'sea', level: seaLevel });

  // A king in the water is a lost game, the same as a king taken.
  let decided = winner;
  if (!decided) {
    for (const side of [0, 1] as const) {
      if (
        state.pieces.some((p) => p.side === side && p.kind === 'king') &&
        !pieces.some((p) => p.side === side && p.kind === 'king')
      ) {
        decided = { side: side === 0 ? 1 : 0, how: 'drowned' };
      }
    }
  }

  const next: ChessState = {
    ...state,
    turn,
    round,
    seaLevel,
    coins,
    pieces,
    towers,
    winner: decided ? decided.side : null,
  };

  events.push({ t: 'turn', side: turn, round });
  if (decided) events.push({ t: 'won', side: decided.side, how: decided.how });
  return next;
}

export function chessReduce(
  state: ChessState,
  cmd: ChessCommand,
  ctx: ChessCtx,
):
  | { ok: true; state: ChessState; events: ChessEvent[] }
  | { ok: false; code: ChessErrorCode; state: ChessState; events: ChessEvent[] } {
  if (state.winner !== null) return reject(state, 'over');
  const events: ChessEvent[] = [];

  if (cmd.k === 'move') {
    const piece = state.pieces.find((p) => p.id === cmd.piece);
    if (!piece) return reject(state, 'no_piece');
    if (piece.side !== state.turn) return reject(state, 'not_yours');

    const targets = legalTargets(state, piece, ctx);
    if (!targets.includes(cmd.to)) return reject(state, 'illegal');

    const victim = state.pieces.find((p) => p.cell === cmd.to);
    const towerSide = state.towers[String(cmd.to)];
    let remaining = state.pieces.filter((p) => p.id !== piece.id && p.id !== victim?.id);

    // Pawns that reach the enemy's home become queens: a pawn is too slow to be
    // useful by the time the sea has climbed that far.
    const homeOfEnemy = new Set(createHomeCells((1 - piece.side) as Side, ctx));
    const promote = piece.kind === 'pawn' && homeOfEnemy.has(cmd.to);
    const movedPiece: Piece = promote
      ? { ...piece, cell: cmd.to, kind: 'queen', promoted: true, moved: true }
      : { ...piece, cell: cmd.to, moved: true };
    remaining = [...remaining, movedPiece];

    const towers = { ...state.towers };
    if (towerSide !== undefined) {
      delete towers[String(cmd.to)];
      events.push({ t: 'towerTaken', cell: cmd.to, side: towerSide });
    }

    events.push({ t: 'moved', piece: piece.id, from: piece.cell, to: cmd.to });
    if (victim) events.push({ t: 'captured', piece: victim.id, kind: victim.kind, cell: cmd.to });
    if (promote) events.push({ t: 'promoted', piece: piece.id, cell: cmd.to });

    const win = victim?.kind === 'king' ? { side: piece.side, how: 'king' as const } : null;
    const next = endTurn(
      {
        ...state,
        pieces: remaining,
        towers,
        lastMove: { piece: piece.id, from: piece.cell, to: cmd.to },
      },
      ctx,
      events,
      win,
    );
    return { ok: true, state: next, events };
  }

  if (cmd.k === 'build') {
    const cost = BALANCE.chess.towerCost;
    if (state.coins[state.turn] < cost) return reject(state, 'no_coins');
    if (!buildSpots(state, ctx).includes(cmd.cell)) return reject(state, 'not_adjacent');

    const towers = { ...state.towers, [String(cmd.cell)]: state.turn };
    const coins: [number, number] = [state.coins[0], state.coins[1]];
    coins[state.turn] -= cost;
    events.push({ t: 'built', cell: cmd.cell, side: state.turn, cost });

    const next = endTurn({ ...state, towers, coins }, ctx, events, null);
    return { ok: true, state: next, events };
  }

  return reject(state, 'unknown');
}

/**
 * The cells a side started on. Recomputed from the mask rather than stored, so a
 * save stays small and a rule change cannot leave stale home squares behind.
 */
export function createHomeCells(side: Side, ctx: ChessCtx): number[] {
  const camp = findCamp(side, ctx);
  return camp ? campCells(camp) : homeCells(side, ctx);
}

/**
 * The army's camp: the land cells nearest its own edge that stand above the
 * camping line. Falling back to the plain coastline keeps small or mountainous
 * maps playable instead of refusing to start.
 */
function homeCells(side: Side, ctx: ChessCtx): number[] {
  const dry: number[] = [];
  const all: number[] = [];
  for (let cell = 0; cell < ctx.cellCount; cell++) {
    if (!ctx.isLand(cell)) continue;
    all.push(cell);
    if ((ctx.elev[cell] ?? 0) >= BALANCE.chess.campMinElevation) dry.push(cell);
  }
  const pool = dry.length >= PIECES_PER_SIDE ? dry : all;
  const sorted = [...pool].sort((a, b) => {
    const pa = spotOf(a, ctx.cols);
    const pb = spotOf(b, ctx.cols);
    const byColumn = side === 0 ? pa.col - pb.col : pb.col - pa.col;
    if (byColumn !== 0) return byColumn;
    return pa.row - pb.row;
  });
  return sorted.slice(0, PIECES_PER_SIDE);
}

/** Convenience for the UI: everything the side to move can do. */
export function availableMoves(state: ChessState, ctx: ChessCtx): number[][] {
  const mine = state.pieces.filter((p) => p.side === state.turn);
  const moves = mine.map((piece) => legalTargets(state, piece, ctx));
  return [...moves, buildSpots(state, ctx)];
}

export { neighbours };
