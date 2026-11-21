import { describe, expect, it } from 'vitest';
import { PIECE_SCALE, unitGeometry, type UnitRole } from './pieces';

/**
 * The pieces are sculpted in code, so their size is a number nobody sees until
 * the board is on screen. These tests pin the two things that went wrong before:
 * pieces too small to read, and pieces wider than the cell they stand on.
 */

const ROLES: UnitRole[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'tower'];

describe('chess piece geometry', () => {
  it('builds every role', () => {
    for (const role of ROLES) {
      const geometry = unitGeometry(role);
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('stands tall enough to read from the camera', () => {
    for (const role of ROLES) {
      const box = unitGeometry(role).boundingBox;
      expect(box).not.toBeNull();
      const height = (box?.max.y ?? 0) - (box?.min.y ?? 0);
      // At 1x the tallest piece was 0.44 units against a 1.3-unit castle.
      expect(height).toBeGreaterThan(0.6);
      expect(height).toBeLessThan(1.1);
    }
  });

  it('stays inside the cell it stands on', () => {
    for (const role of ROLES) {
      const box = unitGeometry(role).boundingBox;
      const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
      const depth = (box?.max.z ?? 0) - (box?.min.z ?? 0);
      expect(width).toBeLessThan(0.9);
      expect(depth).toBeLessThan(0.9);
    }
  });

  it('scales once, not on every call', () => {
    const first = unitGeometry('pawn');
    const second = unitGeometry('pawn');
    expect(second).toBe(first);
    expect(PIECE_SCALE).toBeGreaterThan(1);
  });
});
