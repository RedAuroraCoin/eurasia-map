/**
 * Land counts a board can have. Eurasia ships 300/500/800; Europe is finer and
 * ships 800/1200/1600, because 800 cells over Europe are the same picture at a
 * smaller scale than 800 over a continent.
 */
export type MapSize = 300 | 500 | 800 | 1200 | 1600;

/**
 * Which part of the world the grid shows. Both regions are built by the same
 * pipeline from the same two public datasets, at the same land counts, so the
 * rules never need to know which one is on the board.
 */
export type RegionId = 'eurasia' | 'europe';

export const REGIONS: readonly RegionId[] = ['eurasia', 'europe'];

export interface MapEntry {
  readonly region: RegionId;
  readonly size: MapSize;
  readonly rows: number;
  readonly cols: number;
  readonly land: number;
  /** Row-major, '#' = land, '.' = sea. */
  readonly mask: string;
  /** Metres above sea level per cell, negative under water. */
  readonly elev: readonly number[];
}

export interface MapConfig {
  readonly bbox: {
    readonly lon0: number;
    readonly lon1: number;
    readonly lat0: number;
    readonly lat1: number;
  };
  readonly sizes: Readonly<
    Record<string, { readonly rows: number; readonly cols: number; readonly land: number }>
  >;
}
