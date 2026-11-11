import { MAP_CONFIG, MAP_DATA } from './data';
import type { MapConfig, MapEntry, MapSize } from './types';

export { MAP_CONFIG, MAP_DATA };
export type { MapConfig, MapEntry, MapSize };

export const MAP_SIZES: readonly MapSize[] = [300, 500, 800];

const bySize = new Map<number, MapEntry>();
for (const entry of MAP_DATA) bySize.set(entry.size, entry as MapEntry);

export function getMap(size: MapSize): MapEntry {
  const map = bySize.get(size);
  if (map === undefined) throw new Error(`no map data for size ${size}`);
  return map;
}

export const cellCount = (map: MapEntry): number => map.rows * map.cols;

export const cellIndex = (map: MapEntry, row: number, col: number): number => row * map.cols + col;

export const cellRow = (map: MapEntry, index: number): number => Math.floor(index / map.cols);
export const cellCol = (map: MapEntry, index: number): number => index % map.cols;

export const isLand = (map: MapEntry, index: number): boolean => map.mask[index] === '#';

export const elevationAt = (map: MapEntry, index: number): number => map.elev[index] ?? 0;

export type Rgb = readonly [number, number, number];

/**
 * Colour in 0..255, as CSS wants it — and *not* what three's `Color.setRGB`
 * wants. The distinction is not cosmetic: passing 0..255 to setRGB clamps every
 * channel to 1 and the whole map renders solid white.
 */
export type Rgb255 = Rgb;

function ramp(stops: readonly (readonly [number, Rgb])[], t: number): Rgb {
  if (t <= (stops[0]?.[0] ?? 0)) return stops[0]?.[1] ?? [0, 0, 0];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (prev === undefined || next === undefined) break;
    if (t <= next[0]) {
      const span = next[0] - prev[0] || 1;
      const k = (t - prev[0]) / span;
      return [
        Math.round(prev[1][0] + (next[1][0] - prev[1][0]) * k),
        Math.round(prev[1][1] + (next[1][1] - prev[1][1]) * k),
        Math.round(prev[1][2] + (next[1][2] - prev[1][2]) * k),
      ];
    }
  }
  return stops[stops.length - 1]?.[1] ?? [0, 0, 0];
}

/** Unclaimed land: green -> olive -> brown -> grey -> snow. */
// Spread over the range that actually occurs: 95% of Eurasia is below 2 000 m,
// so a ramp that only turns brown above 1 200 m reads as one flat green field.
const LAND_STOPS: readonly (readonly [number, Rgb])[] = [
  [0, [79, 107, 51]],
  [200, [95, 122, 58]],
  [600, [125, 138, 69]],
  [1000, [154, 139, 84]],
  [1600, [168, 132, 92]],
  [2400, [156, 138, 120]],
  [3200, [176, 170, 162]],
  [4200, [214, 211, 205]],
  [5200, [244, 244, 242]],
];

const SEA_STOPS: readonly (readonly [number, Rgb])[] = [
  [-9000, [10, 24, 52]],
  [-5000, [14, 40, 82]],
  [-2500, [21, 62, 116]],
  [-800, [32, 91, 148]],
  [-200, [46, 118, 170]],
  [0, [78, 152, 196]],
];

export const landColor = (elevation: number): Rgb255 => ramp(LAND_STOPS, elevation);
export const seaColor = (elevation: number): Rgb255 => ramp(SEA_STOPS, elevation);

/** Colour for any cell, land or sea, used by the 2D preview and the low tier. */
export function cellColor(map: MapEntry, index: number): Rgb255 {
  const e = elevationAt(map, index);
  return isLand(map, index) ? landColor(e) : seaColor(e);
}

export const cssRgb = (c: Rgb): string => `rgb(${c[0]} ${c[1]} ${c[2]})`;
