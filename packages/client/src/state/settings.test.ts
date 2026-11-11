import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SPEEDS,
  loadSettings,
  parseSettings,
  saveSettings,
  speedMultiplier,
} from './settings';
import type { StorageLike } from './save';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('parseSettings', () => {
  it('returns defaults for anything that is not an object', () => {
    for (const value of [null, undefined, 42, 'x', []]) {
      expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid fields and replaces invalid ones individually', () => {
    const parsed = parseSettings({
      theme: 'dark',
      quality: 'ultra',
      relief: false,
      dayNight: 'night',
      hurricanes: 'yes',
      speed: 2,
      size: 999,
    });
    expect(parsed.theme).toBe('dark');
    expect(parsed.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(parsed.relief).toBe(false);
    expect(parsed.dayNight).toBe('night');
    expect(parsed.hurricanes).toBe(DEFAULT_SETTINGS.hurricanes);
    expect(parsed.speed).toBe(2);
    expect(parsed.size).toBe(DEFAULT_SETTINGS.size);
  });

  it('accepts every advertised map size', () => {
    for (const size of [300, 500, 800]) {
      expect(parseSettings({ size }).size).toBe(size);
    }
  });

  it('rejects out-of-range speed indices', () => {
    expect(parseSettings({ speed: SPEEDS.length }).speed).toBe(0);
    expect(parseSettings({ speed: -1 }).speed).toBe(0);
    expect(parseSettings({ speed: 1.5 }).speed).toBe(0);
  });
});

describe('storage', () => {
  it('round-trips through a storage', () => {
    const storage = new MemoryStorage();
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const, size: 800 as const };
    saveSettings(storage, settings);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('falls back to defaults on broken JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem('eurasia.settings', '{{{');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back when the storage throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => undefined,
    };
    expect(loadSettings(hostile)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(hostile, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('speedMultiplier', () => {
  it('maps the index to a factor', () => {
    expect(speedMultiplier({ ...DEFAULT_SETTINGS, speed: 0 })).toBe(1);
    expect(speedMultiplier({ ...DEFAULT_SETTINGS, speed: 1 })).toBe(60);
    expect(speedMultiplier({ ...DEFAULT_SETTINGS, speed: 2 })).toBe(600);
  });
});
