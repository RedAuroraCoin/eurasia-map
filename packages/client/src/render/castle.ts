import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A medieval castle assembled from primitives and merged into one geometry, so
 * eight hundred of them are still a single instanced draw call.
 *
 * Everything is designed inside a unit box: footprint 1 x 1 centred on the
 * origin, base at y = 0, top at y = 1. The scene scales it per instance
 * (width, growth, width), which is why nothing here is in world units.
 *
 * ~216 triangles: a keep with a crenellated rim, four corner towers with
 * conical roofs, and a gate. Enough for the silhouette to read at 20 px.
 */

// The keep is wide enough to meet the towers, so the parts read as one building
// rather than four posts around a box.
const KEEP = 0.62;
const KEEP_HEIGHT = 0.5;
const TOWER_RADIUS = 0.085;
const TOWER_HEIGHT = 0.78;
const TOWER_OFFSET = 0.395;
const ROOF_RADIUS = 0.1;
const ROOF_HEIGHT = 0.2;
const MERLON = 0.07;
const SEGMENTS = 8;

const STONE = '#cfc7b4';
const STONE_SHADE = '#bdb5a2';
const ROOF = '#8c3f2b';
const GATE = '#4a423a';

/** Vertex colours have to be in the renderer's working space, not sRGB. */
function paint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

export function createCastleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Keep.
  parts.push(paint(box(KEEP, KEEP_HEIGHT, KEEP, 0, KEEP_HEIGHT / 2, 0), STONE));

  // Gate, slightly proud of the front wall so it catches light.
  parts.push(paint(box(0.18, 0.28, 0.04, 0, 0.14, KEEP / 2 + 0.005), GATE));

  // Corner towers, open-ended: the roof closes the top and the base is buried.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tower = new THREE.CylinderGeometry(
        TOWER_RADIUS,
        TOWER_RADIUS * 1.12,
        TOWER_HEIGHT,
        SEGMENTS,
        1,
        true,
      );
      tower.translate(sx * TOWER_OFFSET, TOWER_HEIGHT / 2, sz * TOWER_OFFSET);
      parts.push(paint(tower, STONE));

      const roof = new THREE.ConeGeometry(ROOF_RADIUS, ROOF_HEIGHT, SEGMENTS, 1, true);
      roof.translate(sx * TOWER_OFFSET, TOWER_HEIGHT + ROOF_HEIGHT / 2, sz * TOWER_OFFSET);
      parts.push(paint(roof, ROOF));
    }
  }

  // Two merlons per side of the keep: the cheapest way to read as "castle".
  const rim = KEEP / 2 - MERLON / 2;
  for (const sz of [-1, 1]) {
    for (const offset of [-0.18, 0.18]) {
      parts.push(
        paint(box(MERLON, MERLON, MERLON, offset, KEEP_HEIGHT + MERLON / 2, sz * rim), STONE_SHADE),
      );
    }
  }
  for (const sx of [-1, 1]) {
    for (const offset of [-0.18, 0.18]) {
      parts.push(
        paint(box(MERLON, MERLON, MERLON, sx * rim, KEEP_HEIGHT + MERLON / 2, offset), STONE_SHADE),
      );
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('castle geometry failed to merge');

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
