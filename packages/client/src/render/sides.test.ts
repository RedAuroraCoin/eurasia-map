import { describe, expect, it } from 'vitest';
import { buildingTint, ownerTint, OWNER_TINTS, sideFor } from './geometry';

/** Two sides: separate colours, and a preview switch that never changes the rules. */

describe('two sides', () => {
  it('give each side its own colour', () => {
    expect(OWNER_TINTS[0]).not.toEqual(OWNER_TINTS[1]);
    // amber: red above blue. blue: blue above red.
    expect(OWNER_TINTS[0][0]).toBeGreaterThan(OWNER_TINTS[0][2]);
    expect(OWNER_TINTS[1][2]).toBeGreaterThan(OWNER_TINTS[1][0]);
  });

  it('fall back to side A for any value that is not 1', () => {
    expect(ownerTint(0)).toEqual(OWNER_TINTS[0]);
    expect(ownerTint(1)).toEqual(OWNER_TINTS[1]);
    expect(ownerTint(7)).toEqual(OWNER_TINTS[0]);
  });

  it('tint buildings far enough apart to read at a glance', () => {
    const [aR, , aB] = buildingTint(0);
    const [bR, , bB] = buildingTint(1);
    expect(aR - bR).toBeGreaterThan(60); // side A is much redder
    expect(bB - aB).toBeGreaterThan(60); // side B is much bluer
    // still light enough to read as stone rather than paint
    for (const side of [0, 1]) expect(Math.max(...buildingTint(side))).toBeGreaterThan(180);
  });

  it('puts every cell on side A in single-player', () => {
    for (const index of [0, 1, 2, 17, 799]) expect(sideFor(index, false)).toBe(0);
  });

  it('alternates owners only in the review preview', () => {
    expect(sideFor(0, true)).toBe(0);
    expect(sideFor(1, true)).toBe(1);
    expect(sideFor(2, true)).toBe(0);
  });
});
