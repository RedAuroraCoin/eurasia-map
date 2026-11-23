import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { MAP_CONFIG } from '../map';
import { getMap } from '../map';
import { buildSpots, legalTargets } from './moves';
import {
  CAMP_FLOOR,
  PIECES_PER_SIDE,
  chessReduce,
  createChessGame,
  seaLevelForRound,
} from './rules';
import type { ChessCtx, ChessState, Piece, PieceKind, Side } from './types';

/**
 * An 8x8 board of dry, flat land: chess rules are easier to read without the
 * coastline in the way. The real map gets its own tests at the end.
 */
const ctx8 = (elev: Record<number, number> = {}): ChessCtx => ({
  isLand: () => true,
  // A slope, so the tide has something to climb: cell 0 is the lowest ground.
  elev: Array.from({ length: 64 }, (_, cell) => elev[cell] ?? 150 + cell * 10),
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
  moved: false,
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
  rockets: {},
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

  it('camps white in Europe and black in East Asia', () => {
    const map800 = getMap(800);
    const { lon0, lon1, lat0, lat1 } = MAP_CONFIG.bbox;
    const big: ChessCtx = {
      isLand: (cell) => map800.mask[cell] === '#',
      elev: map800.elev,
      rows: map800.rows,
      cols: map800.cols,
      cellCount: map800.rows * map800.cols,
      campRows: [
        [
          Math.round(((lat1 - BALANCE.chess.campLat.white[1]) / (lat1 - lat0)) * (map800.rows - 1)),
          Math.round(((lat1 - BALANCE.chess.campLat.white[0]) / (lat1 - lat0)) * (map800.rows - 1)),
        ],
        [
          Math.round(((lat1 - BALANCE.chess.campLat.black[1]) / (lat1 - lat0)) * (map800.rows - 1)),
          Math.round(((lat1 - BALANCE.chess.campLat.black[0]) / (lat1 - lat0)) * (map800.rows - 1)),
        ],
      ],
      campCols: [
        [
          Math.round(((BALANCE.chess.campLon.white[0] - lon0) / (lon1 - lon0)) * (map800.cols - 1)),
          Math.round(((BALANCE.chess.campLon.white[1] - lon0) / (lon1 - lon0)) * (map800.cols - 1)),
        ],
        [
          Math.round(((BALANCE.chess.campLon.black[0] - lon0) / (lon1 - lon0)) * (map800.cols - 1)),
          Math.round(((BALANCE.chess.campLon.black[1] - lon0) / (lon1 - lon0)) * (map800.cols - 1)),
        ],
      ],
    };
    const game = createChessGame(800, 1, big);
    const degrees = (cell: number): { lon: number; lat: number } => {
      const row = Math.floor(cell / big.cols);
      const col = cell % big.cols;
      return {
        lon: lon0 + (col / (big.cols - 1)) * (lon1 - lon0),
        lat: lat1 - (row / (big.rows - 1)) * (lat1 - lat0),
      };
    };

    for (const piece of game.pieces) {
      const { lon, lat } = degrees(piece.cell);
      const band = piece.side === 0 ? BALANCE.chess.campLon.white : BALANCE.chess.campLon.black;
      const latBand = piece.side === 0 ? BALANCE.chess.campLat.white : BALANCE.chess.campLat.black;
      // Two cells of slack: the bands become whole rows and columns, and a pawn
      // stands one column outside its own band, toward the enemy.
      expect(lon).toBeGreaterThanOrEqual(band[0] - 12);
      expect(lon).toBeLessThanOrEqual(band[1] + 12);
      expect(lat).toBeGreaterThanOrEqual(latBand[0] - 6);
      expect(lat).toBeLessThanOrEqual(latBand[1] + 6);
    }
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

  it('camps on dry ground that the first rounds of sea cannot reach', () => {
    const game = createChessGame(500, 1, ctx);
    for (const piece of game.pieces) {
      expect(ctx.elev[piece.cell] ?? 0).toBeGreaterThanOrEqual(CAMP_FLOOR);
      // And no camp may drown in the opening: the sea is still below it.
      expect(ctx.elev[piece.cell] ?? 0).toBeGreaterThan(BALANCE.flood.startLevel);
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

describe('the long vectors', () => {
  /** A big empty board, so the range limit is what decides, not the edge. */
  const empty20: ChessCtx = {
    isLand: () => true,
    elev: Array.from({ length: 400 }, () => 1000),
    rows: 20,
    cols: 20,
    cellCount: 400,
  };

  it('caps a rook, a bishop and a queen at seven squares a direction', () => {
    const centre = 10 * 20 + 10;
    const rook = piece(1, 0, 'rook', centre);
    const bishop = piece(2, 0, 'bishop', centre);
    const queen = piece(3, 0, 'queen', centre);
    const s = state([rook, bishop, queen]);

    // 4 directions x 7, 4 diagonals x 7, and 8 x 7.
    expect(legalTargets(s, rook, empty20)).toHaveLength(28);
    expect(legalTargets(s, bishop, empty20)).toHaveLength(28);
    expect(legalTargets(s, queen, empty20)).toHaveLength(56);
  });

  it('still stops at the edge of a small board before its limit', () => {
    const rook = piece(1, 0, 'rook', at(0, 0));
    expect(legalTargets(state([rook]), rook, ctx8())).toHaveLength(14);
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

  it('walks a pawn in any direction but takes only on the diagonals', () => {
    const s = state([
      piece(1, 0, 'pawn', at(3, 3)),
      piece(2, 1, 'pawn', at(2, 4)),
      piece(3, 1, 'pawn', at(3, 4)),
    ]);
    const cells = targets(s, 1);
    // Every free straight line is open for one and two squares; straight ahead is
    // blocked by an enemy it may not take, and the diagonal enemy is the capture.
    expect(cells).toEqual([at(1, 3), at(2, 3), at(2, 4), at(3, 1), at(3, 2), at(4, 3), at(5, 3)]);
  });

  it('cannot take a piece standing straight ahead', () => {
    const s = state([piece(1, 0, 'pawn', at(3, 3)), piece(2, 1, 'rook', at(4, 3))]);
    expect(targets(s, 1)).not.toContain(at(4, 3));
  });

  it('walks two squares in a straight line, in any of the four directions', () => {
    const cells = targets(state([piece(1, 0, 'pawn', at(3, 3))]), 1);
    expect(cells).toContain(at(3, 5));
    expect(cells).toContain(at(3, 1));
    expect(cells).toContain(at(5, 3));
    expect(cells).toContain(at(1, 3));
    // Two squares diagonally is not a straight line, so it is not a walk.
    expect(cells).not.toContain(at(5, 5));
  });

  it('walks two squares whether or not it has moved before', () => {
    const moved: Piece = { ...piece(1, 0, 'pawn', at(3, 3)), moved: true };
    const cells = targets(state([moved]), 1);
    expect(cells).toContain(at(3, 4));
    expect(cells).toContain(at(3, 5));
    expect(cells).toContain(at(3, 1));
  });

  it('will not jump two squares over a piece', () => {
    const s = state([piece(1, 0, 'pawn', at(3, 3)), piece(2, 0, 'rook', at(3, 4))]);
    const cells = targets(s, 1);
    expect(cells).not.toContain(at(3, 5));
    // Its own piece blocks the square itself too.
    expect(cells).not.toContain(at(3, 4));
  });

  it('will not walk two squares over water', () => {
    const s = state([piece(1, 0, 'pawn', at(3, 3))], { seaLevel: 100 });
    const ctx = ctx8({ [at(3, 5)]: 50 });
    const cells = targets(s, 1, ctx);
    expect(cells).toContain(at(3, 4));
    expect(cells).not.toContain(at(3, 5));
  });

  it('still records that a pawn has moved, though it no longer limits it', () => {
    const s = state([piece(1, 0, 'pawn', at(3, 3)), piece(2, 1, 'king', at(7, 7))]);
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(3, 5) }, ctx8());
    expect(first.ok).toBe(true);
    const after = first.state.pieces.find((p) => p.id === 1);
    expect(after?.cell).toBe(at(3, 5));
    expect(after?.moved).toBe(true);
    // And the next walk may still be two squares.
    if (!after) throw new Error('no pawn');
    expect(targets(first.state, after.id)).toContain(at(3, 7));
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

describe('the tide is a clock', () => {
  const map800 = getMap(800);
  const big: ChessCtx = {
    isLand: (cell) => map800.mask[cell] === '#',
    elev: map800.elev,
    rows: map800.rows,
    cols: map800.cols,
    cellCount: map800.rows * map800.cols,
  };
  const land = [...map800.mask].filter((c) => c === '#').length;
  const above = (level: number): number =>
    [...map800.mask].filter((c, i) => c === '#' && (map800.elev[i] ?? 0) >= level).length;

  it('starts at the ocean and covers the last cell on the final round', () => {
    expect(seaLevelForRound(0, big)).toBe(BALANCE.flood.startLevel);
    expect(seaLevelForRound(BALANCE.chess.fullFloodRound, big)).toBe(BALANCE.flood.maxLevel);
    expect(seaLevelForRound(BALANCE.chess.fullFloodRound + 10, big)).toBe(BALANCE.flood.maxLevel);
  });

  it('never goes backwards', () => {
    let previous = -1;
    for (let round = 0; round <= BALANCE.chess.fullFloodRound; round++) {
      const level = seaLevelForRound(round, big);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('holds the water back early and hurries it in late', () => {
    const share = (fraction: number): number => {
      const round = Math.round(BALANCE.chess.fullFloodRound * fraction);
      return above(seaLevelForRound(round, big)) / land;
    };

    // A tenth of the way in the sea has barely moved: 1% of the land.
    expect(share(0.1)).toBeGreaterThan(0.95);
    // Halfway, three quarters of the board is still dry — the opening and the
    // middlegame are not a countdown.
    expect(share(0.5)).toBeGreaterThan(0.65);
    expect(share(0.5)).toBeLessThan(0.85);
    // The last stretch is where it bites.
    expect(share(0.9)).toBeLessThan(0.25);
    expect(share(0.98)).toBeLessThan(0.05);
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
    expect(second.state.seaLevel).toBe(seaLevelForRound(1, ctx8()));
    expect(second.state.seaLevel).toBeGreaterThan(BALANCE.flood.startLevel);
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
    // Cell 0 is the lowest ground on the slope, and the first round takes it.
    const s = state([piece(1, 0, 'rook', at(0, 1)), piece(2, 1, 'rook', at(4, 4))]);
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(0, 0) }, ctx8());
    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx8());

    expect(second.state.pieces.map((p) => p.id)).toEqual([2]);
    expect(second.events.find((e) => e.t === 'drowned')).toMatchObject({ pieces: 1 });
  });

  it('loses the game when the king drowns', () => {
    const s = state([piece(1, 0, 'king', at(0, 1)), piece(2, 1, 'rook', at(4, 4))]);
    const first = chessReduce(s, { k: 'move', piece: 1, to: at(0, 0) }, ctx8());
    const second = chessReduce(first.state, { k: 'move', piece: 2, to: at(4, 5) }, ctx8());

    expect(second.state.winner).toBe(1);
    expect(second.events.find((e) => e.t === 'won')).toMatchObject({ side: 1, how: 'drowned' });
  });
});

describe('the king builds instead of moving', () => {
  it('builds a tower next to the king, pays for it and passes the turn', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.towerCost, BALANCE.chess.towerCost],
    });
    const spots = buildSpots(s, ctx8());
    expect(spots).toContain(at(3, 4));

    const result = chessReduce(s, { k: 'build', cell: at(3, 4) }, ctx8());
    expect(result.ok).toBe(true);
    expect(result.state.towers[String(at(3, 4))]).toBe(0);
    expect(result.state.coins[0]).toBe(0);
    expect(result.state.turn).toBe(1);
  });

  it('refuses a tower away from the king', () => {
    // Funded, so the refusal is about the cell and not the wallet.
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.towerCost, BALANCE.chess.towerCost],
    });
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

describe('towers pay their owner', () => {
  it('pays the base rate plus ten for every tower when the round closes', () => {
    const s = state(
      [piece(1, 0, 'king', at(0, 0)), piece(2, 1, 'king', at(7, 7)), piece(3, 1, 'rook', at(6, 6))],
      {
        turn: 1,
        coins: [0, 0],
        towers: { [String(at(5, 5))]: 0, [String(at(5, 6))]: 0, [String(at(6, 5))]: 1 },
      },
    );

    const result = chessReduce(s, { k: 'move', piece: 3, to: at(6, 7) }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.round).toBe(1);
    expect(result.state.coins[0]).toBe(BALANCE.chess.coinsPerRound + 2 * BALANCE.chess.towerIncome);
    expect(result.state.coins[1]).toBe(BALANCE.chess.coinsPerRound + BALANCE.chess.towerIncome);
  });

  it('stops paying for a tower the sea has taken', () => {
    // Cell 0 is the lowest ground on this board, and round 101 drowns it.
    const low = at(0, 0);
    const s = state(
      [piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7)), piece(3, 1, 'rook', at(6, 6))],
      {
        turn: 1,
        round: 100,
        coins: [0, 0],
        towers: { [String(low)]: 0 },
      },
    );

    const result = chessReduce(s, { k: 'move', piece: 3, to: at(6, 7) }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.towers[String(low)]).toBeUndefined();
    // Base rate only: the drowned tower earns nothing.
    expect(result.state.coins[0]).toBe(BALANCE.chess.coinsPerRound);
  });
});

describe('the rocket base', () => {
  /**
   * A board with a white rocket at (3,3) and one black piece to shoot at. The black
   * king sits at (7,0), well outside any zone these tests aim at, so the rook is
   * the piece the shot lands on.
   */
  const board = (seed: number, target: number, extra: Partial<ChessState> = {}): ChessState =>
    state(
      [piece(1, 0, 'king', at(0, 0)), piece(2, 1, 'king', at(7, 0)), piece(3, 1, 'rook', target)],
      {
        seed,
        turn: 0,
        coins: [500, 500],
        rockets: { [String(at(3, 3))]: 0 },
        ...extra,
      },
    );

  /** How many of `trials` seeds kill the piece standing on `target`. */
  const hits = (target: number, zone: number, trials = 200): number => {
    let killed = 0;
    for (let seed = 1; seed <= trials; seed++) {
      const result = chessReduce(board(seed, target), { k: 'fire', cell: zone }, ctx8());
      if (result.ok && !result.state.pieces.some((piece) => piece.id === 3)) killed++;
    }
    return killed;
  };

  it('is built for fifty coins and blocks like a tower', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.rocketCost, 0],
    });
    const result = chessReduce(s, { k: 'build', cell: at(3, 4), kind: 'rocket' }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rockets[String(at(3, 4))]).toBe(0);
    expect(result.state.towers[String(at(3, 4))]).toBeUndefined();
    expect(result.state.coins[0]).toBe(0);
    expect(result.state.turn).toBe(1);
  });

  it('refuses to fire without a base, out of range, or at an empty zone', () => {
    const noBase = chessReduce(
      state([piece(1, 0, 'king', at(0, 0)), piece(2, 1, 'rook', at(4, 4))], { coins: [500, 0] }),
      { k: 'fire', cell: at(4, 4) },
      ctx8(),
    );
    expect(noBase.ok).toBe(false);
    if (!noBase.ok) expect(noBase.code).toBe('no_rocket');

    // A zone with no piece in it — either side — is not a shot.
    const empty = chessReduce(board(1, at(7, 5)), { k: 'fire', cell: at(4, 3) }, ctx8());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('no_target');
  });

  it('cannot reach past its range of seven', () => {
    // An 8x8 board is only seven cells across from a corner, so the range needs a
    // wider board to be exceeded at all.
    const ctx12: ChessCtx = {
      isLand: () => true,
      elev: Array.from({ length: 144 }, (_, cell) => 150 + cell * 5),
      rows: 12,
      cols: 12,
      cellCount: 144,
    };
    const at12 = (row: number, col: number): number => row * 12 + col;
    const s = state(
      [
        piece(1, 0, 'king', at12(0, 0)),
        piece(2, 1, 'king', at12(11, 11)),
        piece(3, 1, 'rook', at12(0, 8)),
      ],
      { turn: 0, coins: [500, 500], rockets: { [String(at12(0, 0))]: 0 } },
    );

    // Nine cells from the base: out of reach.
    const tooFar = chessReduce(s, { k: 'fire', cell: at12(0, 9) }, ctx12);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.code).toBe('out_of_range');

    // Seven cells: the same board, in range.
    const inRange = chessReduce(s, { k: 'fire', cell: at12(0, 7) }, ctx12);
    expect(inRange.ok).toBe(true);
  });

  it('kills the piece dead centre about half the time', () => {
    const killed = hits(at(6, 6), at(6, 6));
    expect(killed).toBeGreaterThan(200 * 0.35);
    expect(killed).toBeLessThan(200 * 0.65);
  });

  it('kills a piece on the ring about one time in five', () => {
    const killed = hits(at(6, 7), at(6, 6));
    expect(killed).toBeGreaterThan(200 * 0.08);
    expect(killed).toBeLessThan(200 * 0.32);
  });

  it('can kill its own side, and a own king loses the game', () => {
    // A white rook stands one cell from the aim point, in front of the black one:
    // the shot takes whichever is nearer the centre, uniform or not.
    const s = state(
      [
        piece(1, 0, 'king', at(0, 0)),
        piece(2, 1, 'king', at(7, 0)),
        piece(3, 0, 'rook', at(6, 6)),
        piece(4, 1, 'rook', at(6, 7)),
      ],
      { seed: 3, turn: 0, coins: [500, 500], rockets: { [String(at(3, 3))]: 0 } },
    );

    let friendly: { hit: boolean } | null = null;
    for (let seed = 1; seed <= 40 && !friendly; seed++) {
      const result = chessReduce({ ...s, seed }, { k: 'fire', cell: at(6, 6) }, ctx8());
      if (result.ok && !result.state.pieces.some((p) => p.id === 3)) friendly = { hit: true };
    }
    expect(friendly).not.toBeNull();

    // And a rocket that kills its own king loses the game for the shooter.
    let lost = false;
    for (let seed = 1; seed <= 60 && !lost; seed++) {
      const own = state([piece(1, 0, 'king', at(6, 6)), piece(2, 1, 'king', at(7, 0))], {
        seed,
        turn: 0,
        coins: [500, 500],
        rockets: { [String(at(3, 3))]: 0 },
      });
      const result = chessReduce(own, { k: 'fire', cell: at(6, 6) }, ctx8());
      if (result.ok && result.state.winner === 1) lost = true;
    }
    expect(lost).toBe(true);
  });

  it('charges the shot whether it hits or misses', () => {
    const result = chessReduce(board(1, at(6, 6)), { k: 'fire', cell: at(6, 6) }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.coins[0]).toBe(500 - BALANCE.chess.rocketShotCost);
  });

  it('refuses to fire when the side cannot pay for the rockets', () => {
    const poor = board(1, at(6, 6), { coins: [BALANCE.chess.rocketShotCost - 1, 0] });
    const result = chessReduce(poor, { k: 'fire', cell: at(6, 6) }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_coins');
  });

  it('takes the turn whether it hits or misses', () => {
    const result = chessReduce(board(1, at(6, 6)), { k: 'fire', cell: at(6, 6) }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turn).toBe(1);
    expect(result.events.some((event) => event.t === 'fired')).toBe(true);
  });

  it('wins the game when the shot kills the king', () => {
    let won = false;
    for (let seed = 1; seed <= 40 && !won; seed++) {
      const s = state([piece(1, 0, 'king', at(0, 0)), piece(2, 1, 'king', at(6, 6))], {
        seed,
        turn: 0,
        coins: [500, 500],
        rockets: { [String(at(3, 3))]: 0 },
      });
      const result = chessReduce(s, { k: 'fire', cell: at(6, 6) }, ctx8());
      if (result.ok && result.state.winner === 0) {
        won = true;
        const event = result.events.find((item) => item.t === 'won');
        expect(event?.t === 'won' && event.how).toBe('rocket');
      }
    }
    expect(won).toBe(true);
  });

  it('can be taken by landing on it, and drowns with the tide', () => {
    const taken = chessReduce(
      state(
        [
          piece(1, 1, 'rook', at(1, 3)),
          piece(2, 0, 'king', at(0, 0)),
          piece(3, 1, 'king', at(7, 7)),
        ],
        { turn: 1, coins: [0, 0], rockets: { [String(at(3, 3))]: 0 } },
      ),
      { k: 'move', piece: 1, to: at(3, 3) },
      ctx8(),
    );
    expect(taken.ok).toBe(true);
    if (taken.ok) {
      expect(taken.state.rockets[String(at(3, 3))]).toBeUndefined();
      expect(taken.events.some((event) => event.t === 'rocketTaken')).toBe(true);
    }

    const drowned = chessReduce(
      state(
        [
          piece(1, 0, 'king', at(3, 3)),
          piece(2, 1, 'king', at(7, 7)),
          piece(3, 1, 'rook', at(6, 6)),
        ],
        { turn: 1, round: 100, coins: [0, 0], rockets: { [String(at(0, 0))]: 0 } },
      ),
      { k: 'move', piece: 3, to: at(6, 7) },
      ctx8(),
    );
    expect(drowned.ok).toBe(true);
    if (drowned.ok) expect(drowned.state.rockets[String(at(0, 0))]).toBeUndefined();
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

describe('recruiting a pawn into a tower', () => {
  const tower = at(3, 4);

  it('costs 30 coins, uses the turn and puts a pawn in the tower', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
      towers: { [String(tower)]: 0 },
    });

    const result = chessReduce(s, { k: 'recruit', cell: tower }, ctx8());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.coins).toEqual([10, BALANCE.chess.pawnCost + 10]);
    expect(result.state.turn).toBe(1);
    const born = result.state.pieces.find((p) => p.cell === tower);
    expect(born?.kind).toBe('pawn');
    expect(born?.side).toBe(0);
    expect(born?.moved).toBe(true);
    expect(result.events).toContainEqual({
      t: 'recruited',
      piece: born?.id,
      cell: tower,
      side: 0,
      cost: BALANCE.chess.pawnCost,
    });
  });

  it('refuses when the side cannot pay', () => {
    // 20 coins at the start, a pawn costs 30.
    const s = state([piece(1, 0, 'king', at(3, 3))], { towers: { [String(tower)]: 0 } });
    const result = chessReduce(s, { k: 'recruit', cell: tower }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_coins');
  });

  it('refuses a cell that holds no tower of yours', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
      towers: { [String(tower)]: 1 },
    });
    const result = chessReduce(s, { k: 'recruit', cell: tower }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_tower');
  });

  it('refuses a tower that already has somebody in it', () => {
    const s = state(
      [piece(1, 0, 'king', at(3, 3)), piece(9, 0, 'rook', tower), piece(2, 1, 'king', at(7, 7))],
      {
        coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
        towers: { [String(tower)]: 0 },
      },
    );
    const result = chessReduce(s, { k: 'recruit', cell: tower }, ctx8());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('occupied');
  });

  it('lets a recruited pawn walk like any other, two squares included', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
      towers: { [String(tower)]: 0 },
    });
    const result = chessReduce(s, { k: 'recruit', cell: tower }, ctx8());
    if (!result.ok) throw new Error('recruit refused');

    const born = result.state.pieces.find((p) => p.cell === tower);
    if (!born) throw new Error('no pawn');
    const steps = targets(result.state, born.id);
    expect(steps).toContain(tower + 1);
    expect(steps).toContain(tower + 2);
  });

  it('lets the pawn walk out, and lets the enemy take the tower and the pawn together', () => {
    const s = state([piece(1, 0, 'king', at(3, 3)), piece(2, 1, 'king', at(7, 7))], {
      coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
      towers: { [String(tower)]: 0 },
    });
    void s;

    // Out of the garrison and onto the next cell: the tower does not trap it.
    const garrison = state(
      [
        piece(1, 0, 'king', at(3, 3)),
        { ...piece(9, 0, 'pawn', tower), moved: true },
        piece(2, 1, 'king', at(7, 7)),
      ],
      {
        coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
        towers: { [String(tower)]: 0 },
      },
    );
    const out = chessReduce(garrison, { k: 'move', piece: 9, to: tower + 1 }, ctx8());
    expect(out.ok).toBe(true);

    // And with the pawn back inside, a black rook takes the square and the pawn.
    const guarded = state(
      [
        piece(1, 0, 'king', at(3, 3)),
        { ...piece(9, 0, 'pawn', tower), moved: true },
        piece(3, 1, 'rook', at(3, 7)),
        piece(2, 1, 'king', at(7, 7)),
      ],
      {
        turn: 1,
        coins: [BALANCE.chess.pawnCost + 10, BALANCE.chess.pawnCost + 10],
        towers: { [String(tower)]: 0 },
      },
    );
    const take = chessReduce(guarded, { k: 'move', piece: 3, to: tower }, ctx8());
    expect(take.ok).toBe(true);
    if (!take.ok) return;
    expect(take.state.pieces.some((p) => p.cell === tower)).toBe(true);
    expect(take.state.pieces.find((p) => p.cell === tower)?.kind).toBe('rook');
    expect(take.state.towers[String(tower)]).toBeUndefined();
  });
});
