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
   * Whether this piece has ever left its starting square. Only a pawn that has
   * not moved may take its two-square opening step, so the rule needs the fact
   * rather than a guess from geometry.
   */
  readonly moved: boolean;
}

export interface ChessState {
  readonly v: number;
  readonly seed: number;
  readonly size: 300 | 500 | 800;
  readonly pieces: readonly Piece[];
  /** Whose turn it is. */
  readonly turn: Side;
  /** Full turns played: one round is both sides moving once. */
  readonly round: number;
  readonly seaLevel: number;
  /** Fortifications: cell index -> owner. They block movement and can be taken. */
  readonly towers: Readonly<Record<string, Side>>;
  readonly coins: readonly [number, number];
  /** Set once a king is taken or drowned; the loser is the other side. */
  readonly winner: Side | null;
  readonly lastMove: { readonly piece: number; readonly from: number; readonly to: number } | null;
}

export type ChessCommand =
  | { readonly k: 'move'; readonly piece: number; readonly to: number }
  | { readonly k: 'build'; readonly cell: number }
  /** Recruit a pawn into one of your own towers, instead of moving a piece. */
  | { readonly k: 'recruit'; readonly cell: number };

/** Terrain, not state: the same context the building game uses. */
export interface ChessCtx {
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
  | { readonly t: 'won'; readonly side: Side; readonly how: 'king' | 'drowned' }
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
