import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { getMap } from '../map';
import { buildSpots, legalTargets } from './moves';
import { PIECES_PER_SIDE, chessReduce, createChessGame } from './rules';
import type { ChessCtx, ChessState, Piece, PieceKind, Side } from './types';

/**
 * An 8x8 board of dry, flat land: chess rules are easier to read without the
 * coastline in the way. The real map gets its own tests at the end.
 */
const ctx8 = (elev: Record<number, number> = {}): ChessCtx => ({
  isLand: () => true,
  elev: Array.from({ length: 64 }, (_, cell) => elev[cell] ?? 1000),
  rows: 8,
  cols: 8,
  cellCount: 64,
});

const at = (row: number, col: number): number => row * 8 + col;

const piece = (id: number, side: Side, kind: PieceKind, cell: number): Piece => ({
  id,
  side,
  kind,
  cell,
  promoted: false,
});

const state = (pieces: Piece[], extra: Partial<ChessState> = {}): ChessState => ({
  v: 1,
  seed: 1,
  size: 300,
  pieces,
  turn: 0,
  round: 0,
  seaLevel: 0,
  towers: {},
  coins: [BALANCE.chess.startCoins, BALANCE.chess.startCoins],
  winner: null,
  lastMove: null,
  ...extra,
});

const targets = (s: ChessState, id: number, ctx = ctx8()): number[] => {
  const p = s.pieces.find((x) => x.id === id);
  if (!p) throw new Error(`no piece ${id}`);
  return legalTargets(s, p, ctx).sort((a, b) => a - b);
};

describe('the opening position', () => {
  const map = getMap(500);
  const ctx: ChessCtx = {
    isLand: (cell) => map.mask[cell] === '#',
    elev: map.elev,
    rows: map.rows,
    cols: map.cols,
    cellCount: map.rows * map.cols,
  };

  it('fields a full set for both sides, on land', () => {
    const game = createChessGame(500, 1, ctx);
    expect(game.pieces).toHaveLength(PIECES_PER_SIDE * 2);
    for (const side of [0, 1] as const) {
      const mine = game.pieces.filter((p) => p.side === side);
      expect(mine.filter((p) => p.kind === 'king')).toHaveLength(1);
      expect(mine.filter((p) => p.kind === 'queen')).toHaveLength(1);
      expect(mine.filter((p) => p.kind === 'rook')).toHaveLength(2);
      expect(mine.filter((p) => p.kind === 'bishop')).toHaveLength(2);
      expect(mine.filter((p) => p.kind === 'knight')).toHaveLength(2);
      expect(mine.filter((p) => p.kind === 'pawn')).toHaveLength(8);
      for (const p of mine) expect(ctx.isLand(p.cell)).toBe(true);
    }
  });

  it('puts the two armies on opposite edges, with pawns in front', () => {
    const game = createChessGame(500, 1, ctx);
    const col = (cell: number): number => cell % ctx.cols;
    const west = game.pieces.filter((p) => p.side === 0);
    const east = game.pieces.filter((p) => p.side === 1);
    const westPawns = west.filter((p) => p.kind === 'pawn').map((p) => col(p.cell));
    const westBack = west.filter((p) => p.kind !== 'pawn').map((p) => col(p.cell));
    const eastPawns = east.filter((p) => p.kind === 'pawn').map((p) => col(p.cell));
    const eastBack = east.filter((p) => p.kind !== 'pawn').map((p) => col(p.cell));

    expect(Math.max(...westBack)).toBeLessThanOrEqual(Math.min(...westPawns));
    expect(Math.min(...eastBack)).toBeGreaterThanOrEqual(Math.max(...eastPawns));
    expect(Math.max(...westPawns)).toBeLessThan(Math.min(...eastPawns));
  });

  it('lines up like a chess rank: eight files, two ranks, pawns in front', () => {
    const map800 = getMap(800);
    const big: ChessCtx = {
      isLand: (cell) => map800.mask[cell] === '#',
      elev: map800.elev,
      rows: map800.rows,
      cols: map800.cols,
      cellCount: map800.rows * map800.cols,
    };
    const game = createChessGame(800, 1, big);
    const col = (cell: number): number => cell % big.cols;
    const row = (cell: number): number => Math.floor(cell / big.cols);

    for (const side of [0, 1] as const) {
      const mine = game.pieces.filter((p) => p.side === side);
      const back = mine.filter((p) => p.kind !== 'pawn');
      const pawns = mine.filter((p) => p.kind === 'pawn');

      // One file for the back rank, one for the pawns.
      expect(new Set(back.map((p) => col(p.cell))).size).toBe(1);
      expect(new Set(pawns.map((p) => col(p.cell))).size).toBe(1);
      // Eight consecutive files.
      const rows = back.map((p) => row(p.cell)).sort((a, b) => a - b);
      expect(rows).toHaveLength(8);
      rows.forEach((value, index) => expect(value).toBe((rows[0] as number) + index));
      // Pawns stand on the same files, one column toward the enemy.
      expect(pawns.map((p) => row(p.cell)).sort((a, b) => a - b)).toEqual(rows);
      const step = side === 0 ? 1 : -1;
      for (const pawn of pawns) expect(col(pawn.cell)).toBe(col(back[0]!.cell) + step);
      // The order of the back rank, north to south.
      const order = rows.map((value) => back.find((p) => row(p.cell) === value)?.kind as PieceKind);
      expect(order).toEqual([
        'rook',
        'knight',
        'bishop',
        'queen',
        'king',
        'bishop',
        'knight',
        'rook',
      ]);
    }
  });

  it('camps above the camping line, so the first rise cannot take a piece', () => {
    const game = createChessGame(500, 1, ctx);
    for (const piece of game.pieces) {
      expect(ctx.elev[piece.cell] ?? 0).toBeGreaterThanOrEqual(BALANCE.chess.campMinElevation);
    }
  });

  it('starts with no towers, no winner and the sea at its starting level', () => {
    const game = createChessGame(500, 1, ctx);
    expect(game.towers).toEqual({});
    expect(game.winner).toBeNull();
    expect(game.seaLevel).toBe(BALANCE.flood.startLevel);
    expect(game.turn).toBe(0);
  });
});

describe('movement', () => {
  it('slides a rook along its row and column, and no further', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3))]);
    const cells = targets(s, 1);
    expect(cells).toHaveLength(14);
    expect(cells).toContain(at(3, 0));
    expect(cells).toContain(at(0, 3));
    expect(cells).not.toContain(at(4, 4));
  });

  it('stops a rook at its own piece and takes an enemy one', () => {
    const s = state([
      piece(1, 0, 'rook', at(3, 3)),
      piece(2, 0, 'pawn', at(3, 5)),
      piece(3, 1, 'pawn', at(3, 1)),
    ]);
    const cells = targets(s, 1);
    expect(cells).toContain(at(3, 4));
    expect(cells).not.toContain(at(3, 5));
    expect(cells).toContain(at(3, 1));
    expect(cells).not.toContain(at(3, 0));
  });

  it('moves a bishop on diagonals only', () => {
    const s = state([piece(1, 0, 'bishop', at(3, 3))]);
    const cells = targets(s, 1);
    expect(cells).toContain(at(0, 0));
    expect(cells).toContain(at(7, 7));
    expect(cells).not.toContain(at(3, 4));
  });

  it('lets a knight jump over a wall of pieces', () => {
    const wall = [
      piece(2, 0, 'pawn', at(2, 3)),
      piece(3, 0, 'pawn', at(3, 2)),
      piece(4, 0, 'pawn', at(4, 3)),
      piece(5, 0, 'pawn', at(3, 4)),
    ];
    const s = state([piece(1, 0, 'knight', at(3, 3)), ...wall]);
    const cells = targets(s, 1);
    expect(cells).toContain(at(1, 2));
    expect(cells).toContain(at(5, 4));
    expect(cells).toHaveLength(8);
  });

  it('gives the queen both, and the king a single step', () => {
    const queen = targets(state([piece(1, 0, 'queen', at(3, 3))]), 1);
    expect(queen).toHaveLength(27);
    const king = targets(state([piece(1, 0, 'king', at(3, 3))]), 1);
    expect(king.sort((a, b) => a - b)).toEqual(
      [at(2, 2), at(2, 3), at(2, 4), at(3, 2), at(3, 4), at(4, 2), at(4, 3), at(4, 4)].sort(
        (a, b) => a - b,
      ),
    );
  });

  it('marches a pawn east and takes only diagonally', () => {
    const s = state([
      piece(1, 0, 'pawn', at(3, 3)),
      piece(2, 1, 'pawn', at(2, 4)),
      piece(3, 1, 'pawn', at(3, 4)),
    ]);
    const cells = targets(s, 1);
    // Forward is blocked by the enemy pawn, so only the diagonal capture is left.
    expect(cells).toEqual([at(2, 4)]);
  });

  it('marches a side-1 pawn west', () => {
    const s = state([piece(1, 1, 'pawn', at(3, 3))], { turn: 1 });
    expect(targets(s, 1)).toEqual([at(3, 2)]);
  });

  it('treats water as a wall', () => {
    // Ground below the waterline: 50 m of land under a 100 m sea.
    const s = state([piece(1, 0, 'rook', at(3, 3))], { seaLevel: 100 });
    const ctx = ctx8({ [at(3, 4)]: 50 });
    const cells = targets(s, 1, ctx);
    expect(cells).not.toContain(at(3, 4));
    expect(cells).not.toContain(at(3, 5));
    expect(cells).toContain(at(3, 2));
  });

  it('blocks on its own tower and takes an enemy one', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3))], {
      towers: { [String(at(3, 5))]: 0, [String(at(3, 1))]: 1 },
    });
    const cells = targets(s, 1);
    expect(cells).not.toContain(at(3, 5));
    expect(cells).toContain(at(3, 1));
    expect(cells).not.toContain(at(3, 0));
  });
});

describe('turns and the sea', () => {
  it('alternates sides and raises the sea once per full round', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3)), piece(2, 1, 'rook', at(4, 4))]);
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx8());
    expect(first.ok).toBe(true);
    expect(first.state.turn).toBe(1);
    expect(first.state.round).toBe(0);
    expect(first.state.seaLevel).toBe(BALANCE.flood.startLevel);

    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx8());
    expect(second.state.turn).toBe(0);
    expect(second.state.round).toBe(1);
    expect(second.state.seaLevel).toBe(BALANCE.flood.startLevel + BALANCE.chess.metresPerRound);
  });

  it('pays both sides at the end of a round', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3)), piece(2, 1, 'rook', at(4, 4))]);
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx8());
    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx8());
    expect(second.state.coins).toEqual([
      BALANCE.chess.startCoins + BALANCE.chess.coinsPerRound,
      BALANCE.chess.startCoins + BALANCE.chess.coinsPerRound,
    ]);
  });

  it('drowns a piece the sea has reached, and reports it', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3)), piece(2, 1, 'rook', at(4, 4))]);
    // The rook walks onto 10 m of ground; the round's rise puts the sea at 25 m.
    const ctx = ctx8({ [at(3, 4)]: 10 });
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx);
    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx);

    expect(second.state.pieces.map((p) => p.id)).toEqual([2]);
    expect(second.events.find((e) => e.t === 'drowned')).toMatchObject({ pieces: 1 });
  });

  it('loses the game when the king drowns', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'rook', at(4, 4))]);
    const ctx = ctx8({ [at(3, 4)]: 10 });
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx);
    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx);

    expect(second.state.winner).toBe(1);
    expect(second.events.find((e) => e.t === 'won')).toMatchObject({ side: 1, how: 'drowned' });
  });
});

describe('the king builds instead of moving', () => {
  it('builds a tower next to the king, pays for it and passes the turn', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))]);
    const spots = buildSpots(s, ctx8());
    expect(spots).toContain(at(3, 4));

    const result = chessReduce(s, { k: 'build', cell: at(3, 4) }, ctx8());
    expect(result.ok).toBe(true);
    expect(result.state.towers[String(at(3, 4))]).toBe(0);
    expect(result.state.coins[0]).toBe(BALANCE.chess.startCoins - BALANCE.chess.towerCost);
    expect(result.state.turn).toBe(1);
  });

  it('refuses a tower away from the king', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))]);
    const result = chessReduce(s, { k: 'build', cell: at(0, 0) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_adjacent');
  });

  it('refuses a tower without coins', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [0, 0],
    });
    const result = chessReduce(s, { k: 'build', cell: at(3, 4) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_coins');
  });

  it('will not build on a cell that is already taken', () => {
    const s = state([
      piece(1, 0, 'king', at(3, 3)),
      piece(2, 0, 'pawn', at(3, 4)),
      piece(3, 1, 'king', at(7, 7)),
    ]);
    expect(buildSpots(s, ctx8())).not.toContain(at(3, 4));
  });
});

describe('winning and refusing', () => {
  it('wins by taking the king', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3)), piece(2, 1, 'king', at(3, 6))]);
    const result = chessReduce(s, { k: 'move', piece: 1, to: at(3, 6) }, ctx8());
    expect(result.ok).toBe(true);
    expect(result.state.winner).toBe(0);
    expect(result.events.find((e) => e.t === 'won')).toMatchObject({ side: 0, how: 'king' });
  });

  it('refuses a move by the side that is not to move', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3)), piece(2, 1, 'rook', at(4, 4))], { turn: 1 });
    const result = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_yours');
  });

  it('refuses an illegal destination and leaves the state alone', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3))]);
    const result = chessReduce(s, { k: 'move', piece: 1, to: at(4, 4) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('illegal');
    expect(result.state).toBe(s);
  });

  it('refuses anything once the game is decided', () => {
    const s = state([piece(1, 0, 'rook', at(3, 3))], { winner: 0 });
    const result = chessReduce(s, { k: 'move', piece: 1, to: at(3, 4) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('over');
  });
});
