import { SAVE_VERSION, type CellState, type GameState } from '@eurasia/shared';

/**
 * Saved progress, with an explicit version envelope and a migration chain.
 *
 * The rule from the brief: a save from a newer version is never silently
 * dropped. It is refused, and the player is told why.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Bumped from `eurasia.settings` when the relief scale changed: a stored
 * `relief: false` from the previous look would otherwise keep the map flat and
 * make the new exaggeration look broken.
 */
export const SETTINGS_KEY = 'eurasia.settings.v2';

/**
 * One save per map size: switching size is not a destructive act, and a player
 * who tries the 800-cell map should find their 300-cell city still there.
 */
export const saveKey = (size: number): string => `eurasia.save.${size}`;

export type LoadResult =
  | { readonly ok: true; readonly state: GameState; readonly savedAt: number }
  | { readonly ok: false; readonly reason: 'empty' | 'corrupt' | 'newer' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseCell(raw: unknown): CellState | null {
  if (!isRecord(raw)) return null;
  const { o, t } = raw;
  if (o !== 0 && o !== 1) return null;
  if (!isFiniteNumber(t) || t < 0) return null;
  return { o, t };
}

function parsePair(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [a, b] = raw;
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  if (a < 0 || b < 0) return null;
  return [Math.floor(a), Math.floor(b)];
}

/** Structural validation, not a cast: a corrupt save must not reach the engine. */
export function parseState(raw: unknown): GameState | null {
  if (!isRecord(raw)) return null;
  const { v, seed, cells, coins, claimed, lastDay } = raw;

  if (!isFiniteNumber(v) || !Number.isInteger(v)) return null;
  if (!isFiniteNumber(seed) || !Number.isInteger(seed)) return null;
  if (!isFiniteNumber(lastDay) || !Number.isInteger(lastDay)) return null;

  const parsedCoins = parsePair(coins);
  const parsedClaimed = parsePair(claimed);
  if (!parsedCoins || !parsedClaimed) return null;

  if (!isRecord(cells)) return null;
  const parsedCells: Record<string, CellState> = {};
  let count = 0;
  for (const [key, value] of Object.entries(cells)) {
    const cell = parseCell(value);
    if (!cell) return null;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) return null;
    parsedCells[key] = cell;
    if (cell.o === 0) count++;
  }
  if (count !== parsedClaimed[0]) return null;

  return {
    v,
    seed,
    cells: parsedCells,
    coins: parsedCoins,
    claimed: parsedClaimed,
    lastDay,
  };
}

/** v1 is current; add `case` arms as the format evolves. */
export function migrate(raw: unknown): { state: GameState } | { error: 'corrupt' | 'newer' } {
  if (!isRecord(raw)) return { error: 'corrupt' };
  const version = raw.v;
  if (typeof version !== 'number' || !Number.isInteger(version)) return { error: 'corrupt' };
  if (version > SAVE_VERSION) return { error: 'newer' };
  if (version < 1) return { error: 'corrupt' };

  const state = parseState(raw);
  return state ? { state } : { error: 'corrupt' };
}

export function loadSave(storage: StorageLike, size: number): LoadResult {
  let text: string | null = null;
  try {
    text = storage.getItem(saveKey(size));
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

  const savedAt = isFiniteNumber(envelope.savedAt) ? envelope.savedAt : 0;
  const result = migrate(envelope.state);
  if ('error' in result) return { ok: false, reason: result.error };
  return { ok: true, state: result.state, savedAt };
}

export function saveState(
  storage: StorageLike,
  state: GameState,
  now: number,
  size: number,
): boolean {
  try {
    storage.setItem(saveKey(size), JSON.stringify({ v: SAVE_VERSION, savedAt: now, state }));
    return true;
  } catch {
    // Private mode or a full quota: the game keeps working, unsaved.
    return false;
  }
}

export function clearSave(storage: StorageLike, size: number): void {
  try {
    storage.removeItem(saveKey(size));
  } catch {
    // nothing to do
  }
}

/** Real localStorage can throw on construction in some privacy modes. */
export function browserStorage(): StorageLike {
  try {
    const probe = '__eurasia_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

export type { GameState };
