import { describe, expect, it } from 'vitest';
import { FIRE_COLOURS, FIRE_PARTS, FIRE_TOP, HALO_OUTER, firePartY } from './fire';

/**
 * The fire is data, so the promises it makes can be checked without a GPU: it burns
 * at the foot of the rocket and nowhere else, it is warm, and it is big enough to be
 * seen on a phone.
 */

const warm = (hex: string): { r: number; g: number; b: number } => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

describe('the fire under an armed rocket base', () => {
  it('stays at the foot of the rocket', () => {
    for (const part of FIRE_PARTS) {
      const top = firePartY(part) + part.height / 2;
      expect(top).toBeLessThanOrEqual(FIRE_TOP);
    }
    // No part may sit anywhere near the tip of a 1-unit rocket, let alone above it.
    const highest = Math.max(...FIRE_PARTS.map((part) => firePartY(part) + part.height / 2));
    expect(highest).toBeGreaterThan(0.2);
    expect(highest).toBeLessThan(0.8);
  });

  it('has a broad ground halo and a bright core', () => {
    const halo = FIRE_PARTS.filter((part) => part.kind === 'halo');
    const core = FIRE_PARTS.filter((part) => part.kind === 'core');
    expect(halo).toHaveLength(1);
    expect(core).toHaveLength(1);

    // The halo is a flat ring on the ground, wide enough to read at a glance.
    expect(halo[0]?.height).toBe(0);
    expect(HALO_OUTER).toBeGreaterThan(0.6);
    // The core is the brightest thing in the fire.
    expect(core[0]?.opacity).toBeGreaterThanOrEqual(0.9);
    expect(core[0]?.colour).toBe(FIRE_COLOURS.core);
  });

  it('is warm: red above green above blue', () => {
    for (const part of FIRE_PARTS) {
      const { r, g, b } = warm(part.colour);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
  });

  it('burns in a ring of tongues, not one cone', () => {
    const tongues = FIRE_PARTS.filter((part) => part.kind === 'tongue');
    expect(tongues.length).toBeGreaterThanOrEqual(6);

    const angles = tongues.map((part) => part.angle);
    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread).toBeGreaterThan(Math.PI);
    // They stand off from the centre, around the skirt of the missile.
    for (const tongue of tongues) {
      expect(tongue.distance).toBeGreaterThan(0.15);
      expect(tongue.distance).toBeLessThan(0.4);
    }
  });

  it('is big enough to be noticed on a phone', () => {
    // Total height and width relative to a cell: the old marker was a thin line and
    // vanished on a small screen.
    const widest = Math.max(HALO_OUTER, ...FIRE_PARTS.map((part) => part.radius + part.distance));
    expect(widest).toBeGreaterThan(0.6);
    expect(FIRE_PARTS.length).toBeGreaterThanOrEqual(8);
  });
});
