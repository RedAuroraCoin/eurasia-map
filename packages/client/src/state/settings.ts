import {
  ALL_MAP_SIZES,
  BALANCE,
  REGIONS,
  sizeFor,
  type MapSize,
  type RegionId,
} from '@eurasia/shared';
import { SETTINGS_KEY, type StorageLike } from './save';

export type Theme = 'auto' | 'light' | 'dark';
export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  readonly theme: Theme;
  readonly quality: Quality;
  readonly relief: boolean;
  readonly hurricanes: boolean;
  /** Bloom on explosions and the fire under armed rockets. Purely cosmetic. */
  readonly glow: boolean;
  /** The daily water rise. A rule, so a room ignores this and always floods. */
  readonly flood: boolean;
  /** Which game is being played. They share the map and nothing else. */
  readonly mode: GameMode;
  /**
   * Which part of the world. Both regions are built by the same pipeline at the
   * same land counts, so switching one for the other is a display choice plus a
   * separate save, not a different game.
   */
  readonly region: RegionId;
  /** Index into SPEEDS. */
  readonly speed: number;
  readonly size: MapSize;
  /**
   * `both` renders the claimed cells as two sides, alternating, so both castle
   * designs can be seen before the two-player mode exists. A display switch: it
   * never changes the rules, the wallet or the save.
   */
  readonly sides: 'one' | 'both';
}

/**
 * 1x is the real clock. The last one is a whole world day per second, which is
 * what makes the sea watchable: at 50 m a day it rises 50 m a second.
 */
export const SPEEDS = [1, 60, 600, 86_400] as const;

export type GameMode = 'build' | 'chess';

export const DEFAULT_SETTINGS: Settings = {
  // Chess is the game the link opens: it needs no save and shows the board at
  // once. The city game is one click away in the panel, and a room link forces it.
  mode: 'chess',
  region: 'eurasia',
  theme: 'auto',
  quality: 'auto',
  relief: true,
  hurricanes: true,
  glow: true,
  flood: BALANCE.flood.enabledByDefault,
  speed: 0,
  size: 500,
  sides: 'one',
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/**
 * Every field is validated independently, so one corrupt entry costs one
 * setting rather than the whole panel.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const source = raw as Record<string, unknown>;

  const size = Number(source.size);
  // An unknown or missing mode means "whatever the build ships as default", not a
  // second hard-coded answer that can drift from DEFAULT_SETTINGS.
  const mode: GameMode =
    source.mode === 'chess' || source.mode === 'build' ? source.mode : DEFAULT_SETTINGS.mode;
  const region = pick<RegionId>(source.region, REGIONS, DEFAULT_SETTINGS.region);
  const speed = Number(source.speed);

  return {
    theme: pick<Theme>(source.theme, ['auto', 'light', 'dark'], DEFAULT_SETTINGS.theme),
    quality: pick<Quality>(source.quality, ['auto', 'high', 'low'], DEFAULT_SETTINGS.quality),
    relief: typeof source.relief === 'boolean' ? source.relief : DEFAULT_SETTINGS.relief,
    hurricanes:
      typeof source.hurricanes === 'boolean' ? source.hurricanes : DEFAULT_SETTINGS.hurricanes,
    glow: typeof source.glow === 'boolean' ? source.glow : DEFAULT_SETTINGS.glow,
    flood: typeof source.flood === 'boolean' ? source.flood : DEFAULT_SETTINGS.flood,
    mode,
    region,
    speed: Number.isInteger(speed) && speed >= 0 && speed < SPEEDS.length ? speed : 0,
    // A size has to exist on the chosen map: Europe has no 300-cell board, so a
    // preference carried over from Eurasia lands on the nearest one it does have.
    size:
      source.size === undefined
        ? sizeFor(region, DEFAULT_SETTINGS.size)
        : sizeFor(
            region,
            (ALL_MAP_SIZES as readonly number[]).includes(size)
              ? (size as MapSize)
              : DEFAULT_SETTINGS.size,
          ),
    sides: pick<'one' | 'both'>(source.sides, ['one', 'both'], DEFAULT_SETTINGS.sides),
  };
}

export function loadSettings(storage: StorageLike): Settings {
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (!text) return DEFAULT_SETTINGS;
    return parseSettings(JSON.parse(text));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // not worth interrupting the game over
  }
}

export const speedMultiplier = (settings: Settings): number => SPEEDS[settings.speed] ?? 1;

/** The settings with the size clamped to one the region actually builds. */
export const withRegion = (settings: Settings, region: RegionId): Settings => ({
  ...settings,
  region,
  size: sizeFor(region, settings.size),
});
