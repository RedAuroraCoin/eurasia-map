import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAVA_COLOURS, LAVA_INSET, LAVA_LIFT, createLavaGeometry, lavaPulse } from './lava';

/**
 * A flow is ground, not an object: flat, inside the cell, and lifted just enough not to
 * fight the terrain for the same pixel.
 */

const bounds = (geometry: THREE.BufferGeometry): THREE.Box3 => {
  geometry.computeBoundingBox();
  return geometry.boundingBox as THREE.Box3;
};

describe('the lava tile', () => {
  it('lies flat, inside the cell, just above the ground', () => {
    const box = bounds(createLavaGeometry());
    // Flat: no height at all beyond the lift.
    expect(box.max.y - box.min.y).toBeLessThan(0.001);
    expect(box.min.y).toBeCloseTo(LAVA_LIFT, 3);
    expect(LAVA_INSET).toBeLessThan(1);
    expect(box.max.x - box.min.x).toBeCloseTo(LAVA_INSET, 3);
    expect(box.max.z - box.min.z).toBeCloseTo(LAVA_INSET, 3);
  });

  it('glows orange, not red and not yellow', () => {
    const [base, hot] = LAVA_COLOURS;
    const channels = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    const flow = channels(base);
    const core = channels(hot);
    // Orange: red high, green middling, blue nearly nothing.
    expect(flow.r).toBeGreaterThan(200);
    expect(flow.g).toBeGreaterThan(60);
    expect(flow.g).toBeLessThan(flow.r);
    expect(flow.b).toBeLessThan(60);
    // The core is hotter and lighter, so the middle of a flow reads as the hottest.
    expect(core.r + core.g).toBeGreaterThan(flow.r + flow.g);
  });

  it('breathes slowly and never goes dark', () => {
    const samples = Array.from({ length: 60 }, (_, i) => lavaPulse(i * 97));
    expect(Math.min(...samples)).toBeGreaterThan(0.6);
    expect(Math.max(...samples)).toBeLessThan(0.95);
    // Slow: a second of frames must not flash many times.
    const turns = samples.filter(
      (value, index) => index > 0 && value > (samples[index - 1] as number),
    );
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.length).toBeLessThan(samples.length * 0.8);
  });
});
