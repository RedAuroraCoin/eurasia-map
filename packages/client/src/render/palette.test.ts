import { describe, expect, it } from 'vitest';
import { lightingAt, timeOfDayFromDate } from './palette';

const brightness = (rgb: readonly [number, number, number]): number =>
  rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

describe('lightingAt', () => {
  it('has no night factor at noon and full night after midnight', () => {
    expect(lightingAt(0.5).night).toBe(0);
    expect(lightingAt(0.0).night).toBeGreaterThan(0.9);
    expect(lightingAt(0.02).night).toBeGreaterThan(0.8);
  });

  it('puts the sun above the horizon during the day and below it at night', () => {
    expect(lightingAt(0.5).sunDir[1]).toBeGreaterThan(0.5);
    expect(lightingAt(0.25).sunDir[1]).toBeCloseTo(0, 1);
    expect(lightingAt(0.0).sunDir[1]).toBeLessThan(0);
    expect(lightingAt(0.95).sunDir[1]).toBeLessThan(0);
  });

  it('keeps the sun direction normalised', () => {
    for (let i = 0; i < 50; i++) {
      const dir = lightingAt(i / 50).sunDir;
      expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 5);
    }
  });

  it('is brighter at noon than at night', () => {
    expect(brightness(lightingAt(0.5).sky)).toBeGreaterThan(brightness(lightingAt(0.0).sky));
    expect(lightingAt(0.5).ambient).toBeGreaterThan(lightingAt(0.0).ambient);
  });

  it('has warm light near the horizon', () => {
    const dawn = lightingAt(0.27).sun;
    expect(dawn[0]).toBeGreaterThan(dawn[2]);
  });

  it('wraps without a seam at midnight', () => {
    const before = lightingAt(0.9999);
    const after = lightingAt(0.0001);
    expect(Math.abs(before.sky[0] - after.sky[0])).toBeLessThan(0.02);
    expect(Math.abs(before.ambient - after.ambient)).toBeLessThan(0.02);
  });

  it('handles out-of-range input', () => {
    expect(lightingAt(1.5).sky).toEqual(lightingAt(0.5).sky);
    expect(lightingAt(-0.5).sky).toEqual(lightingAt(0.5).sky);
  });
});

describe('timeOfDayFromDate', () => {
  it('maps local hours to 0..1', () => {
    expect(timeOfDayFromDate(new Date(2026, 0, 1, 0, 0, 0))).toBe(0);
    expect(timeOfDayFromDate(new Date(2026, 0, 1, 12, 0, 0))).toBeCloseTo(0.5, 5);
    expect(timeOfDayFromDate(new Date(2026, 0, 1, 18, 0, 0))).toBeCloseTo(0.75, 5);
  });
});
