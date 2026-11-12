import { describe, expect, it } from 'vitest';
import { t } from './index';
import { en } from './en';
import { ru } from './ru';

/**
 * Two languages, one shape. The type system enforces it at compile time; this
 * test also catches the case where both files are edited in the same wrong way.
 */

function shape(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [`${prefix}()`];
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    shape(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('dictionaries', () => {
  it('ships English', () => {
    expect(t).toBe(en);
    expect(t.app.title).toBe('Eurasia Map');
  });

  it('has the same keys and signatures in every language', () => {
    expect(shape(ru).sort()).toEqual(shape(en).sort());
  });

  it('has no empty or placeholder strings', () => {
    const leaves: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') leaves.push(value);
      else if (Array.isArray(value)) leaves.push(...value.map(String));
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    walk(t);
    expect(leaves.length).toBeGreaterThan(40);
    for (const leaf of leaves) {
      expect(leaf.trim().length).toBeGreaterThan(0);
      expect(leaf).not.toContain('undefined');
    }
  });

  it('formats numbers and elevations the English way', () => {
    expect(t.hud.metres(5200)).toBe('5,200 m');
    expect(t.panel.progress(12, 500)).toBe('12 / 500');
    expect(t.messages.loaded(1)).toContain('1 claimed cell');
    expect(t.messages.loaded(7)).toContain('7 claimed cells');
  });
});
