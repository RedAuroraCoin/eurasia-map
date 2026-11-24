import { describe, expect, it } from 'vitest';
import { NOISE_SIZE, NOISE_SEED, createNoiseTexture } from './noise';

/**
 * The sea's noise. Three promises matter: it is the same on every device, it tiles
 * without a seam, and it actually varies — a flat texture would be worse than the
 * sine waves it replaced.
 */

const bytes = (texture: ReturnType<typeof createNoiseTexture>): Uint8Array =>
  texture.image.data as Uint8Array;

/** The red channel as a square grid, for comparing opposite edges. */
const channel = (data: Uint8Array, size: number, offset: number): number[][] => {
  const grid: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) row.push(data[(y * size + x) * 4 + offset] ?? 0);
    grid.push(row);
  }
  return grid;
};

describe('the sea noise texture', () => {
  it('is the same texture on every load and every device', () => {
    const first = bytes(createNoiseTexture(32));
    const second = bytes(createNoiseTexture(32));
    expect(first.length).toBe(second.length);
    expect(Array.from(first.slice(0, 400))).toEqual(Array.from(second.slice(0, 400)));

    // A different seed must produce a different sea, or the seed would be a lie.
    const other = bytes(createNoiseTexture(32, NOISE_SEED + 1));
    expect(Array.from(other.slice(0, 400))).not.toEqual(Array.from(first.slice(0, 400)));
  });

  it('is opaque, RGBA and the size that was asked for', () => {
    const texture = createNoiseTexture(64);
    const data = bytes(texture);

    expect(texture.image.width).toBe(64);
    expect(texture.image.height).toBe(64);
    expect(data.length).toBe(64 * 64 * 4);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('tiles: the wrap step is no bigger than a normal step', () => {
    const size = 64;
    const grid = channel(bytes(createNoiseTexture(size)), size, 0);

    // Adjacent columns differ by one sample of a smooth field; the wrap must look
    // like just another step, not like a seam.
    const step = (a: number[], b: number[]): number =>
      a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) / a.length;

    let typical = 0;
    for (let x = 0; x < size - 1; x++) {
      typical += step(
        grid.map((row) => row[x] ?? 0),
        grid.map((row) => row[x + 1] ?? 0),
      );
    }
    typical /= size - 1;

    const wrapColumns = step(
      grid.map((row) => row[size - 1] ?? 0),
      grid.map((row) => row[0] ?? 0),
    );
    const wrapRows = step(grid[size - 1] ?? [], grid[0] ?? []);

    expect(wrapColumns).toBeLessThan(typical * 1.8);
    expect(wrapRows).toBeLessThan(typical * 1.8);
  });

  it('varies: not a flat fill, not a hard checkerboard', () => {
    const size = 64;
    const data = channel(bytes(createNoiseTexture(size)), size, 0).flat();
    const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
    const spread = Math.sqrt(
      data.reduce((sum, value) => sum + (value - mean) ** 2, 0) / data.length,
    );

    expect(mean).toBeGreaterThan(90);
    expect(mean).toBeLessThan(165);
    expect(spread).toBeGreaterThan(20);
    expect(spread).toBeLessThan(90);
  });

  it('repeats by default and ships mipmaps', () => {
    const texture = createNoiseTexture(32);
    expect(texture.wrapS).toBe(1000);
    expect(texture.wrapT).toBe(1000);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.image.width).toBe(32);
    expect(NOISE_SIZE).toBe(128);
  });
});
