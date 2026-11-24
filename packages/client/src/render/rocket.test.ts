import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRocketGeometry } from './rocket';

/**
 * The rocket base is geometry, so it can be measured without a GPU: the unit box it
 * promises, a missile taller than anything else on the board, and two sides that
 * cannot be confused.
 */

const SIDES = [0, 1] as const;

describe.each(SIDES)('rocket base (side %i)', (side) => {
  const rocket = createRocketGeometry(side);
  const position = rocket.getAttribute('position');
  rocket.computeBoundingBox();
  const bounds = rocket.boundingBox as THREE.Box3;

  it('fits the unit box the instancing assumes', () => {
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.min.y).toBeLessThan(0.05);
    // The tip reaches the top of the box: that is what makes it the tallest thing
    // on the board once the scene scales it.
    expect(bounds.max.y).toBeGreaterThan(0.95);
    expect(bounds.max.y).toBeLessThanOrEqual(1.001);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-0.5);
    expect(bounds.max.x).toBeLessThanOrEqual(0.5);
  });

  it('is a missile on a pad, not a box', () => {
    // The pad is wide at the bottom; the body above mid-height is much narrower.
    const widthAbove = (from: number): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < position.count; i++) {
        if (position.getY(i) < from) continue;
        min = Math.min(min, position.getX(i));
        max = Math.max(max, position.getX(i));
      }
      return max - min;
    };

    const pad = widthAbove(0);
    const body = widthAbove(0.6);
    expect(pad).toBeGreaterThan(0.8);
    expect(body).toBeLessThan(pad * 0.6);
    expect(body).toBeGreaterThan(0.1);
  });

  it('has enough triangles to read as a launcher', () => {
    const index = rocket.getIndex();
    const triangles = (index ? index.count : position.count) / 3;
    expect(triangles).toBeGreaterThan(60);
  });

  it('carries the side palette in vertex colours', () => {
    const color = rocket.getAttribute('color');
    expect(color).toBeDefined();
    expect(color.count).toBe(position.count);
    const distinct = new Set<string>();
    for (let i = 0; i < color.count; i += 7) {
      distinct.add(`${color.getX(i).toFixed(2)},${color.getY(i).toFixed(2)}`);
    }
    // Pad, metal, shade, accent and warhead: at least four of them in the mix.
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });
});

describe('the two rocket bases', () => {
  const digest = (side: 0 | 1): number => {
    const color = createRocketGeometry(side).getAttribute('color');
    let sum = 0;
    for (let i = 0; i < color.count; i++) {
      sum += color.getX(i) * 1.7 + color.getY(i) * 3.1 + color.getZ(i) * 5.3;
    }
    return Math.round(sum * 1000);
  };

  it('are painted differently, so a glance tells whose they are', () => {
    expect(digest(0)).not.toBe(digest(1));
  });
});
