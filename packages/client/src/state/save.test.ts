import { createInitialState, getMap, reduce } from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import { clearSave, loadSave, migrate, saveKey, saveState, type StorageLike } from './save';

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

const T0 = Date.UTC(2026, 0, 1);

function withCells(count: number) {
  const map = getMap(300);
  const ctx = {
    nowMs: T0,
    isLand: (index: number) => map.mask[index] === '#',
    cellCount: map.mask.length,
  };
  let state = createInitialState(7, T0);
  let claimed = 0;
  for (let index = 0; index < map.mask.length && claimed < count; index++) {
    if (map.mask[index] !== '#') continue;
    const result = reduce(state, { k: 'claim', cell: index, slot: 0 }, ctx);
    if (result.ok) {
      state = result.state;
      claimed++;
    }
  }
  return state;
}

describe('round trip', () => {
  it('restores exactly what was written', () => {
    const storage = new MemoryStorage();
    const state = withCells(3);
    expect(saveState(storage, state, T0 + 500, 300)).toBe(true);

    const loaded = loadSave(storage, 300);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state).toEqual(state);
    expect(loaded.savedAt).toBe(T0 + 500);
  });

  it('keeps one save per map size', () => {
    const storage = new MemoryStorage();
    saveState(storage, withCells(3), T0, 300);

    expect(loadSave(storage, 500)).toEqual({ ok: false, reason: 'empty' });
    expect(loadSave(storage, 300).ok).toBe(true);
    expect(storage.items.has(saveKey(300))).toBe(true);
    expect(storage.items.has(saveKey(800))).toBe(false);
  });

  it('clears only the requested size', () => {
    const storage = new MemoryStorage();
    saveState(storage, withCells(1), T0, 300);
    saveState(storage, withCells(1), T0, 500);
    clearSave(storage, 300);
    expect(loadSave(storage, 300).ok).toBe(false);
    expect(loadSave(storage, 500).ok).toBe(true);
  });
});

describe('rejecting bad saves', () => {
  const storage = new MemoryStorage();

  it('reports an empty slot', () => {
    expect(loadSave(storage, 300)).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports broken JSON', () => {
    storage.setItem(saveKey(300), '{not json');
    expect(loadSave(storage, 300)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses a save from a newer version instead of guessing', () => {
    storage.setItem(
      saveKey(300),
      JSON.stringify({ v: 2, savedAt: T0, state: { ...withCells(1), v: 2 } }),
    );
    expect(loadSave(storage, 300)).toEqual({ ok: false, reason: 'newer' });
  });

  it('rejects a state whose cell count lies', () => {
    const state = withCells(2);
    const broken = { ...state, claimed: [5, 0] as [number, number] };
    storage.setItem(saveKey(300), JSON.stringify({ v: 1, savedAt: T0, state: broken }));
    expect(loadSave(storage, 300)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('rejects non-numeric fields', () => {
    const state = withCells(1);
    for (const patch of [
      { coins: ['10', 10] },
      { lastDay: 'x' },
      { seed: null },
      { cells: [] },
      { cells: { 1: { o: 5, t: 1 } } },
      { cells: { abc: { o: 0, t: 1 } } },
    ]) {
      storage.setItem(
        saveKey(300),
        JSON.stringify({ v: 1, savedAt: T0, state: { ...state, ...patch } }),
      );
      expect(loadSave(storage, 300).ok).toBe(false);
    }
  });

  it('survives a storage that throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSave(hostile, 300)).toEqual({ ok: false, reason: 'corrupt' });
    expect(saveState(hostile, withCells(1), T0, 300)).toBe(false);
    expect(() => clearSave(hostile, 300)).not.toThrow();
  });
});

describe('migrate', () => {
  it('accepts the current version', () => {
    const state = withCells(1);
    expect(migrate(state)).toEqual({ state });
  });

  it('refuses versions it cannot understand', () => {
    expect(migrate({ v: 0, seed: 1 })).toEqual({ error: 'corrupt' });
    expect(migrate({ v: 99 })).toEqual({ error: 'newer' });
    expect(migrate({ v: '1' })).toEqual({ error: 'corrupt' });
    expect(migrate(null)).toEqual({ error: 'corrupt' });
  });
});
