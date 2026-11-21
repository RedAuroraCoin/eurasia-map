import {
  CHESS_VERSION,
  chessReduce,
  createChessGame,
  getMap,
  seaLevelForRound,
  type ChessCtx,
  type ChessState,
} from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import {
  CHESS_SAVE_KEY,
  clearChessGame,
  loadChessGame,
  parseChess,
  saveChessGame,
} from './chess-save';
import type { StorageLike } from './save';

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const map = getMap(800);
const ctx: ChessCtx = {
  isLand: (cell) => map.mask[cell] === '#',
  elev: map.elev,
  rows: map.rows,
  cols: map.cols,
  cellCount: map.rows * map.cols,
};

const fresh = (): ChessState => createChessGame(800, 7, ctx);

/** A game that has actually been played a little. */
function playedGame(): ChessState {
  let state = fresh();
  const pawn = state.pieces.find((p) => p.side === 0 && p.kind === 'pawn');
  if (!pawn) throw new Error('no pawn');
  const moved = chessReduce(state, { k: 'move', piece: pawn.id, to: pawn.cell + 2 }, ctx);
  if (!moved.ok) throw new Error(`could not move: ${moved.code}`);
  state = moved.state;
  const enemy = state.pieces.find((p) => p.side === 1 && p.kind === 'pawn');
  if (!enemy) throw new Error('no enemy pawn');
  const reply = chessReduce(state, { k: 'move', piece: enemy.id, to: enemy.cell - 1 }, ctx);
  return reply.ok ? reply.state : state;
}

describe('saving the chess game', () => {
  it('round-trips a game in progress', () => {
    const storage = new MemoryStorage();
    const state = playedGame();
    saveChessGame(storage, state, 1_700_000_000_000);

    const loaded = loadChessGame(storage, ctx);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.savedAt).toBe(1_700_000_000_000);
    expect(loaded.state.pieces).toHaveLength(state.pieces.length);
    expect(loaded.state.turn).toBe(state.turn);
    expect(loaded.state.round).toBe(state.round);
    expect(loaded.state.coins).toEqual(state.coins);
    expect(loaded.state.pieces.map((p) => [p.id, p.cell, p.moved])).toEqual(
      state.pieces.map((p) => [p.id, p.cell, p.moved]),
    );
  });

  it('says so when there is nothing saved', () => {
    expect(loadChessGame(new MemoryStorage(), ctx)).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses a file it cannot read instead of guessing', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHESS_SAVE_KEY, '{not json');
    expect(loadChessGame(storage, ctx)).toEqual({ ok: false, reason: 'corrupt' });

    storage.setItem(CHESS_SAVE_KEY, JSON.stringify({ v: CHESS_VERSION, state: { pieces: 5 } }));
    expect(loadChessGame(storage, ctx)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses a save from a newer version', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CHESS_SAVE_KEY,
      JSON.stringify({ v: CHESS_VERSION + 1, savedAt: 0, state: fresh() }),
    );
    expect(loadChessGame(storage, ctx)).toEqual({ ok: false, reason: 'newer' });
  });

  it('does not resume a game that is already decided', () => {
    const storage = new MemoryStorage();
    saveChessGame(storage, { ...fresh(), winner: 0 });
    expect(loadChessGame(storage, ctx)).toEqual({ ok: false, reason: 'over' });
  });

  it('refuses pieces on water, on one cell, or a side without a king', () => {
    const state = fresh();
    const piece = state.pieces[0]!;
    const sea = [...map.mask].findIndex((c) => c === '.');

    expect(parseChess({ ...state, pieces: [{ ...piece, cell: sea }] }, ctx)).toBeNull();
    expect(
      parseChess({ ...state, pieces: [piece, { ...state.pieces[1], cell: piece.cell }] }, ctx),
    ).toBeNull();
    expect(
      parseChess({ ...state, pieces: state.pieces.filter((p) => p.kind !== 'king') }, ctx),
    ).toBeNull();
  });

  it('derives the sea level from the round, not from the file', () => {
    const state = { ...fresh(), round: 50 };
    const parsed = parseChess({ ...state, seaLevel: 9999 }, ctx);
    expect(parsed?.seaLevel).toBe(seaLevelForRound(50, ctx));
    expect(parsed?.seaLevel).not.toBe(9999);
  });

  it('clears the save', () => {
    const storage = new MemoryStorage();
    saveChessGame(storage, fresh());
    clearChessGame(storage);
    expect(loadChessGame(storage, ctx)).toEqual({ ok: false, reason: 'empty' });
  });
});
