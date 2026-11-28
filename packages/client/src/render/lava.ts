import * as THREE from 'three';

/**
 * Lava flows: the orange cells an eruption leaves behind.
 *
 * A flow is drawn as a flat, glowing tile rather than a wall: it has to read as ground
 * that is on fire, not as an object standing on the cell, because that is what it is —
 * a cell you cannot enter, build on, or slide through.
 */

/** Base orange, and the hot core the middle of a flow gets. */
export const LAVA_COLOURS = ['#ff6a12', '#ffb03a'] as const;

/** A flow fills its cell, with a hair of rock showing at the edge. */
export const LAVA_INSET = 0.94;
/** Just above the terrain, so it does not z-fight with the ground it covers. */
export const LAVA_LIFT = 0.03;

export function createLavaGeometry(): THREE.BufferGeometry {
  const tile = new THREE.PlaneGeometry(LAVA_INSET, LAVA_INSET, 1, 1);
  tile.rotateX(-Math.PI / 2);
  tile.translate(0, LAVA_LIFT, 0);
  return tile;
}

/**
 * The glow of a flow at a moment in time: slow, and barely there. Fast flicker on
 * eighteen cells would read as a fault in the picture, not as fire.
 */
export function lavaPulse(frameNow: number): number {
  return 0.78 + 0.12 * Math.sin(frameNow / 260);
}
