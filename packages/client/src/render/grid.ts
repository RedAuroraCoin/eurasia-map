import { type MapEntry, getMap, type MapSize } from '@eurasia/shared';

/**
 * Grid <-> world. The map is centred on the origin and lies in the XZ plane,
 * one cell per unit, so the camera maths and the tests can both be simple.
 */

export const CELL = 1;

/**
 * Visual exaggeration. At a faithful scale (one cell ~ 200 km) Everest would be
 * 0.04 cells tall; the whole point of a diorama is to lie about that. 5 200 m is
 * five cells tall and a 400 m plain is one and a half, which is the point where
 * the relief reads as volume rather than as a colour map.
 */
export const MAX_VISUAL_HEIGHT = 7;
const ELEVATION_REFERENCE = 5200;
const FLAT_HEIGHT = 0.06;
const SEA_FLOOR = 0.9;

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export function cellToWorld(map: MapEntry, index: number): Point2 {
  const col = index % map.cols;
  const row = Math.floor(index / map.cols);
  return {
    x: (col - map.cols / 2 + 0.5) * CELL,
    z: (row - map.rows / 2 + 0.5) * CELL,
  };
}

/** -1 when the point is outside the board. */
export function worldToCell(map: MapEntry, x: number, z: number): number {
  const col = Math.floor(x / CELL + map.cols / 2);
  const row = Math.floor(z / CELL + map.rows / 2);
  if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) return -1;
  return row * map.cols + col;
}

/**
 * Elevation -> height in world units.
 *
 * A power curve, not a linear scale: an 800 m hill and a 5 000 m plateau have to
 * be tellable apart on a board where the whole of Siberia is eight cells wide.
 */
export function elevationToHeight(elevation: number, relief: boolean): number {
  if (!relief) return FLAT_HEIGHT;
  const above = Math.max(0, elevation);
  const k = Math.min(1, above / ELEVATION_REFERENCE);
  return Math.pow(k, 0.45) * MAX_VISUAL_HEIGHT + FLAT_HEIGHT;
}

/** Sea floor depth in world units, used by the water shader and the 2D preview. */
export function seaDepth(elevation: number): number {
  return Math.min(1, Math.max(0, -elevation / 6000)) * SEA_FLOOR;
}

export function boardSize(map: MapEntry): { width: number; depth: number } {
  return { width: map.cols * CELL, depth: map.rows * CELL };
}

/** The default view: from the south-east, about 50 degrees above the horizon. */
export const VIEW_DIRECTION: readonly [number, number, number] = [0.55, 0.95, 0.62];

const norm = (v: readonly [number, number, number]): [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

const cross = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The exact distance at which the whole board fits the frustum, found by
 * bisection instead of a trigonometric estimate.
 *
 * The estimate is the trap: framing on the diagonal wastes a third of the
 * screen, and framing on the half-extent crops the near edge, which is closer
 * to the camera and therefore projects larger. Projecting the eight corners and
 * solving for the distance has neither problem at any aspect ratio.
 */
export function fitDistance(
  map: MapEntry,
  fovDegrees: number,
  aspect: number,
  margin = 1.06,
  targetY = 0.35,
): number {
  const { width, depth } = boardSize(map);
  const direction = norm(VIEW_DIRECTION);
  const target: [number, number, number] = [0, targetY, 0];
  const forward: [number, number, number] = [-direction[0], -direction[1], -direction[2]];
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);

  const tanV = Math.tan((fovDegrees * Math.PI) / 180 / 2);
  const tanH = tanV * Math.max(0.4, aspect);

  // The board's own corners are open sea, so raising them to the highest peak
  // would push the camera back for nothing. Fit the waterline, then add the one
  // point that can actually stick out: the top of the highest land cell.
  const corners: [number, number, number][] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) corners.push([x, 0, z]);
  }
  let highest = -1;
  let highestElevation = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    const elevation = map.elev[index] ?? 0;
    if (elevation > highestElevation) {
      highestElevation = elevation;
      highest = index;
    }
  }
  if (highest >= 0) {
    const { x, z } = cellToWorld(map, highest);
    corners.push([x, elevationToHeight(highestElevation, true), z]);
  }

  const fits = (distance: number): boolean => {
    const camera: [number, number, number] = [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ];
    return corners.every((corner) => {
      const rel: [number, number, number] = [
        corner[0] - camera[0],
        corner[1] - camera[1],
        corner[2] - camera[2],
      ];
      const forwardDepth = rel[0] * forward[0] + rel[1] * forward[1] + rel[2] * forward[2];
      if (forwardDepth <= 0.2) return false;
      const x = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
      const y = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
      return Math.abs(x) <= forwardDepth * tanH && Math.abs(y) <= forwardDepth * tanV;
    });
  };

  let low = 1;
  let high = 600;
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) high = middle;
    else low = middle;
  }
  return high * margin;
}

export const mapFor = getMap;

export type { MapSize, MapEntry };
