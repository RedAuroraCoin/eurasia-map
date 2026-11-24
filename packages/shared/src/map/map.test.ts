import { describe, expect, it } from 'vitest';
import rawConfig from '../../../../data/maps.config.json';
import {
  MAP_CONFIG,
  MAP_CONFIGS,
  MAP_DATA,
  MAP_SIZES,
  REGIONS,
  cellCount,
  elevationAt,
  getMap,
  isLand,
  mapConfigFor,
  sizesFor,
} from './index';
import type { MapEntry, RegionId } from './types';

interface RegionConfig {
  bbox: { lon0: number; lon1: number; lat0: number; lat1: number };
  sizes: Record<string, { rows: number; cols: number; land: number }>;
}

const config = rawConfig as unknown as { regions: Record<RegionId, RegionConfig> };

/** Cell -> geographic centre, using the same squeeze-to-bbox mapping as the pipeline. */
function centre(map: MapEntry, index: number): { lon: number; lat: number } {
  const { lon0, lon1, lat0, lat1 } = mapConfigFor(map.region).bbox;
  const col = index % map.cols;
  const row = Math.floor(index / map.cols);
  return {
    lon: lon0 + ((col + 0.5) / map.cols) * (lon1 - lon0),
    lat: lat1 - ((row + 0.5) / map.rows) * (lat1 - lat0),
  };
}

function cellAt(map: MapEntry, lon: number, lat: number): number {
  const { lon0, lon1, lat0, lat1 } = mapConfigFor(map.region).bbox;
  const col = Math.min(
    map.cols - 1,
    Math.max(0, Math.floor(((lon - lon0) / (lon1 - lon0)) * map.cols)),
  );
  const row = Math.min(
    map.rows - 1,
    Math.max(0, Math.floor(((lat1 - lat) / (lat1 - lat0)) * map.rows)),
  );
  return row * map.cols + col;
}

const highestCell = (map: MapEntry): number => {
  let best = 0;
  for (let i = 1; i < map.elev.length; i++) {
    if ((map.elev[i] ?? -Infinity) > (map.elev[best] ?? -Infinity)) best = i;
  }
  return best;
};

/** What each region is expected to show, so a broken build cannot pass quietly. */
const EXPECTATIONS: Record<
  RegionId,
  {
    readonly peak: { lon: [number, number]; lat: [number, number]; name: string };
    readonly wet: readonly (readonly [number, number])[];
    readonly cities: readonly (readonly [number, number, string])[];
  }
> = {
  eurasia: {
    peak: { lon: [65, 110], lat: [25, 45], name: 'Tibet / Himalaya' },
    wet: [
      [-30, 40],
      [88, 15],
    ],
    cities: [
      [37.6, 55.75, 'Moscow'],
      [116.4, 39.9, 'Beijing'],
      [77.2, 28.6, 'Delhi'],
      [60.6, 56.8, 'Yekaterinburg'],
    ],
  },
  europe: {
    // Eastern Anatolia: the frame now reaches far enough east to take in Ararat,
    // so the highest average cell on the board sits there, not in the Alps.
    peak: { lon: [38, 46], lat: [37, 41], name: 'the Armenian highlands' },
    wet: [
      [-20, 48],
      [18, 35],
      [30, 34],
    ],
    // Inland capitals only: at this cell size a coastal city can fall into the
    // sea through rounding, which says nothing about the map.
    cities: [
      [2.35, 48.85, 'Paris'],
      [13.4, 52.5, 'Berlin'],
      [-3.7, 40.4, 'Madrid'],
      [21.0, 52.2, 'Warsaw'],
    ],
  },
};

describe('generated data matches the committed config', () => {
  it('has one entry per region and size', () => {
    const keys = MAP_DATA.map((m) => `${m.region}:${m.size}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const region of REGIONS) {
      expect(MAP_DATA.filter((m) => m.region === region)).toHaveLength(sizesFor(region).length);
      expect(sizesFor(region).length).toBeGreaterThan(0);
    }
    // The original map keeps the sizes the game has always advertised.
    expect(sizesFor('eurasia')).toEqual([...MAP_SIZES]);
  });

  it('gives Europe finer boards than Eurasia, at the same kind of cost', () => {
    // Europe is a third of the area of the frame, so the same cell count would be
    // a coarser picture: its boards start where Eurasia's end.
    expect(sizesFor('europe')).toEqual([800, 1200, 1600]);
    for (const region of REGIONS) {
      for (const size of sizesFor(region)) {
        const map = getMap(size, region);
        expect(map.land).toBe(size);
      }
    }
  });

  it('embeds the same config the pipeline read', () => {
    for (const region of REGIONS) {
      expect(MAP_CONFIGS[region].bbox).toEqual(config.regions[region]?.bbox);
      for (const [size, expected] of Object.entries(config.regions[region]?.sizes ?? {})) {
        expect(MAP_CONFIGS[region].sizes[size]).toEqual(expected);
      }
    }
    // The original map is still reachable by its old name.
    expect(MAP_CONFIG).toBe(MAP_CONFIGS.eurasia);
  });

  it('keeps the original map as the default', () => {
    expect(getMap(800).region).toBe('eurasia');
    expect(getMap(800, 'europe').region).toBe('europe');
  });

  for (const region of REGIONS) {
    describe(region, () => {
      for (const size of sizesFor(region)) {
        describe(`size ${size}`, () => {
          const map = getMap(size, region);
          const expected = config.regions[region]?.sizes[String(size)];

          it('has the configured grid and land count', () => {
            expect(map.rows).toBe(expected?.rows);
            expect(map.cols).toBe(expected?.cols);
            expect(map.mask).toHaveLength(cellCount(map));
            expect(map.elev).toHaveLength(cellCount(map));
            expect([...map.mask].filter((c) => c === '#')).toHaveLength(map.land);
            // The whole point of the second map: the same number of cells to play on.
            expect(map.land).toBe(size);
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

          it('has its highest cell on land, high up', () => {
            const best = highestCell(map);
            expect(isLand(map, best)).toBe(true);
            expect(map.elev[best] ?? 0).toBeGreaterThan(1400);
          });

          it('puts the peak of the largest map where the mountains are', () => {
            if (size !== 800) return;
            const best = highestCell(map);
            const { lon, lat } = centre(map, best);
            const { peak } = EXPECTATIONS[region];
            // A coarse grid averages a range with its foothills, so only the
            // 800-cell map is asked to name the range precisely.
            expect(lon).toBeGreaterThan(peak.lon[0]);
            expect(lon).toBeLessThan(peak.lon[1]);
            expect(lat).toBeGreaterThan(peak.lat[0]);
            expect(lat).toBeLessThan(peak.lat[1]);
          });

          it('keeps the open sea wet', () => {
            for (const [lon, lat] of EXPECTATIONS[region].wet) {
              expect(isLand(map, cellAt(map, lon as number, lat as number))).toBe(false);
            }
          });

          it('keeps the capitals on land', () => {
            for (const [lon, lat, name] of EXPECTATIONS[region].cities) {
              expect({ name, land: isLand(map, cellAt(map, lon, lat)) }).toEqual({
                name,
                land: true,
              });
            }
          });

          it('is flat enough to index directly', () => {
            expect(elevationAt(map, 0)).toBe(map.elev[0]);
          });
        });
      }
    });
  }
});
