import { describe, expect, it } from 'vitest';
import rawConfig from '../../../../data/maps.config.json';
import { MAP_CONFIG, MAP_DATA, MAP_SIZES, cellCount, elevationAt, getMap, isLand } from './index';
import type { MapEntry } from './types';

interface Config {
  bbox: { lon0: number; lon1: number; lat0: number; lat1: number };
  sizes: Record<string, { rows: number; cols: number; land: number }>;
}

const config = rawConfig as unknown as Config;

/** Cell -> geographic centre, using the same squeeze-to-bbox mapping as the pipeline. */
function centre(map: MapEntry, index: number): { lon: number; lat: number } {
  const { lon0, lon1, lat0, lat1 } = config.bbox;
  const col = index % map.cols;
  const row = Math.floor(index / map.cols);
  return {
    lon: lon0 + ((col + 0.5) / map.cols) * (lon1 - lon0),
    lat: lat1 - ((row + 0.5) / map.rows) * (lat1 - lat0),
  };
}

function cellAt(map: MapEntry, lon: number, lat: number): number {
  const { lon0, lon1, lat0, lat1 } = config.bbox;
  const col = Math.floor(((lon - lon0) / (lon1 - lon0)) * map.cols);
  const row = Math.floor(((lat1 - lat) / (lat1 - lat0)) * map.rows);
  return row * map.cols + col;
}

describe('generated data matches the committed config', () => {
  it('has one entry per advertised size', () => {
    expect(MAP_DATA.map((m) => m.size).sort()).toEqual([...MAP_SIZES].sort());
  });

  it('embeds the same config the pipeline read', () => {
    expect(MAP_CONFIG.bbox).toEqual(config.bbox);
    for (const [size, expected] of Object.entries(config.sizes)) {
      expect(MAP_CONFIG.sizes[size]).toEqual(expected);
    }
  });

  for (const size of MAP_SIZES) {
    describe(`size ${size}`, () => {
      const map = getMap(size);

      it('has the configured grid and land count', () => {
        expect(map.rows).toBe(config.sizes[String(size)]?.rows);
        expect(map.cols).toBe(config.sizes[String(size)]?.cols);
        expect(map.mask).toHaveLength(cellCount(map));
        expect(map.elev).toHaveLength(cellCount(map));
        expect([...map.mask].filter((c) => c === '#')).toHaveLength(map.land);
        expect(map.land).toBe(config.sizes[String(size)]?.land);
      });

      it('contains only the two mask characters', () => {
        expect(map.mask).toMatch(/^[#.]+$/);
      });

      it('has plausible elevations', () => {
        for (const value of map.elev) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(-11_500);
          expect(value).toBeLessThan(8_900);
        }
      });

      it('puts the highest cell in the Tibetan plateau / Himalaya region', () => {
        let best = 0;
        for (let i = 1; i < map.elev.length; i++) {
          if ((map.elev[i] ?? -Infinity) > (map.elev[best] ?? -Infinity)) best = i;
        }
        expect(isLand(map, best)).toBe(true);
        const { lon, lat } = centre(map, best);
        expect(lon).toBeGreaterThan(65);
        expect(lon).toBeLessThan(110);
        expect(lat).toBeGreaterThan(25);
        expect(lat).toBeLessThan(45);
      });

      it('keeps the open ocean wet', () => {
        // middle of the North Atlantic and the Bay of Bengal, far from any coast
        expect(isLand(map, cellAt(map, -30, 40))).toBe(false);
        expect(isLand(map, cellAt(map, 88, 15))).toBe(false);
      });

      it('keeps the great rivers and capitals on land', () => {
        expect(isLand(map, cellAt(map, 37.6, 55.75))).toBe(true); // Moscow
        expect(isLand(map, cellAt(map, 116.4, 39.9))).toBe(true); // Beijing
        expect(isLand(map, cellAt(map, 77.2, 28.6))).toBe(true); // Delhi
        expect(isLand(map, cellAt(map, 60.6, 56.8))).toBe(true); // Yekaterinburg
      });

      it('is flat enough to index directly', () => {
        expect(elevationAt(map, 0)).toBe(map.elev[0]);
      });
    });
  }
});
