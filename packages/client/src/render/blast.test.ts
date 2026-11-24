import { describe, expect, it } from 'vitest';
import { BLAST_MS, blastFrame } from './blast';

/**
 * The explosion is arithmetic, so its promises are testable: it is visible at the
 * start, it ends, and it never relies on a clock that might stand still.
 */

describe('the explosion timeline', () => {
  it('is at full strength on the first frame', () => {
    const frame = blastFrame(0);
    expect(frame.t).toBe(0);
    expect(frame.fireballOpacity).toBeCloseTo(0.95, 5);
    expect(frame.ringOpacity).toBeCloseTo(0.95, 5);
    expect(frame.done).toBe(false);
  });

  it('holds before it fades, so a phone sees it', () => {
    const held = blastFrame(BLAST_MS * 0.1);
    expect(held.fireballOpacity).toBeCloseTo(0.95, 5);
    expect(held.ringOpacity).toBeCloseTo(0.95, 5);
  });

  it('is gone when the time is up, which is what removes it from the scene', () => {
    expect(blastFrame(BLAST_MS - 1).done).toBe(false);
    expect(blastFrame(BLAST_MS).done).toBe(true);
    expect(blastFrame(BLAST_MS).fireballOpacity).toBeCloseTo(0, 6);
    expect(blastFrame(BLAST_MS).ringOpacity).toBeCloseTo(0, 6);
    expect(blastFrame(BLAST_MS).scorchOpacity).toBeCloseTo(0, 6);
    // Anything later is still done, not wrapped around.
    expect(blastFrame(BLAST_MS * 10).done).toBe(true);
  });

  it('never runs backwards, even if the clock does', () => {
    const frame = blastFrame(-500);
    expect(frame.t).toBe(0);
    expect(frame.done).toBe(false);
  });

  it('grows and rises through its life', () => {
    const start = blastFrame(0);
    const middle = blastFrame(BLAST_MS * 0.5);
    expect(middle.ringScale).toBeGreaterThan(start.ringScale);
    expect(middle.fireballScale).toBeGreaterThan(start.fireballScale);
    expect(middle.fireballY).toBeGreaterThan(start.fireballY);
  });
});
