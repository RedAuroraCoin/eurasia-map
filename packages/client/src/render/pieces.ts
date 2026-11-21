import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceKind } from '@eurasia/shared';
import { createKingGeometry } from './king';

/**
 * Chess pieces as merged low-poly solids.
 *
 * One geometry per kind, built once and instanced twice (one mesh per side), so
 * sixteen pieces of an army cost a handful of draw calls. Shapes are deliberately
 * readable at map scale: a silhouette has to say "rook" from across the board.
 */

export type UnitRole = PieceKind | 'tower';

/** What the scene needs to draw one piece or tower. */
export interface UnitInstance {
  readonly id: number;
  readonly role: UnitRole;
  readonly side: 0 | 1;
  readonly cell: number;
}

const base = (rTop: number, rBottom: number, height: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rTop, rBottom, height, 12).translate(0, height / 2, 0);

function build(role: UnitRole): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (role) {
    case 'pawn':
      parts.push(base(0.09, 0.12, 0.16));
      parts.push(new THREE.SphereGeometry(0.085, 12, 8).translate(0, 0.23, 0));
      break;
    case 'rook':
      parts.push(base(0.13, 0.15, 0.24));
      // Battlements: four blocks around the rim read as a tower top.
      for (const [x, z] of [
        [0.09, 0],
        [-0.09, 0],
        [0, 0.09],
        [0, -0.09],
      ] as const) {
        parts.push(new THREE.BoxGeometry(0.07, 0.08, 0.07).translate(x, 0.28, z));
      }
      break;
    case 'knight':
      parts.push(base(0.12, 0.14, 0.1));
      parts.push(new THREE.BoxGeometry(0.13, 0.22, 0.2).translate(0, 0.21, 0));
      parts.push(new THREE.BoxGeometry(0.11, 0.09, 0.1).translate(0.03, 0.33, 0.06));
      break;
    case 'bishop':
      parts.push(base(0.12, 0.15, 0.1));
      parts.push(new THREE.ConeGeometry(0.12, 0.24, 12).translate(0, 0.22, 0));
      parts.push(new THREE.SphereGeometry(0.045, 10, 8).translate(0, 0.35, 0));
      break;
    case 'queen':
      parts.push(base(0.14, 0.16, 0.11));
      parts.push(new THREE.ConeGeometry(0.14, 0.26, 12).translate(0, 0.24, 0));
      parts.push(new THREE.SphereGeometry(0.055, 10, 8).translate(0, 0.39, 0));
      break;
    case 'king': {
      // The same crown the building mode uses, scaled to a chess piece.
      const crown = createKingGeometry();
      crown.scale(0.3, 0.42, 0.3);
      crown.translate(0, 0.02, 0);
      parts.push(crown);
      break;
    }
    case 'tower':
      parts.push(base(0.15, 0.17, 0.3));
      parts.push(new THREE.BoxGeometry(0.34, 0.06, 0.34).translate(0, 0.33, 0));
      break;
    default:
      break;
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.SphereGeometry(0.1, 8, 6);
}

/**
 * Chess pieces are read from further away than buildings: the board is the whole
 * continent and the camera sits back. Sculpted at 1x they were specks, so every
 * piece is scaled up once, here, rather than per instance.
 */
export const PIECE_SCALE = 2;

const cache = new Map<UnitRole, THREE.BufferGeometry>();

export function unitGeometry(role: UnitRole): THREE.BufferGeometry {
  const existing = cache.get(role);
  if (existing) return existing;
  const made = build(role);
  made.scale(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
  made.computeBoundingBox();
  cache.set(role, made);
  return made;
}

export const SIDE_COLOURS = ['#efe6d2', '#2f3742'] as const;
export const TOWER_COLOUR = '#8d8577';

/** Colour of a piece, with the dark side lifted a little so it is not a hole. */
export function unitColour(role: UnitRole, side: 0 | 1): string {
  return role === 'tower' ? TOWER_COLOUR : SIDE_COLOURS[side];
}
