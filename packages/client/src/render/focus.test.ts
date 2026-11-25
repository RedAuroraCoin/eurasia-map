import { describe, expect, it } from 'vitest';
import { FOCUS_DELAY_MS, FOCUS_MS, focusStep } from './focus';

/**
 * The camera's timing: it must wait after a move, then arrive exactly once, and
 * never move at all while it is holding.
 */

describe('the camera glide', () => {
  it('holds still first, so the move is seen before the view leaves it', () => {
    const start = focusStep(0);
    expect(start.waiting).toBe(true);
    expect(start.ease).toBe(0);
    expect(start.done).toBe(false);

    const almost = focusStep(FOCUS_DELAY_MS - 1);
    expect(almost.waiting).toBe(true);
    expect(almost.ease).toBe(0);
  });

  it('starts exactly at the end of the hold', () => {
    const step = focusStep(FOCUS_DELAY_MS);
    expect(step.waiting).toBe(false);
    expect(step.ease).toBe(0);
    expect(step.done).toBe(false);
  });

  it('arrives once, smoothly, and stops', () => {
    const middle = focusStep(FOCUS_DELAY_MS + FOCUS_MS / 2);
    expect(middle.ease).toBeGreaterThan(0.4);
    expect(middle.ease).toBeLessThan(0.6);

    const end = focusStep(FOCUS_DELAY_MS + FOCUS_MS);
    expect(end.ease).toBe(1);
    expect(end.done).toBe(true);

    // Past the end it stays finished rather than wrapping around.
    const later = focusStep(FOCUS_DELAY_MS + FOCUS_MS * 4);
    expect(later.ease).toBe(1);
    expect(later.done).toBe(true);
  });

  it('never runs backwards on a clock that does', () => {
    const step = focusStep(-500);
    expect(step.waiting).toBe(true);
    expect(step.ease).toBe(0);
  });

  it('is a tenth of a second at least: a shorter hold reads as a jump', () => {
    expect(FOCUS_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(FOCUS_DELAY_MS).toBeLessThan(600);
    expect(FOCUS_MS).toBeGreaterThan(FOCUS_DELAY_MS);
  });
});
