import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type CastleVariant, createCastleGeometry } from './castle';

/**
 * Geometry can be built and measured without a GPU, so the castles are not
 * entirely untested just because they cannot be looked at from here.
 */

const VARIANTS: CastleVariant[] = ['keep', 'bastion'];

describe.each(VARIANTS)('castle geometry (%s)', (variant) => {
  const castle = createCastleGeometry(variant);
  const position = castle.getAttribute('position');
  castle.computeBoundingBox();
  const bounds = castle.boundingBox as THREE.Box3;

  it('is made of enough triangles to have a silhouette', () => {
    expect(position.count).toBeGreaterThan(150);
    // merged geometries stay indexed, so triangles live in the index buffer
    const index = castle.getIndex();
    expect(index ? index.count % 3 : position.count % 3).toBe(0);
    expect((index ? index.count : position.count) / 3).toBeGreaterThan(80);
  });

  it('fits the unit box the instancing assumes', () => {
    expect(bounds.min.y).toBeCloseTo(0, 1);
    expect(bounds.max.y).toBeLessThanOrEqual(1.001);
    expect(bounds.max.y).toBeGreaterThan(0.85);
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

describe('the two sides', () => {
  const positionOf = (variant: CastleVariant): THREE.BufferAttribute =>
    createCastleGeometry(variant).getAttribute('position') as THREE.BufferAttribute;

  const digest = (variant: CastleVariant): number => {
    const position = positionOf(variant);
    let sum = 0;
    for (let i = 0; i < position.count; i++) {
      sum += position.getX(i) * 1.7 + position.getY(i) * 3.1 + position.getZ(i) * 5.3;
    }
    return Math.round(sum * 1000);
  };

  it('do not share a silhouette', () => {
    expect(digest('keep')).not.toBe(digest('bastion'));
  });

  it('do not share a palette', () => {
    const topColour = (variant: CastleVariant): string => {
      const castle = createCastleGeometry(variant);
      const position = castle.getAttribute('position');
      const colour = castle.getAttribute('color');
      let top = 0;
      for (let i = 1; i < position.count; i++) if (position.getY(i) > position.getY(top)) top = i;
      return `${colour.getX(top).toFixed(2)},${colour.getY(top).toFixed(2)},${colour.getZ(top).toFixed(2)}`;
    };
    expect(topColour('keep')).not.toBe(topColour('bastion'));
  });
});
