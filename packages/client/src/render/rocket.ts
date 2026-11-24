import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The rocket base, built in code rather than loaded from a file.
 *
 * Why procedural: the model has to say "artillery" at twenty pixels, carry the
 * side's own palette, and stand a good deal taller than a tower — and all three are
 * easier to tune in a dozen numbers than in an editor export. Everything is built
 * inside a unit box: footprint 1 x 1 centred on the origin, base at y = 0, tip at
 * y = 1. The scene scales the instance to the size it wants.
 *
 * The silhouette: a wide concrete pad, a blast deflector at the back, a launch
 * table on two rails, and a single big missile standing on it — body, warhead band,
 * nose cone and four fins — with a service gantry at one corner.
 */

export type RocketSide = 0 | 1;

interface Palette {
  /** Concrete, the same on both sides: it is a pad, not a banner. */
  readonly pad: string;
  readonly metal: string;
  readonly shade: string;
  readonly accent: string;
  readonly warhead: string;
}

const PALETTES: readonly [Palette, Palette] = [
  {
    // Side A keeps the purple darkstone of its castle.
    pad: '#79736a',
    metal: '#8b7ba6',
    shade: '#6b5d84',
    accent: '#c9b6e0',
    warhead: '#c8452c',
  },
  {
    // Side B keeps the golden sandstone, with a dark green warhead.
    pad: '#7f776a',
    metal: '#c9a86a',
    shade: '#a88b52',
    accent: '#f0d9a8',
    warhead: '#3f6b4a',
  },
];

const SEGMENTS = 14;

/** Vertex colours must be in the renderer's working space, not sRGB. */
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

/** Open-ended: whatever caps the cylinder closes the top, the base is buried. */
function tube(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, SEGMENTS, 1, true);
  geometry.translate(x, y, z);
  return geometry;
}

function cone(radius: number, height: number, x: number, y: number, z: number) {
  const geometry = new THREE.ConeGeometry(radius, height, SEGMENTS, 1, false);
  geometry.translate(x, y, z);
  return geometry;
}

export function createRocketGeometry(side: RocketSide): THREE.BufferGeometry {
  const palette = PALETTES[side === 1 ? 1 : 0];
  const parts: THREE.BufferGeometry[] = [];

  // --- the pad it all stands on ---------------------------------------------
  parts.push(paint(box(0.98, 0.07, 0.98, 0, 0.035, 0), palette.pad));
  // Blast deflector at the back, angled so it reads as a ramp, not a wall. Turned
  // before it is moved: rotating a translated box swings it through the ground.
  const deflector = box(0.62, 0.2, 0.26, 0, 0, 0);
  deflector.rotateX(-0.35);
  deflector.translate(0, 0.15, -0.34);
  parts.push(paint(deflector, palette.shade));

  // --- launch table on two rails --------------------------------------------
  for (const x of [-0.16, 0.16]) {
    parts.push(paint(box(0.06, 0.32, 0.06, x, 0.23, 0.04), palette.shade));
  }
  parts.push(paint(box(0.46, 0.05, 0.46, 0, 0.42, 0), palette.metal));

  // --- one big missile ------------------------------------------------------
  // Skirt, body, band, cone: the body is the mass, the cone is the arrow.
  parts.push(paint(tube(0.155, 0.19, 0.1, 0, 0.5, 0), palette.shade));
  parts.push(paint(tube(0.14, 0.155, 0.3, 0, 0.7, 0), palette.metal));
  parts.push(paint(tube(0.145, 0.145, 0.045, 0, 0.86, 0), palette.accent));
  // The tip closes the unit box exactly: 0.86 + 0.14.
  parts.push(paint(cone(0.14, 0.14, 0, 0.93, 0), palette.warhead));

  // Fins: four flat blades at the skirt, one per side of the compass.
  for (let index = 0; index < 4; index++) {
    const fin = box(0.02, 0.16, 0.13, 0, 0.56, 0.19);
    fin.rotateY((index * Math.PI) / 2);
    parts.push(paint(fin, palette.shade));
  }

  // --- service gantry at a corner -------------------------------------------
  parts.push(paint(box(0.05, 0.46, 0.05, 0.33, 0.3, 0.33), palette.shade));
  parts.push(paint(box(0.24, 0.04, 0.04, 0.22, 0.52, 0.33), palette.accent));
  parts.push(paint(box(0.04, 0.04, 0.14, 0.33, 0.52, 0.26), palette.accent));

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`rocket geometry failed to merge (side ${side})`);

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
