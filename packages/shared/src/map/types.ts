export type MapSize = 300 | 500 | 800;

export interface MapEntry {
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
