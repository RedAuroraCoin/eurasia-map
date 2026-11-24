import {
  CHESS_VERSION,
  seaLevelForRound,
  type ChessCtx,
  type ChessState,
  type Piece,
  type PieceKind,
  type RegionId,
  type Side,
} from '@eurasia/shared';
import type { StorageLike } from './save';

/**
 * The chess game, saved the same way the city is: one envelope, a version inside
 * it, and structural validation on the way back in. A hot-seat game lives on one
 * device, so `localStorage` is the right home for it — no server, no account, and
 * it works on the static build.
 *
 * The sea level is not trusted from the file: it is derived from the round, so a
 * save made before a balance change still loads onto a board whose water is
 * where the rules now say it should be.
 */

export const CHESS_SAVE_KEY = 'eurasia.chess';

/**
 * One chess game per region, same rule as the city save: the original map keeps
 * its key so an existing game is still found, the new one gets its own.
 */
export const chessSaveKey = (region: RegionId = 'eurasia'): string =>
  region === 'eurasia' ? CHESS_SAVE_KEY : `${CHESS_SAVE_KEY}.${region}`;

const KINDS: readonly PieceKind[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export type ChessLoadResult =
  | { readonly ok: true; readonly state: ChessState; readonly savedAt: number }
  | { readonly ok: false; readonly reason: 'empty' | 'corrupt' | 'newer' | 'over' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isSide = (value: unknown): value is Side => value === 0 || value === 1;

function parsePiece(raw: unknown, ctx: ChessCtx, used: Set<number>): Piece | null {
  if (!isRecord(raw)) return null;
  const { id, side, kind, cell, moved, promoted } = raw;
  if (!isNumber(id) || !Number.isInteger(id) || used.has(id)) return null;
  if (!isSide(side)) return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind as PieceKind)) return null;
  if (!isNumber(cell) || !Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) return null;
  if (!ctx.isLand(cell)) return null;
  used.add(id);
  return {
    id,
    side,
    kind: kind as PieceKind,
    cell,
    promoted: promoted === true,
    moved: moved === true,
  };
}

/** Validates a saved game against the live board, or says why it cannot load. */
export function parseChess(raw: unknown, ctx: ChessCtx): ChessState | null {
  if (!isRecord(raw)) return null;
  const { seed, pieces, turn, round, towers, rockets, coins, winner, lastMove } = raw;
  if (!isNumber(seed) || !Number.isInteger(seed)) return null;
  if (!isSide(turn)) return null;
  if (!isNumber(round) || !Number.isInteger(round) || round < 0) return null;
  if (winner !== null && !isSide(winner)) return null;
  // 32 is the opening; recruiting pawns into towers adds more, so the guard is a
  // sanity limit rather than the number of starting pieces.
  if (!Array.isArray(pieces) || pieces.length > 64) return null;
  if (!Array.isArray(coins) || coins.length !== 2 || !coins.every((c) => isNumber(c) && c >= 0)) {
    return null;
  }

  const used = new Set<number>();
  const parsed: Piece[] = [];
  const occupied = new Set<number>();
  for (const entry of pieces) {
    const piece = parsePiece(entry, ctx, used);
    if (!piece) return null;
    // Two pieces on one cell means the file was edited or corrupted.
    if (occupied.has(piece.cell)) return null;
    occupied.add(piece.cell);
    parsed.push(piece);
  }
  for (const side of [0, 1] as const) {
    if (parsed.filter((p) => p.side === side && p.kind === 'king').length !== 1) return null;
  }

  const towerMap: Record<string, Side> = {};
  if (towers !== undefined) {
    if (!isRecord(towers)) return null;
    for (const [key, value] of Object.entries(towers)) {
      const cell = Number(key);
      if (!Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) return null;
      if (!ctx.isLand(cell) || !isSide(value)) return null;
      // A tower may hold a pawn: that is what recruiting one does.
      towerMap[key] = value;
    }
  }

  // Rockets arrived after the first saves, so a file without them is not corrupt:
  // it is a game that had no rocket bases.
  const rocketMap: Record<string, Side> = {};
  if (rockets !== undefined) {
    if (!isRecord(rockets)) return null;
    for (const [key, value] of Object.entries(rockets)) {
      const cell = Number(key);
      if (!Number.isInteger(cell) || cell < 0 || cell >= ctx.cellCount) return null;
      if (!ctx.isLand(cell) || !isSide(value)) return null;
      rocketMap[key] = value;
    }
  }

  let last: ChessState['lastMove'] = null;
  if (isRecord(lastMove)) {
    const { piece, from, to } = lastMove;
    if (isNumber(piece) && isNumber(from) && isNumber(to)) last = { piece, from, to };
  }

  return {
    v: CHESS_VERSION,
    seed,
    size: 800,
    pieces: parsed,
    turn,
    round,
    seaLevel: seaLevelForRound(round, ctx),
    towers: towerMap,
    rockets: rocketMap,
    coins: [Math.floor(coins[0] as number), Math.floor(coins[1] as number)],
    winner: winner === null ? null : (winner as Side),
    lastMove: last,
  };
}

export function loadChessGame(
  storage: StorageLike,
  ctx: ChessCtx,
  region: RegionId = 'eurasia',
): ChessLoadResult {
  let text: string | null = null;
  try {
    text = storage.getItem(chessSaveKey(region));
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!text) return { ok: false, reason: 'empty' };

  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isRecord(envelope)) return { ok: false, reason: 'corrupt' };

  const savedAt = isNumber(envelope.savedAt) ? envelope.savedAt : 0;
  const version = envelope.v;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'corrupt' };
  }
  if (version > CHESS_VERSION) return { ok: false, reason: 'newer' };

  const state = parseChess(envelope.state, ctx);
  if (!state) return { ok: false, reason: 'corrupt' };
  // A finished game is a result, not something to resume.
  if (state.winner !== null) return { ok: false, reason: 'over' };
  return { ok: true, state, savedAt };
}

export function saveChessGame(
  storage: StorageLike,
  state: ChessState,
  now = Date.now(),
  region: RegionId = 'eurasia',
): void {
  try {
    storage.setItem(
      chessSaveKey(region),
      JSON.stringify({ v: CHESS_VERSION, savedAt: now, state }),
    );
  } catch {
    // Private mode or a full quota: the game keeps working, unsaved.
  }
}

/** Copies a save we refused to load, before a new game overwrites it. */
export function backupChessGame(
  storage: StorageLike,
  now = Date.now(),
  region: RegionId = 'eurasia',
): boolean {
  try {
    const raw = storage.getItem(chessSaveKey(region));
    if (!raw) return false;
    storage.setItem(`${chessSaveKey(region)}.backup.${now}`, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearChessGame(storage: StorageLike, region: RegionId = 'eurasia'): void {
  try {
    storage.removeItem(chessSaveKey(region));
  } catch {
    // nothing to do
  }
}
