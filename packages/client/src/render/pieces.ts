import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceKind } from '@eurasia/shared';

/**
 * Chess pieces, built as turned solids.
 *
 * Every body is a lathe profile — base plate, bevel, stem, collar — the way a
 * Staunton set is turned. The heads are the few solids that cannot be turned: a
 * ball for the pawn, battlements for the rook, a mitre for the bishop, a coronet
 * for the queen, a cross for the king. The knight is the one piece with no
 * rotational symmetry at all, so it is an extruded side silhouette: a horse's
 * head on the same turned foot.
 */

export type UnitRole = PieceKind | 'tower';

/** What the scene needs to draw one piece or tower. */
export interface UnitInstance {
  readonly id: number;
  readonly role: UnitRole;
  readonly side: 0 | 1;
  readonly cell: number;
}

type Profile = readonly (readonly [number, number])[];

/** Turned body: a profile rotated around its axis, bottom to top. */
function lathe(profile: Profile, segments = 20): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([radius, height]) => new THREE.Vector2(radius, height)),
    segments,
  );
}

/** The footing every piece shares: wide plate, bevel, then a narrow stem. */
const FOOT: Profile = [
  [0, 0],
  [0.155, 0],
  [0.155, 0.035],
  [0.12, 0.075],
  [0.085, 0.1],
];

/** Stem and collar, the part under every head. */
const STEM: Profile = [
  [0.085, 0.1],
  [0.07, 0.16],
  [0.075, 0.2],
  [0.105, 0.235],
  [0.105, 0.265],
  [0.085, 0.29],
];

const body = (top: Profile): Profile => [...FOOT, ...STEM, ...top];

/** Crenellations: blocks around the rim, each turned to face outwards. */
function battlements(radius: number, height: number, count = 6): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    out.push(
      new THREE.BoxGeometry(0.062, 0.085, 0.05)
        .rotateY(-angle)
        .translate(radius * Math.cos(angle), height, radius * Math.sin(angle)),
    );
  }
  return out;
}

/** The saw-tooth crown of the queen. */
function coronetPoints(radius: number, height: number, count = 8): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    out.push(
      new THREE.ConeGeometry(0.026, 0.075, 8).translate(
        radius * Math.cos(angle),
        height,
        radius * Math.sin(angle),
      ),
    );
  }
  return out;
}

/** The horse's head, as a side silhouette extruded through the body. */
function knightHead(): THREE.BufferGeometry {
  const outline: readonly (readonly [number, number])[] = [
    [-0.075, 0],
    [-0.085, 0.12],
    [-0.075, 0.24],
    [-0.045, 0.34],
    [-0.03, 0.44],
    [-0.005, 0.36],
    [0.03, 0.46],
    [0.05, 0.33],
    [0.09, 0.24],
    [0.15, 0.16],
    [0.165, 0.1],
    [0.13, 0.075],
    [0.075, 0.085],
    [0.03, 0.05],
    [0.01, 0],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(outline[0]![0] as number, outline[0]![1] as number);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.14,
    bevelEnabled: false,
    steps: 1,
  });
  // Centre it across the cell and stand it on the foot.
  geometry.translate(0, 0.1, -0.07);
  return geometry;
}

function build(role: UnitRole): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  switch (role) {
    case 'pawn': {
      parts.push(
        lathe(
          body([
            [0.085, 0.3],
            [0.11, 0.33],
            [0.11, 0.36],
            [0.06, 0.39],
            [0, 0.4],
          ]),
        ),
      );
      // The head is a ball sitting in the collar.
      parts.push(new THREE.SphereGeometry(0.105, 20, 14).translate(0, 0.47, 0));
      break;
    }

    case 'rook': {
      parts.push(
        lathe(
          body([
            [0.085, 0.34],
            [0.13, 0.37],
            [0.135, 0.44],
            [0.135, 0.46],
            [0.11, 0.47],
            [0, 0.47],
          ]),
        ),
      );
      parts.push(...battlements(0.115, 0.5));
      break;
    }

    case 'bishop': {
      parts.push(
        lathe(
          body([
            [0.085, 0.32],
            [0.115, 0.35],
            [0.115, 0.38],
            [0.095, 0.41],
            [0.085, 0.47],
            [0.05, 0.55],
            [0, 0.6],
          ]),
        ),
      );
      parts.push(new THREE.SphereGeometry(0.035, 12, 10).translate(0, 0.6, 0));
      break;
    }

    case 'queen': {
      parts.push(
        lathe(
          body([
            [0.085, 0.34],
            [0.125, 0.37],
            [0.125, 0.4],
            [0.1, 0.43],
            [0.1, 0.47],
            [0.12, 0.49],
            [0, 0.49],
          ]),
        ),
      );
      parts.push(...coronetPoints(0.1, 0.5));
      parts.push(new THREE.SphereGeometry(0.04, 14, 10).translate(0, 0.55, 0));
      break;
    }

    case 'king': {
      parts.push(
        lathe(
          body([
            [0.085, 0.36],
            [0.13, 0.39],
            [0.13, 0.43],
            [0.105, 0.46],
            [0.105, 0.5],
            [0.125, 0.52],
            [0, 0.52],
          ]),
        ),
      );
      // The cross: the one piece whose crown carries a symbol.
      parts.push(new THREE.BoxGeometry(0.035, 0.16, 0.035).translate(0, 0.6, 0));
      parts.push(new THREE.BoxGeometry(0.115, 0.035, 0.035).translate(0, 0.62, 0));
      break;
    }

    case 'knight': {
      parts.push(lathe([...FOOT, [0.085, 0.1], [0.085, 0.13], [0, 0.13]]));
      parts.push(knightHead());
      break;
    }

    case 'tower': {
      // A fortification, not a piece: the same turned foot under a squat drum.
      parts.push(lathe([...FOOT, [0.085, 0.1], [0.15, 0.14], [0.16, 0.36], [0, 0.36]]));
      parts.push(...battlements(0.14, 0.38, 6));
      break;
    }

    default:
      break;
  }

  // Lathe and extrude produce indexed geometry, boxes and spheres do not;
  // mergeGeometries refuses a mixed batch, and the fallback is a spear of a
  // pawn nobody notices until the board is on screen.
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat, false);
  for (const part of flat) part.dispose();
  return merged ?? new THREE.SphereGeometry(0.1, 8, 6);
}

/**
 * Pieces are read from across a continent and the camera sits back: sculpted at
 * 1x they were specks. Everything is scaled once here, not per instance, so the
 * instanced meshes and their bounding boxes agree.
 */
export const PIECE_SCALE = 2.4;

const cache = new Map<UnitRole, THREE.BufferGeometry>();

export function unitGeometry(role: UnitRole): THREE.BufferGeometry {
  const existing = cache.get(role);
  if (existing) return existing;
  const made = build(role);
  made.scale(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
  made.computeBoundingBox();
  cache.set(role, made);
  return made;
}

export const SIDE_COLOURS = ['#efe6d2', '#2f3742'] as const;
/**
 * Towers are per side even in the fallback: the castles they stand in for are a
 * purple darkstone on one side and a golden sandstone on the other, which is how
 * the flat view and a missing model stay readable.
 */
export const TOWER_COLOURS = ['#8f7fa8', '#c9a86a'] as const;
/** Kept for the flat view's shadow and any single-colour use. */
export const TOWER_COLOUR = TOWER_COLOURS[0];

/** Colour of a piece, with the dark side lifted a little so it is not a hole. */
export function unitColour(role: UnitRole, side: 0 | 1): string {
  return role === 'tower' ? TOWER_COLOURS[side] : SIDE_COLOURS[side];
}
