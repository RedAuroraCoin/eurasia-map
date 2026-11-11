import { MAP_SIZES, type MapSize } from '@eurasia/shared';
import { SETTINGS_KEY, type StorageLike } from './save';

export type Theme = 'auto' | 'light' | 'dark';
export type Quality = 'auto' | 'high' | 'low';
export type DayNight = 'auto' | 'day' | 'night';

export interface Settings {
  readonly theme: Theme;
  readonly quality: Quality;
  readonly relief: boolean;
  readonly dayNight: DayNight;
  readonly hurricanes: boolean;
  /** Index into SPEEDS. */
  readonly speed: number;
  readonly size: MapSize;
}

/** 1x, 60x (an hour a minute), 600x (a day in 2.4 minutes). */
export const SPEEDS = [1, 60, 600] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  quality: 'auto',
  relief: true,
  dayNight: 'auto',
  hurricanes: true,
  speed: 0,
  size: 500,
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
  const speed = Number(source.speed);

  return {
    theme: pick<Theme>(source.theme, ['auto', 'light', 'dark'], DEFAULT_SETTINGS.theme),
    quality: pick<Quality>(source.quality, ['auto', 'high', 'low'], DEFAULT_SETTINGS.quality),
    relief: typeof source.relief === 'boolean' ? source.relief : DEFAULT_SETTINGS.relief,
    dayNight: pick<DayNight>(source.dayNight, ['auto', 'day', 'night'], DEFAULT_SETTINGS.dayNight),
    hurricanes:
      typeof source.hurricanes === 'boolean' ? source.hurricanes : DEFAULT_SETTINGS.hurricanes,
    speed: Number.isInteger(speed) && speed >= 0 && speed < SPEEDS.length ? speed : 0,
    size: (MAP_SIZES as readonly number[]).includes(size)
      ? (size as MapSize)
      : DEFAULT_SETTINGS.size,
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
