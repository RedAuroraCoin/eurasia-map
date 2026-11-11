import { getMap, MAP_SIZES } from '@eurasia/shared';
import { describe, expect, it } from 'vitest';
import {
  boardSize,
  cellToWorld,
  elevationToHeight,
  fitDistance,
  seaDepth,
  worldToCell,
} from './grid';

describe('cellToWorld', () => {
  const map = getMap(800);

  it('centres the board on the origin', () => {
    const first = cellToWorld(map, 0);
    const last = cellToWorld(map, map.rows * map.cols - 1);
    expect(first.x).toBeCloseTo(-map.cols / 2 + 0.5, 6);
    expect(first.z).toBeCloseTo(-map.rows / 2 + 0.5, 6);
    expect(last.x).toBeCloseTo(map.cols / 2 - 0.5, 6);
    expect(last.z).toBeCloseTo(map.rows / 2 - 0.5, 6);
  });

  it('round-trips through worldToCell for every cell', () => {
    for (let index = 0; index < map.rows * map.cols; index++) {
      const { x, z } = cellToWorld(map, index);
      expect(worldToCell(map, x, z)).toBe(index);
    }
  });

  it('rejects points outside the board', () => {
    expect(worldToCell(map, -100, 0)).toBe(-1);
    expect(worldToCell(map, 0, 100)).toBe(-1);
    expect(worldToCell(map, 100, -100)).toBe(-1);
  });

  it('reports the board size', () => {
    expect(boardSize(map)).toEqual({ width: map.cols, depth: map.rows });
  });
});

describe('elevationToHeight', () => {
  it('grows with elevation and flattens under water', () => {
    expect(elevationToHeight(0, true)).toBeLessThan(elevationToHeight(1000, true));
    expect(elevationToHeight(1000, true)).toBeLessThan(elevationToHeight(5000, true));
    expect(elevationToHeight(-4000, true)).toBe(elevationToHeight(-9000, true));
  });

  it('keeps the plateau visible but not silly', () => {
    const tibet = elevationToHeight(5000, true);
    expect(tibet).toBeGreaterThan(1.5);
    expect(tibet).toBeLessThan(3);
    // a hill has to be clearly taller than a plain, or the board reads as flat
    expect(elevationToHeight(1500, true)).toBeGreaterThan(elevationToHeight(300, true) * 2);
  });

  it('uses most of the height range where the land actually is', () => {
    const plain = elevationToHeight(300, true);
    const hill = elevationToHeight(1200, true);
    const plateau = elevationToHeight(4500, true);
    expect(hill - plain).toBeGreaterThan(0.3);
    expect(plateau - plain).toBeGreaterThan(1.2);
  });

  it('returns a flat slab when relief is off', () => {
    expect(elevationToHeight(0, false)).toBe(elevationToHeight(5000, false));
    expect(elevationToHeight(0, false)).toBeGreaterThan(0);
  });
});

describe('seaDepth', () => {
  it('is zero at the shore and deep in the ocean', () => {
    expect(seaDepth(0)).toBe(0);
    expect(seaDepth(500)).toBe(0);
    expect(seaDepth(-3000)).toBeGreaterThan(0.3);
    expect(seaDepth(-9000)).toBeLessThanOrEqual(1);
  });
});

describe('fitDistance', () => {
  it('grows with the map and shrinks with the field of view', () => {
    const small = fitDistance(getMap(MAP_SIZES[0] ?? 300), 36, 1.6);
    const large = fitDistance(getMap(MAP_SIZES[2] ?? 800), 36, 1.6);
    expect(large).toBeGreaterThan(small);
    expect(fitDistance(getMap(800), 60, 1.6)).toBeLessThan(fitDistance(getMap(800), 30, 1.6));
  });

  it('leaves the board inside the frustum on a narrow screen', () => {
    const distance = fitDistance(getMap(800), 36, 0.5);
    const diagonal = Math.hypot(44, 36) / 2;
    expect(distance).toBeGreaterThan(diagonal);
  });
});
