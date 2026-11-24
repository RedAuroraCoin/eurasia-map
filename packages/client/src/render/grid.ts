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
export interface LandBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The box the *land* occupies, in world units, or null on a board with no land.
 *
 * The grid is a rectangle of water with a continent inside it — Europe's frame, in
 * particular, is a third empty Atlantic. Fitting the camera to the grid leaves the
 * land as a strip across the middle of a phone screen; fitting it to the land puts
 * the map where the player is looking.
 */
export function landBounds(map: MapEntry): LandBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    const { x, z } = cellToWorld(map, index);
    minX = Math.min(minX, x - CELL / 2);
    maxX = Math.max(maxX, x + CELL / 2);
    minZ = Math.min(minZ, z - CELL / 2);
    maxZ = Math.max(maxZ, z + CELL / 2);
  }

  return Number.isFinite(minX) ? { minX, maxX, minZ, maxZ } : null;
}

/**
 * Where the flat view puts the board. Whole pixels per cell, so the grid stays crisp,
 * and the land centred in the viewport where the clamp allows it: a phone held upright
 * is much taller than a board, and centring on the water margin instead of the land
 * pushes the map up or down for nothing.
 */
export function flatLayout(
  map: MapEntry,
  width: number,
  height: number,
): { cell: number; ox: number; oy: number } {
  const cell = Math.max(2, Math.floor(Math.min(width / map.cols, height / map.rows)));
  const boardWidth = cell * map.cols;
  const boardHeight = cell * map.rows;

  const bounds = landBounds(map);
  const landX = bounds ? ((bounds.minX + bounds.maxX) / 2 + map.cols / 2) * cell : boardWidth / 2;
  const landY = bounds ? ((bounds.minZ + bounds.maxZ) / 2 + map.rows / 2) * cell : boardHeight / 2;

  // A board that fits must stay fully on screen; one that does not may be centred
  // on the land and cropped, but never past its own edges.
  const clamp = (value: number, size: number, board: number): number =>
    board <= size
      ? Math.min(size - board, Math.max(0, Math.round(value)))
      : Math.min(0, Math.max(size - board, Math.round(value)));

  return {
    cell,
    ox: clamp(width / 2 - landX, width, boardWidth),
    oy: clamp(height / 2 - landY, height, boardHeight),
  };
}

/** What the camera should look at: the middle of the land, not the middle of the grid. */
export function fitTarget(map: MapEntry, height = 0.35): [number, number, number] {
  const bounds = landBounds(map);
  if (!bounds) return [0, height, 0];
  return [(bounds.minX + bounds.maxX) / 2, height, (bounds.minZ + bounds.maxZ) / 2];
}

export function fitDistance(
  map: MapEntry,
  fovDegrees: number,
  aspect: number,
  margin = 1.06,
  target: [number, number, number] = fitTarget(map),
): number {
  const { width, depth } = boardSize(map);
  const direction = norm(VIEW_DIRECTION);
  const forward: [number, number, number] = [-direction[0], -direction[1], -direction[2]];
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);

  const tanV = Math.tan((fovDegrees * Math.PI) / 180 / 2);
  const tanH = tanV * Math.max(0.4, aspect);

  // The land's own corners, not the grid's: the sea around it may run off the edge
  // of the screen, and on a narrow one it has to, or the map is a stripe. The
  // waterline is fitted, then the one point that can stick out — the highest cell.
  const bounds = landBounds(map) ?? {
    minX: -width / 2,
    maxX: width / 2,
    minZ: -depth / 2,
    maxZ: depth / 2,
  };
  const corners: [number, number, number][] = [];
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) corners.push([x, 0, z]);
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
