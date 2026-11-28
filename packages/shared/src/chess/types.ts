import type { MapSize } from '../map/types';

/**
 * Chess on the map: a separate turn-based mode, hot-seat on one device.
 *
 * The board is the same terrain grid and the same rising sea, but the pieces are
 * chess pieces: every one of them moves by chess rules, and the sea is what
 * forces the game uphill. A turn is either one piece move or — for the king only
 * — one tower built next to where the king stands.
 *
 * Kept apart from the building game's reducer on purpose: different rules,
 * different state shape, different save.
 */

/** Who is who. Side 0 starts in the west, side 1 in the east. */
export type Side = 0 | 1;

/** How a game ended: a king taken, a king drowned, or a king hit by a rocket. */
export type WinHow = 'king' | 'drowned' | 'rocket' | 'volcano';

export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export interface Piece {
  /** Stable identity: the client selects and moves pieces by it. */
  readonly id: number;
  readonly side: Side;
  readonly kind: PieceKind;
  readonly cell: number;
  /** A pawn that has reached the far edge becomes a queen once. */
  readonly promoted: boolean;
  /**
   * Whether this piece has ever left its starting square. It no longer gates the
   * two-square step — every pawn may take that at any time — but it records the
   * fact for saves and for any future rule that needs it.
   */
  readonly moved: boolean;
}

export interface ChessState {
  readonly v: number;
  readonly seed: number;
  readonly size: MapSize;
  readonly pieces: readonly Piece[];
  /** Whose turn it is. */
  readonly turn: Side;
  /** Full turns played: one round is both sides moving once. */
  readonly round: number;
  readonly seaLevel: number;
  /** Fortifications: cell index -> owner. They block movement and can be taken. */
  readonly towers: Readonly<Record<string, Side>>;
  /** Rocket bases: cell index -> owner. They block like towers and can be taken. */
  readonly rockets: Readonly<Record<string, Side>>;
  /**
   * Live volcanoes: cell index -> the round it appeared. The stage is derived —
   * `round - spawned` — so a save needs no extra bookkeeping and a replay is exact.
   */
  readonly volcanoes: Readonly<Record<string, number>>;
  /**
   * Lava flows: cell index -> the round the flow appeared. A flow lasts
   * `BALANCE.chess.lava.rounds` rounds and then cools; the age is derived, the same
   * way a volcano's stage is, so a save stores only the round.
   */
  readonly lava: Readonly<Record<string, number>>;
  readonly coins: readonly [number, number];
  /** Set once a king is taken or drowned; the loser is the other side. */
  readonly winner: Side | null;
  readonly lastMove: { readonly piece: number; readonly from: number; readonly to: number } | null;
}

export type ChessCommand =
  | { readonly k: 'move'; readonly piece: number; readonly to: number }
  | {
      readonly k: 'build';
      readonly cell: number;
      /** A tower (default) or a rocket base; both cost the turn. */
      readonly kind?: 'tower' | 'rocket';
    }
  /** Fire a rocket at a 3x3 zone: `cell` is the centre of the zone. */
  | { readonly k: 'fire'; readonly cell: number }
  /** Recruit a pawn into one of your own towers, instead of moving a piece. */
  | { readonly k: 'recruit'; readonly cell: number };

/** Terrain, not state: the same context the building game uses. */
export interface ChessCtx {
  /** The board's land count. A save from another board is not this game. */
  readonly size?: MapSize;
  readonly isLand: (cell: number) => boolean;
  readonly elev: readonly number[];
  readonly rows: number;
  readonly cols: number;
  readonly cellCount: number;
  /**
   * Rows each side may camp in, when the caller knows the map's latitudes. The
   * engine has no geography of its own: it is told where Europe is.
   */
  readonly campRows?: readonly (readonly [number, number] | null)[];
  /** Columns each side may camp in, from the same latitude/longitude bands. */
  readonly campCols?: readonly (readonly [number, number] | null)[];
}

export type ChessEvent =
  | { readonly t: 'moved'; readonly piece: number; readonly from: number; readonly to: number }
  | {
      readonly t: 'captured';
      readonly piece: number;
      readonly kind: PieceKind;
      readonly cell: number;
    }
  | { readonly t: 'towerTaken'; readonly cell: number; readonly side: Side }
  | { readonly t: 'rocketBuilt'; readonly cell: number; readonly side: Side; readonly cost: number }
  | { readonly t: 'rocketTaken'; readonly cell: number; readonly side: Side }
  | {
      readonly t: 'fired';
      readonly side: Side;
      readonly from: number;
      readonly cell: number;
      /**
       * Everything the shot destroyed: pieces, towers and rocket bases all roll,
       * each by the odds of the cell it stands on.
       */
      readonly hits: readonly {
        readonly cell: number;
        /** The piece that died, when a piece died there. */
        readonly piece: number | null;
        readonly kind: PieceKind | 'tower' | 'rocket';
        readonly side: Side;
      }[];
      /** How many things stood in the zone, hit or not. */
      readonly risked: number;
    }
  | { readonly t: 'built'; readonly cell: number; readonly side: Side; readonly cost: number }
  | {
      readonly t: 'recruited';
      readonly piece: number;
      readonly cell: number;
      readonly side: Side;
      readonly cost: number;
    }
  | { readonly t: 'promoted'; readonly piece: number; readonly cell: number }
  | { readonly t: 'drowned'; readonly pieces: number; readonly towers: number }
  | { readonly t: 'sea'; readonly level: number }
  | { readonly t: 'turn'; readonly side: Side; readonly round: number }
  | {
      readonly t: 'volcano';
      readonly cell: number;
      /** 0 yellow, 1 orange, 2 red — the round it opens. */
      readonly stage: number;
    }
  | {
      readonly t: 'erupted';
      readonly cell: number;
      readonly pieces: number;
      readonly structures: number;
    }
  | {
      /** Flows appeared on these cells: impassable, and burning anything left there. */
      readonly t: 'lava';
      readonly cells: readonly number[];
    }
  | {
      /** A flow took something: a piece, a structure, or both on one cell. */
      readonly t: 'lavaBurned';
      readonly cell: number;
      readonly pieces: number;
      readonly structures: number;
    }
  | { readonly t: 'lavaOut'; readonly cells: readonly number[] }
  | { readonly t: 'won'; readonly side: Side; readonly how: WinHow }
  | { readonly t: 'rejected'; readonly code: ChessErrorCode };

export type ChessErrorCode =
  | 'over'
  | 'no_piece'
  | 'not_yours'
  | 'illegal'
  | 'occupied'
  | 'not_adjacent'
  | 'no_coins'
  | 'no_tower'
  | 'no_rocket'
  | 'out_of_range'
  | 'no_target'
  | 'flooded'
  | 'unknown';

export type ChessResult =
  | {
      readonly ok: true;
      readonly state: ChessState;
      /** Legal destinations for the piece, when the caller needs to draw them. */
      readonly events: readonly ChessEvent[];
    }
  | {
      readonly ok: false;
      readonly code: ChessErrorCode;
      readonly state: ChessState;
      readonly events: readonly ChessEvent[];
    };
