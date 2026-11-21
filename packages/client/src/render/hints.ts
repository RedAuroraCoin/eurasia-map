import * as THREE from 'three';

/**
 * Move hints: the cells the selected piece may go to, drawn flat on the ground.
 *
 * Three kinds, three shapes, three colours — a dot for a step, a ring for a
 * capture, a square for a tower the king could build. Shape carries the meaning
 * as well as colour does, so the hints still read for a colour-blind player.
 */

export type HintKind = 'move' | 'capture' | 'build';

export interface MoveHint {
  readonly cell: number;
  readonly kind: HintKind;
}

export const HINT_COLOURS: Record<HintKind, string> = {
  move: '#f4d06f',
  capture: '#e2564b',
  build: '#63a4f0',
};

const cache = new Map<HintKind, THREE.BufferGeometry>();

/** A flat marker for the given kind: dot, ring, square. */
export function hintGeometry(kind: HintKind): THREE.BufferGeometry {
  const existing = cache.get(kind);
  if (existing) return existing;

  let made: THREE.BufferGeometry;
  if (kind === 'capture') {
    made = new THREE.RingGeometry(0.16, 0.23, 24);
  } else if (kind === 'build') {
    made = new THREE.PlaneGeometry(0.34, 0.34);
  } else {
    made = new THREE.CircleGeometry(0.12, 20);
  }
  // Lay it flat: the geometries above are built in the XY plane.
  made.rotateX(-Math.PI / 2);
  made.computeBoundingBox();
  cache.set(kind, made);
  return made;
}

export function hintMaterial(kind: HintKind): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(HINT_COLOURS[kind]),
    transparent: true,
    opacity: 0.85,
    // Always visible: a hint under a piece is still a hint the player asked for.
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
