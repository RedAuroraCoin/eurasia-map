import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Two castles, one per side. Each is a merged primitive assembly, so eight
 * hundred of them cost one instanced draw call per side — two in total.
 *
 * Everything is built inside a unit box: footprint 1 x 1 centred on the origin,
 * base at y = 0, top at y = 1. The scene scales each instance (width, growth,
 * width), which is why nothing here is in world units.
 *
 * The silhouettes differ on purpose. At twenty pixels the outline, not the
 * colour, is what tells two sides apart, so they must not share a shape:
 * side A is a wide crenellated keep with four spiky corner towers, side B is one
 * tall round tower with a slate spire above low square bastions.
 */

export type CastleVariant = 'keep' | 'bastion';

const SEGMENTS = 10;

interface Palette {
  readonly stone: string;
  readonly shade: string;
  readonly roof: string;
  readonly dark: string;
}

const KEEP_PALETTE: Palette = {
  stone: '#cfc7b4',
  shade: '#bdb5a2',
  roof: '#8c3f2b',
  dark: '#4a423a',
};

const BASTION_PALETTE: Palette = {
  stone: '#b5b0a4',
  shade: '#a49f93',
  roof: '#43506a',
  dark: '#3b4046',
};

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

/** Open-ended: the roof closes the top and the base is buried in the ground. */
function cylinder(
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
  const geometry = new THREE.ConeGeometry(radius, height, SEGMENTS, 1, true);
  geometry.translate(x, y, z);
  return geometry;
}

/** Side A — wide keep, four round towers with conical roofs, merlons, a gate. */
function buildKeep(palette: Palette): THREE.BufferGeometry[] {
  // The keep is wide enough to meet the towers, so the parts read as one
  // building rather than four posts around a box.
  const keep = 0.62;
  const keepHeight = 0.5;
  const towerRadius = 0.085;
  const towerHeight = 0.78;
  const towerOffset = 0.395;
  const roofRadius = 0.1;
  const roofHeight = 0.2;
  const merlon = 0.07;

  const parts: THREE.BufferGeometry[] = [];

  parts.push(paint(box(keep, keepHeight, keep, 0, keepHeight / 2, 0), palette.stone));
  // Gate, slightly proud of the front wall so it catches light.
  parts.push(paint(box(0.18, 0.28, 0.04, 0, 0.14, keep / 2 + 0.005), palette.dark));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        paint(
          cylinder(
            towerRadius,
            towerRadius * 1.12,
            towerHeight,
            sx * towerOffset,
            towerHeight / 2,
            sz * towerOffset,
          ),
          palette.stone,
        ),
      );
      parts.push(
        paint(
          cone(
            roofRadius,
            roofHeight,
            sx * towerOffset,
            towerHeight + roofHeight / 2,
            sz * towerOffset,
          ),
          palette.roof,
        ),
      );
    }
  }

  // Two merlons per side of the keep: the cheapest way to read as "castle".
  const rim = keep / 2 - merlon / 2;
  for (const sz of [-1, 1]) {
    for (const offset of [-0.18, 0.18]) {
      parts.push(
        paint(
          box(merlon, merlon, merlon, offset, keepHeight + merlon / 2, sz * rim),
          palette.shade,
        ),
      );
    }
  }
  for (const sx of [-1, 1]) {
    for (const offset of [-0.18, 0.18]) {
      parts.push(
        paint(
          box(merlon, merlon, merlon, sx * rim, keepHeight + merlon / 2, offset),
          palette.shade,
        ),
      );
    }
  }

  return parts;
}

/** Side B — one tall round tower with a spire above low square bastions. */
function buildBastion(palette: Palette): THREE.BufferGeometry[] {
  const towerHeight = 0.58;
  const spireHeight = 0.42;
  const bastion = 0.2;
  const bastionHeight = 0.44;
  const offset = 0.36;
  const wallThickness = 0.05;
  const wallHeight = 0.14;

  const parts: THREE.BufferGeometry[] = [];

  // Root radius 0.38 overlaps the curtain walls, so the tower and the ring read
  // as one structure instead of a tower in a separate fence.
  // The tower tapers and the spire is narrower than the bastion ring, or the
  // cone reads as a tent over the whole footprint instead of a tower's roof.
  parts.push(paint(cylinder(0.3, 0.38, towerHeight, 0, towerHeight / 2, 0), palette.stone));
  parts.push(paint(cone(0.32, spireHeight, 0, towerHeight + spireHeight / 2, 0), palette.roof));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        paint(
          box(bastion, bastionHeight, bastion, sx * offset, bastionHeight / 2, sz * offset),
          palette.stone,
        ),
      );
      parts.push(
        paint(box(0.09, 0.08, 0.09, sx * offset, bastionHeight + 0.04, sz * offset), palette.shade),
      );
    }
  }

  // Curtain walls: a square ring, thinner and lower than the bastions.
  for (const sz of [-1, 1]) {
    parts.push(
      paint(
        box(offset * 2, wallHeight, wallThickness, 0, wallHeight / 2, sz * offset),
        palette.shade,
      ),
    );
  }
  for (const sx of [-1, 1]) {
    parts.push(
      paint(
        box(wallThickness, wallHeight, offset * 2, sx * offset, wallHeight / 2, 0),
        palette.shade,
      ),
    );
  }

  // Gate, offset so the tower does not hide it.
  parts.push(paint(box(0.14, 0.2, 0.05, 0.18, 0.1, offset + 0.005), palette.dark));

  return parts;
}

/**
 * A chess tower is the same castle, made tall and narrow: two thirds of a cell
 * across, taller than the tallest piece, so a fortification reads as a landmark
 * and leaves the squares beside it free. The model is stretched rather than cut,
 * which is the price of keeping one set of castles for both modes.
 */
export const TOWER_WIDTH = 0.6;
/** Above 1.7 the tower overtops the tallest piece (the king, at 1.63). */
export const TOWER_HEIGHT = 1.75;

export function towerFromCastle(model: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = model.clone();
  copy.scale(TOWER_WIDTH, TOWER_HEIGHT, TOWER_WIDTH);
  copy.computeBoundingBox();
  copy.computeBoundingSphere();
  return copy;
}

export function createCastleGeometry(variant: CastleVariant = 'keep'): THREE.BufferGeometry {
  const parts = variant === 'bastion' ? buildBastion(BASTION_PALETTE) : buildKeep(KEEP_PALETTE);

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`castle geometry failed to merge (${variant})`);

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
