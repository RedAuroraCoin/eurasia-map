import { BALANCE } from '../balance';
import { hashString } from '../rng';
import { buildSpots, legalTargets, neighbours, recruitSpots, rocketCells, spotOf } from './moves';
import type {
  ChessCommand,
  ChessCtx,
  ChessErrorCode,
  ChessEvent,
  ChessState,
  Piece,
  PieceKind,
  Side,
  WinHow,
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
    rockets: {},
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
 * The sea level for a round.
 *
 * The tide is a clock, not a ramp: each round it takes an equal share of the
 * land, and the last cell goes under on `fullFloodRound`. Raising the level by a
 * fixed number of metres instead would drown half the board by move four and the
 * rest by move twelve — the game would end long before the 40-45 moves a chess
 * game actually takes.
 */
export function seaLevelForRound(round: number, ctx: ChessCtx): number {
  const full = BALANCE.chess.fullFloodRound;
  if (round <= 0) return BALANCE.flood.startLevel;
  if (round >= full) return BALANCE.flood.maxLevel;

  const levels: number[] = [];
  for (let cell = 0; cell < ctx.cellCount; cell++) {
    if (ctx.isLand(cell)) levels.push(ctx.elev[cell] ?? 0);
  }
  if (levels.length === 0) return BALANCE.flood.maxLevel;
  levels.sort((a, b) => a - b);

  // The share taken grows as the game goes on: the sea dawdles through the
  // opening and hurries once the board has been fought over.
  const taken = Math.pow(round / full, BALANCE.chess.floodExponent);
  const keep = Math.max(0, Math.floor((1 - taken) * levels.length));
  const drown = Math.min(levels.length - 1, levels.length - keep);
  return Math.min(BALANCE.flood.maxLevel, Math.round(levels[drown] as number));
}

/**
 * Ends the turn: swaps sides, and once both have moved, raises the sea and pays
 * the round's coins. Drowning is resolved here, so a piece can never stand in
 * water between turns.
 */
function endTurn(
  state: ChessState,
  ctx: ChessCtx,
  events: ChessEvent[],
  winner: { side: Side; how: WinHow } | null,
): ChessState {
  const turn: Side = state.turn === 0 ? 1 : 0;
  const round = turn === 0 ? state.round + 1 : state.round;

  let seaLevel = state.seaLevel;
  if (turn === 0) seaLevel = seaLevelForRound(round, ctx);

  const ground = (cell: number): number => ctx.elev[cell] ?? 0;
  const pieces = state.pieces.filter((piece) => ground(piece.cell) >= seaLevel);
  const towers: Record<string, Side> = {};
  for (const [cell, side] of Object.entries(state.towers)) {
    if (ground(Number(cell)) >= seaLevel) towers[cell] = side;
  }
  const rockets: Record<string, Side> = {};
  for (const [cell, side] of Object.entries(state.rockets)) {
    if (ground(Number(cell)) >= seaLevel) rockets[cell] = side;
  }

  // Income is paid once a round, and only for the towers that survived the tide:
  // a drowned tower stops earning, so the player has to build inland instead.
  const coins: [number, number] = [state.coins[0], state.coins[1]];
  if (turn === 0) {
    for (const side of [0, 1] as const) {
      const owned = Object.values(towers).filter((owner) => owner === side).length;
      coins[side] += BALANCE.chess.coinsPerRound + BALANCE.chess.towerIncome * owned;
    }
  }

  const drowned = state.pieces.length - pieces.length;
  // A structure is a structure: the report counts towers and rocket bases together.
  const towersLost =
    Object.keys(state.towers).length +
    Object.keys(state.rockets).length -
    Object.keys(towers).length -
    Object.keys(rockets).length;
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
    rockets,
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
    const rockets = { ...state.rockets };
    const rocketSide = state.rockets[String(cmd.to)];
    if (rocketSide !== undefined) {
      delete rockets[String(cmd.to)];
      events.push({ t: 'rocketTaken', cell: cmd.to, side: rocketSide });
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
        rockets,
        lastMove: { piece: piece.id, from: piece.cell, to: cmd.to },
      },
      ctx,
      events,
      win,
    );
    return { ok: true, state: next, events };
  }

  if (cmd.k === 'build') {
    const kind = cmd.kind ?? 'tower';
    const cost = kind === 'rocket' ? BALANCE.chess.rocketCost : BALANCE.chess.towerCost;
    if (state.coins[state.turn] < cost) return reject(state, 'no_coins');
    if (!buildSpots(state, ctx).includes(cmd.cell)) return reject(state, 'not_adjacent');

    const coins: [number, number] = [state.coins[0], state.coins[1]];
    coins[state.turn] -= cost;

    if (kind === 'rocket') {
      const rockets = { ...state.rockets, [String(cmd.cell)]: state.turn };
      events.push({ t: 'rocketBuilt', cell: cmd.cell, side: state.turn, cost });
      const next = endTurn({ ...state, rockets, coins }, ctx, events, null);
      return { ok: true, state: next, events };
    }

    const towers = { ...state.towers, [String(cmd.cell)]: state.turn };
    events.push({ t: 'built', cell: cmd.cell, side: state.turn, cost });

    const next = endTurn({ ...state, towers, coins }, ctx, events, null);
    return { ok: true, state: next, events };
  }

  if (cmd.k === 'fire') {
    const mine = rocketCells(state, state.turn);
    if (mine.length === 0) return reject(state, 'no_rocket');

    const centre = spotOf(cmd.cell, ctx.cols);
    const distance = (cell: number): number => {
      const spot = spotOf(cell, ctx.cols);
      return Math.max(Math.abs(spot.row - centre.row), Math.abs(spot.col - centre.col));
    };

    // The nearest base that can reach the zone does the firing; the range is
    // measured to the centre of the zone, not to the piece that may die in it.
    const from = mine
      .filter((cell) => distance(cell) <= BALANCE.chess.rocketRange)
      .sort((a, b) => distance(a) - distance(b) || a - b)[0];
    if (from === undefined) return reject(state, 'out_of_range');

    const target = pickTarget(state, cmd.cell, ctx);
    if (!target) return reject(state, 'no_target');

    // Dead centre is the good shot; the eight cells around it are a long shot.
    const chance =
      target.ring === 0 ? BALANCE.chess.rocketCentreChance : BALANCE.chess.rocketRingChance;
    const hit = rollFor(state, from, cmd.cell, target.piece.id) < chance;

    events.push({
      t: 'fired',
      side: state.turn,
      from,
      cell: cmd.cell,
      target: target.piece.id,
      kind: target.piece.kind,
      hit,
    });

    let pieces = state.pieces;
    let win: { side: Side; how: WinHow } | null = null;
    if (hit) {
      pieces = pieces.filter((piece) => piece.id !== target.piece.id);
      if (target.piece.kind === 'king') win = { side: state.turn, how: 'rocket' };
    }

    const next = endTurn({ ...state, pieces }, ctx, events, win);
    return { ok: true, state: next, events };
  }

  if (cmd.k === 'recruit') {
    const cost = BALANCE.chess.pawnCost;
    if (state.coins[state.turn] < cost) return reject(state, 'no_coins');
    if (state.towers[String(cmd.cell)] !== state.turn) return reject(state, 'no_tower');
    if (state.pieces.some((p) => p.cell === cmd.cell)) return reject(state, 'occupied');

    const pawn: Piece = {
      id: state.pieces.reduce((id, p) => Math.max(id, p.id), -1) + 1,
      side: state.turn,
      kind: 'pawn',
      cell: cmd.cell,
      promoted: false,
      // It did not walk here, so it gets no two-square opening.
      moved: true,
    };

    const coins: [number, number] = [state.coins[0], state.coins[1]];
    coins[state.turn] -= cost;
    events.push({ t: 'recruited', piece: pawn.id, cell: cmd.cell, side: state.turn, cost });

    const next = endTurn({ ...state, pieces: [...state.pieces, pawn], coins }, ctx, events, null);
    return { ok: true, state: next, events };
  }

  return reject(state, 'unknown');
}

/**
 * Who a shot lands on: the enemy nearest the centre of the zone, ties going to the
 * older piece. Deterministic on purpose — the engine may not consult a clock or a
 * random source, and a replay has to make the same choices.
 */
function pickTarget(
  state: ChessState,
  cell: number,
  ctx: ChessCtx,
): { piece: Piece; ring: number } | null {
  const centre = spotOf(cell, ctx.cols);
  let best: { piece: Piece; ring: number } | null = null;

  for (const piece of state.pieces) {
    if (piece.side === state.turn) continue;
    const spot = spotOf(piece.cell, ctx.cols);
    const dr = Math.abs(spot.row - centre.row);
    const dc = Math.abs(spot.col - centre.col);
    if (dr > 1 || dc > 1) continue;
    const ring = Math.max(dr, dc);
    if (!best || ring < best.ring || (ring === best.ring && piece.id < best.piece.id)) {
      best = { piece, ring };
    }
  }

  return best;
}

/**
 * The die for one shot, derived from the position instead of stored.
 *
 * The engine is a pure reducer: no clock, no Math.random. A hash of the seed, the
 * round, the side, the base, the zone and the target gives the same shot the same
 * result on a replay or in a save, and the round always moves on after a shot, so
 * two shots can never share a key.
 */
function rollFor(state: ChessState, from: number, cell: number, target: number): number {
  const key = `fire:${state.seed}:${state.round}:${state.turn}:${from}:${cell}:${target}`;
  return hashString(key) / 0x1_0000_0000;
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
  return [...moves, buildSpots(state, ctx), recruitSpots(state, ctx)];
}

export { neighbours };
