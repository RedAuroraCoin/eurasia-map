import { MS_PER_DAY } from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import { advance, clockFor, simNow } from './clock';

const T0 = Date.UTC(2026, 0, 1);

describe('the simulated clock', () => {
  it('is the real clock at speed 1', () => {
    expect(advance(0, 1000, 1)).toBe(0);
    expect(simNow(T0, 0)).toBe(T0);
  });

  it('adds the extra time a speed multiplier implies', () => {
    // 600x: one second of watching is ten minutes of world time.
    expect(advance(0, 1000, 600)).toBe(599_000);
    expect(advance(599_000, 1000, 600)).toBe(1_198_000);
  });

  it('makes one real second a whole day at the fastest setting', () => {
    const extra = advance(0, 1000, 86_400);
    expect(extra).toBe(86_399_000);
    // Within a second of a full day: the missing second is the one that passed.
    expect(Math.floor(simNow(T0, extra) / MS_PER_DAY) - Math.floor(T0 / MS_PER_DAY)).toBe(0);
    expect(extra).toBeGreaterThan(0.99 * MS_PER_DAY);
  });

  it('ignores a backwards frame instead of rewinding the world', () => {
    expect(advance(5000, -1000, 600)).toBe(5000);
  });

  it('never runs behind a save that was already fast-forwarded', () => {
    // Day indices are absolute, not days since the save.
    const lastDay = Math.floor(T0 / MS_PER_DAY) + 40;
    // Loaded a save from simulated day 40 on a real clock that is still day 1.
    expect(clockFor(T0, 0, lastDay)).toBe(lastDay * MS_PER_DAY);
    // A real clock that has caught up wins over the anchor.
    const later = (lastDay + 5) * MS_PER_DAY;
    expect(clockFor(later, 0, lastDay)).toBe(later);
  });

  it('turns thirty seconds of watching into thirty settled world days', () => {
    // 60 fps for half a minute at the fastest setting.
    let extra = 0;
    for (let frame = 0; frame < 30 * 60; frame++) extra = advance(extra, 1000 / 60, 86_400);
    // The real clock moved those thirty seconds too: `extra` is only the surplus.
    const world = clockFor(T0 + 30_000, extra, 0);

    expect(Math.floor(world / MS_PER_DAY) - Math.floor(T0 / MS_PER_DAY)).toBe(30);
  });

  it('keeps a fast-forwarded clock monotonic across a speed change', () => {
    let extra = advance(0, 1000, 600);
    const before = clockFor(T0, extra, 0);
    extra = advance(extra, 1000, 1);
    expect(clockFor(T0, extra, 0)).toBeGreaterThanOrEqual(before);
  });
});
