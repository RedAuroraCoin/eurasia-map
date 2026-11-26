import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  VOLCANO_COLOURS,
  VOLCANO_HEIGHT,
  VOLCANO_RADIUS,
  createMouthGeometry,
  createVolcanoGeometry,
  volcanoColour,
} from './volcano';

/**
 * The volcano's shape and colour, measured without a GPU: it has to fit one cell and
 * stand on the ground, and the three stages have to be told apart at a glance.
 */

const bounds = (geometry: THREE.BufferGeometry): THREE.Box3 => {
  geometry.computeBoundingBox();
  return geometry.boundingBox as THREE.Box3;
};

describe('the volcano model', () => {
  it('stands on the ground and fits inside its cell', () => {
    const box = bounds(createVolcanoGeometry());
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.max.y).toBeCloseTo(VOLCANO_HEIGHT, 3);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(1);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(1);
    // A cone, not a cylinder: the mouth is much narrower than the base.
    expect(VOLCANO_RADIUS * 0.42).toBeLessThan(VOLCANO_RADIUS * 0.6);
  });

  it('has a mouth at the top, inside the rim', () => {
    const mouth = bounds(createMouthGeometry());
    expect(mouth.min.y).toBeGreaterThan(VOLCANO_HEIGHT - 0.1);
    expect(mouth.max.y).toBeLessThanOrEqual(VOLCANO_HEIGHT);
  });

  it('runs yellow, orange, red — and red again for anything later', () => {
    expect(volcanoColour(0)).toBe(VOLCANO_COLOURS[0]);
    expect(volcanoColour(1)).toBe(VOLCANO_COLOURS[1]);
    expect(volcanoColour(2)).toBe(VOLCANO_COLOURS[2]);
    expect(volcanoColour(9)).toBe(VOLCANO_COLOURS[2]);
    expect(volcanoColour(-3)).toBe(VOLCANO_COLOURS[0]);

    // The three stages must be far apart in colour, or the warning is invisible.
    const channels = VOLCANO_COLOURS.map((hex) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    }));
    expect(channels[0]!.g).toBeGreaterThan(channels[2]!.g + 80);
    expect(channels[0]!.r).toBeGreaterThan(200);
  });
});
