import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The king piece: a chess king built from lathe-like rings and a cross, ~150
 * triangles, one merged geometry shared by both sides. Only two of these ever
 * exist on the map, so they are plain meshes, not instanced.
 *
 * Unit box: base at y = 0, top at y = 1, one unit across. The scene scales it
 * down to a figure that stands on the keep.
 */

const SEGMENTS = 12;

function ring(radiusTop: number, radiusBottom: number, height: number, y: number) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, SEGMENTS, 1, true);
  geometry.translate(0, y + height / 2, 0);
  return geometry;
}

function capBox(width: number, height: number, depth: number, y: number, z = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, y + height / 2, z);
  return geometry;
}

export function createKingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    // Base and its step.
    ring(0.5, 0.46, 0.1, 0),
    ring(0.46, 0.42, 0.05, 0.1),
    // Stem, tapering to the collar.
    ring(0.24, 0.3, 0.4, 0.15),
    // Collar.
    ring(0.34, 0.28, 0.06, 0.55),
    // Head.
    ring(0.26, 0.3, 0.14, 0.61),
    // Crown.
    ring(0.3, 0.24, 0.08, 0.75),
    // Cross: upright and bar.
    capBox(0.07, 0.17, 0.07, 0.83),
    capBox(0.19, 0.06, 0.07, 0.87),
  ];

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('king geometry failed to merge');

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
