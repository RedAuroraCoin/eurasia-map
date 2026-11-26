import * as THREE from 'three';

/**
 * The volcano, as geometry and colour.
 *
 * A cone of dark rock with a bright mouth on top: the rock says "this is terrain",
 * the mouth says how long the cell has. Yellow, then orange, then red — and the red
 * one is the round it opens. Kept apart from the scene so the colours and the shape
 * can be checked without a GPU.
 */

/** Stage colours: 0 yellow, 1 orange, 2 red. The last one is the eruption. */
export const VOLCANO_COLOURS = ['#ffd21f', '#ff8a1f', '#ff2a1a'] as const;

export const VOLCANO_HEIGHT = 0.85;
export const VOLCANO_RADIUS = 0.44;
/** The mouth sits just under the rim, so it reads as a hole rather than a lid. */
export const VOLCANO_MOUTH_RADIUS = 0.2;

/** One cone per volcano; the colour comes from the instance, not from this mesh. */
export function createVolcanoGeometry(): THREE.BufferGeometry {
  const cone = new THREE.CylinderGeometry(
    VOLCANO_RADIUS * 0.42,
    VOLCANO_RADIUS,
    VOLCANO_HEIGHT,
    12,
    1,
    false,
  );
  cone.translate(0, VOLCANO_HEIGHT / 2, 0);
  return cone;
}

/** The bright mouth: a flat disc at the top of the cone. */
export function createMouthGeometry(): THREE.BufferGeometry {
  const disc = new THREE.CircleGeometry(VOLCANO_MOUTH_RADIUS, 12);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, VOLCANO_HEIGHT - 0.02, 0);
  return disc;
}

/** The colour of a stage, clamped: a stage beyond red still reads as red. */
export function volcanoColour(stage: number): string {
  const index = Math.max(0, Math.min(VOLCANO_COLOURS.length - 1, Math.round(stage)));
  return VOLCANO_COLOURS[index] ?? VOLCANO_COLOURS[0];
}
