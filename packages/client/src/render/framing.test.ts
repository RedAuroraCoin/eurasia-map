import { MAP_SIZES, getMap } from '@eurasia/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cellToWorld, fitDistance, VIEW_DIRECTION } from './grid';

/**
 * Framing, checked with three's own projection maths instead of a screenshot:
 * where do the *land* corners land in normalised device coordinates at the
 * default camera? This is the test that would have caught "the map is too far
 * away and I have to zoom in before I can see it".
 *
 * The board's own corners are open sea and may sit slightly outside a square
 * viewport; what must never be cropped is the land.
 */

const FOV = 36;
const DIRECTION = new THREE.Vector3(...VIEW_DIRECTION).normalize();
const TARGET = new THREE.Vector3(0, 0.35, 0);

interface Frame {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function landFrame(size: 300 | 500 | 800, aspect: number): Frame {
  const map = getMap(size);
  const distance = fitDistance(map, FOV, aspect);

  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 400);
  camera.position.copy(DIRECTION.clone().multiplyScalar(distance));
  camera.lookAt(TARGET);
  camera.updateMatrixWorld(true);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    const { x, z } = cellToWorld(map, index);
    minX = Math.min(minX, x - 0.5);
    maxX = Math.max(maxX, x + 0.5);
    minZ = Math.min(minZ, z - 0.5);
    maxZ = Math.max(maxZ, z + 0.5);
  }

  const projected: THREE.Vector3[] = [];
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      for (const y of [0, 2.3]) {
        projected.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
  }

  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('default framing', () => {
  for (const aspect of [0.6, 1, 1.6, 2.2]) {
    it(`keeps the land in frame at aspect ${aspect}`, () => {
      for (const size of MAP_SIZES) {
        const box = landFrame(size, aspect);
        expect(box.minX).toBeGreaterThan(-1);
        expect(box.maxX).toBeLessThan(1);
        expect(box.minY).toBeGreaterThan(-1);
        expect(box.maxY).toBeLessThan(1);
        // and it is not a postage stamp: land spans a good part of one axis
        expect(Math.max(box.maxX - box.minX, box.maxY - box.minY)).toBeGreaterThan(0.7);
      }
    });
  }
});
