/**
 * Save-format version. Bumped whenever GameState gains/renames/drops a field,
 * together with a migration in the client and in the room. Protocol versioning
 * is separate: they change for different reasons.
 */
export const SAVE_VERSION = 1;

/** Who owns a cell. Single-player uses slot 0 only. */
export type Slot = 0 | 1;

export interface CellState {
  /** Owner slot. */
  readonly o: Slot;
  /** When the cell was claimed, ms since epoch. */
  readonly t: number;
}

/**
 * The whole game, as plain JSON. No Map, no Date, no class instances:
 * this object is what we save, send over the wire, hash for replay checks
 * and diff in tests.
 */
export interface GameState {
  /** Save format version. */
  readonly v: number;
  readonly seed: number;
  /** Sparse: only claimed cells exist. Key is the cell index as a string. */
  readonly cells: Readonly<Record<string, CellState>>;
  readonly coins: readonly [number, number];
  /** Denormalised count per slot, kept in sync by the reducer. */
  readonly claimed: readonly [number, number];
  /** Last UTC day index income was credited for. */
  readonly lastDay: number;
}

export type Command =
  | { readonly k: 'claim'; readonly cell: number; readonly slot: Slot }
  | { readonly k: 'unclaim'; readonly cell: number; readonly slot: Slot }
  /** Nothing to do but let time pass — used on load, on visibility change, on a day alarm. */
  | { readonly k: 'tick' };

export type ErrorCode =
  | 'out_of_bounds'
  | 'sea'
  | 'taken'
  | 'already_owned'
  | 'not_owned'
  | 'no_coins'
  | 'unknown_command';

export type GameEvent =
  | { readonly t: 'claimed'; readonly cell: number; readonly slot: Slot; readonly cost: number }
  | { readonly t: 'unclaimed'; readonly cell: number; readonly slot: Slot; readonly refund: number }
  | {
      readonly t: 'income';
      readonly slot: Slot;
      readonly days: number;
      readonly amount: number;
      readonly cells: number;
    }
  | { readonly t: 'rejected'; readonly code: ErrorCode; readonly cell?: number };

export type Ok = {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export type Fail = {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};

export type Result = Ok | Fail;

/**
 * Everything the engine is allowed to know about the world.
 * `nowMs` and `isLand` are injected so the same code runs in the browser,
 * in a Worker and in a test with a fake clock.
 */
export interface Ctx {
  readonly nowMs: number;
  readonly isLand: (cell: number) => boolean;
  readonly cellCount: number;
}
