import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { type CastleVariant, TOWER_SCALE, createCastleGeometry, towerFromCastle } from './castle';
import { mergeObject, normalizeToUnitBox } from './model';
import { unitColour } from './pieces';

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

/**
 * In chess a tower is the side's castle, shrunk to one cell. Build mode draws the
 * same geometry at full size, so the tower has to be a copy.
 */
describe('chess towers', () => {
  it('shrinks a castle to a cell and leaves the original alone', () => {
    const keep = createCastleGeometry('keep');
    keep.computeBoundingBox();
    const original = keep.boundingBox?.clone();
    if (!original) throw new Error('no bounds');

    const tower = towerFromCastle(keep);
    tower.computeBoundingBox();
    const box = tower.boundingBox;
    if (!box) throw new Error('no tower bounds');

    expect(box.max.x - box.min.x).toBeCloseTo((original.max.x - original.min.x) * TOWER_SCALE, 5);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(TOWER_SCALE + 0.02);
    expect(box.max.y).toBeLessThanOrEqual(TOWER_SCALE + 0.02);
    expect(box.min.y).toBeCloseTo(0, 5);

    keep.computeBoundingBox();
    expect(keep.boundingBox?.max.y).toBeCloseTo(original.max.y, 5);
    expect(keep.boundingBox?.max.y).toBeGreaterThan(TOWER_SCALE);
  });

  it('gives each side its own model, and both fit inside a cell', async () => {
    const digests: number[] = [];
    for (const file of ['castle-a.glb', 'castle-b.glb']) {
      const buffer = readFileSync(new URL(`../../public/models/${file}`, import.meta.url));
      const gltf = await new GLTFLoader().parseAsync(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
        '',
      );
      const merged = mergeObject(gltf.scene);
      expect(merged).not.toBeNull();
      normalizeToUnitBox(merged as THREE.BufferGeometry);

      const tower = towerFromCastle(merged as THREE.BufferGeometry);
      tower.computeBoundingBox();
      const box = tower.boundingBox;
      if (!box) throw new Error('no bounds');

      // Bounds cannot tell two models apart — both fit the same unit box — so the
      // triangles have to: a different castle is a different set of vertices.
      const position = tower.getAttribute('position');
      let digest = 0;
      for (let i = 0; i < position.count; i++) {
        digest += position.getX(i) * 1.7 + position.getY(i) * 3.1 + position.getZ(i) * 5.3;
      }
      digests.push(Math.round(digest * 1000));

      expect(box.max.x - box.min.x).toBeLessThanOrEqual(TOWER_SCALE + 0.01);
      expect(box.max.z - box.min.z).toBeLessThanOrEqual(TOWER_SCALE + 0.01);
      expect(box.max.y).toBeLessThanOrEqual(TOWER_SCALE + 0.01);
      expect(box.min.y).toBeCloseTo(0, 3);
    }

    // Two sides, two silhouettes: not one model used twice.
    expect(digests[0]).not.toBe(digests[1]);
  });

  it('tells the sides apart even when a model is missing', () => {
    expect(unitColour('tower', 0)).not.toBe(unitColour('tower', 1));
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
