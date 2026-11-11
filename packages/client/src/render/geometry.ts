import {
  BALANCE,
  cellHeight,
  landColor,
  type GameState,
  type MapEntry,
  type Rgb,
} from '@eurasia/shared';
import { CELL, cellToWorld, elevationToHeight, seaDepth } from './grid';

/**
 * Pure builders: state in, numbers out.
 *
 * The scene file turns these into three.js objects; keeping the arithmetic here
 * means the interesting part — where a building stands, how tall it is, how the
 * coast is shaped — is testable without a GPU.
 */

export const OWNER_TINT: Rgb = [0.93, 0.66, 0.3];
const OWNER_MIX = 0.34;

export interface TerrainInstance {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly color: Rgb;
}

export interface BuildingInstance {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly width: number;
  readonly scale: number;
}

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Only land becomes a slab; the sea is a single shader plane. */
export function buildTerrain(
  map: MapEntry,
  relief: boolean,
  cells: Readonly<Record<string, { readonly o: number }>> = {},
): TerrainInstance[] {
  const out: TerrainInstance[] = [];
  for (let index = 0; index < map.rows * map.cols; index++) {
    if (map.mask[index] !== '#') continue;
    const { x, z } = cellToWorld(map, index);
    const elevation = map.elev[index] ?? 0;
    const height = elevationToHeight(elevation, relief);
    const base = landColor(elevation);
    const color = cells[String(index)] ? mix(base, OWNER_TINT, OWNER_MIX) : base;
    out.push({ index, x, y: height / 2, z, height, color });
  }
  return out;
}

/** Building height in world units at full growth. */
const BUILDING_MAX = 0.78;
const BUILDING_FOOTPRINT = 0.56;

/**
 * The little overshoot right after a claim. Returns 1 outside the animation
 * window, so callers can multiply unconditionally.
 */
export function popScale(bornAt: number, now: number, popMs = BALANCE.growth.popMs): number {
  const t = (now - bornAt) / popMs;
  if (!Number.isFinite(t) || t < 0 || t > 1) return 1;
  return 1 + 0.55 * Math.sin(Math.PI * t) * (1 - t) * (1 - t);
}

export function buildBuildings(
  map: MapEntry,
  state: GameState,
  now: number,
  relief: boolean,
): BuildingInstance[] {
  const out: BuildingInstance[] = [];
  for (const key of Object.keys(state.cells)) {
    const index = Number(key);
    const cell = state.cells[key];
    if (!cell || !Number.isInteger(index) || index < 0 || index >= map.rows * map.cols) continue;
    if (map.mask[index] !== '#') continue;

    const { x, z } = cellToWorld(map, index);
    const ground = elevationToHeight(map.elev[index] ?? 0, relief);
    const grown = cellHeight(index, cell.t, now);
    const scale = grown * popScale(cell.t, now);
    const height = Math.max(0.02, BUILDING_MAX * scale);

    out.push({
      index,
      x,
      y: ground + height / 2,
      z,
      height,
      width: BUILDING_FOOTPRINT * CELL,
      scale: grown,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Per-cell sea depth as a byte texture: 0 at the shore, 255 in the abyss.
 * The water shader samples this to colour itself and to place the surf.
 */
export function depthTextureData(map: MapEntry): Uint8Array {
  const data = new Uint8Array(map.rows * map.cols);
  for (let index = 0; index < data.length; index++) {
    const elevation = map.elev[index] ?? 0;
    const depth = map.mask[index] === '#' ? 0 : seaDepth(elevation);
    data[index] = Math.round(Math.min(1, Math.max(0, depth)) * 255);
  }
  return data;
}

/** Cells the player owns, for O(1) lookups in the render loop. */
export function ownedSet(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const key of Object.keys(state.cells)) out.add(Number(key));
  return out;
}
