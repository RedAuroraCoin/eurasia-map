import { type MapEntry, getMap, type MapSize } from '@eurasia/shared';

/**
 * Grid <-> world. The map is centred on the origin and lies in the XZ plane,
 * one cell per unit, so the camera maths and the tests can both be simple.
 */

export const CELL = 1;

/** Visual exaggeration: 5 000 m of Tibet is about one cell tall. */
export const MAX_VISUAL_HEIGHT = 1.1;
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
  return Math.pow(k, 0.78) * MAX_VISUAL_HEIGHT + FLAT_HEIGHT * 0.5;
}

/** Sea floor depth in world units, used by the water shader and the 2D preview. */
export function seaDepth(elevation: number): number {
  return Math.min(1, Math.max(0, -elevation / 6000)) * SEA_FLOOR;
}

export function boardSize(map: MapEntry): { width: number; depth: number } {
  return { width: map.cols * CELL, depth: map.rows * CELL };
}

/** The camera has to fit the board's diagonal in view, whatever the aspect. */
export function fitDistance(
  map: MapEntry,
  fovDegrees: number,
  aspect: number,
  margin = 1.25,
): number {
  const { width, depth } = boardSize(map);
  const radius = Math.hypot(width, depth) / 2;
  const vertical = (fovDegrees * Math.PI) / 180;
  const byHeight = radius / Math.tan(vertical / 2);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(0.4, aspect));
  const byWidth = radius / Math.tan(horizontal / 2);
  return Math.max(byHeight, byWidth) * margin;
}

export const mapFor = getMap;

export type { MapSize, MapEntry };
