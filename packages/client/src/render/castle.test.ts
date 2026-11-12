import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCastleGeometry } from './castle';

/**
 * Geometry can be built and measured without a GPU, so the castle is not
 * entirely untested just because it cannot be looked at from here.
 */

describe('castle geometry', () => {
  const castle = createCastleGeometry();
  const position = castle.getAttribute('position');
  castle.computeBoundingBox();
  const bounds = castle.boundingBox as THREE.Box3;

  it('is made of enough triangles to have a silhouette', () => {
    expect(position.count).toBeGreaterThan(200);
    expect(position.count % 3).toBe(0);
  });

  it('fits the unit box the instancing assumes', () => {
    expect(bounds.min.y).toBeCloseTo(0, 1);
    expect(bounds.max.y).toBeLessThanOrEqual(1.001);
    expect(bounds.max.y).toBeGreaterThan(0.9);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-0.5);
    expect(bounds.max.x).toBeLessThanOrEqual(0.5);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-0.5);
    expect(bounds.max.z).toBeLessThanOrEqual(0.5);
  });

  it('carries per-part colours in the renderer working space', () => {
    const color = castle.getAttribute('color');
    expect(color).toBeDefined();
    expect(color.count).toBe(position.count);
    for (let i = 0; i < color.count; i++) {
      for (const channel of [color.getX(i), color.getY(i), color.getZ(i)]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
    // stone, shade, roof and gate: more than one colour, or it is just a box again
    const distinct = new Set<string>();
    for (let i = 0; i < color.count; i += 3) {
      distinct.add(`${color.getX(i).toFixed(3)},${color.getY(i).toFixed(3)}`);
    }
    expect(distinct.size).toBeGreaterThan(2);
  });

  it('has usable normals for lighting', () => {
    const normal = castle.getAttribute('normal');
    expect(normal).toBeDefined();
    expect(normal.count).toBe(position.count);
  });
});
