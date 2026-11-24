/**
 * The fire that marks a rocket base about to shoot, as data rather than meshes.
 *
 * It burns **at the bottom of the rocket only** — on the pad, around the skirt of
 * the missile, never up at the tip: the tip is where the rocket points, the base is
 * where the engine is. Everything here is measured in cells from the centre of the
 * cell the base stands on, so the scene only has to place it and pulse it.
 *
 * Sizes are deliberately generous: at phone size a subtle glow is invisible, and the
 * whole point of the marker is to be noticed across the board.
 */

export type FireKind = 'halo' | 'skirt' | 'core' | 'tongue';

export interface FirePart {
  readonly kind: FireKind;
  readonly colour: string;
  readonly opacity: number;
  /** Radius of the cone, or the inner radius of the halo ring. */
  readonly radius: number;
  /** Height of the cone; the halo ignores it. */
  readonly height: number;
  /** Distance from the cell centre, and the bearing for the tongues. */
  readonly distance: number;
  readonly angle: number;
}

const TONGUES = 6;

export const FIRE_COLOURS = {
  halo: '#ff5a12',
  skirt: '#ff7a1f',
  core: '#ffd166',
  tongueHot: '#ffb347',
  tongueCool: '#ff6a1a',
} as const;

/** How tall the fire may be, in cells. It must stay well below the rocket body. */
export const FIRE_TOP = 0.75;

function tongues(): FirePart[] {
  const parts: FirePart[] = [];
  for (let index = 0; index < TONGUES; index++) {
    // Alternating sizes and colours: a ring of equal flames reads as a decal.
    const scale = index % 2 === 0 ? 1 : 0.72;
    parts.push({
      kind: 'tongue',
      colour: index % 2 === 0 ? FIRE_COLOURS.tongueHot : FIRE_COLOURS.tongueCool,
      opacity: 0.8,
      radius: 0.11 * scale,
      height: 0.5 * scale,
      distance: 0.3,
      angle: (index / TONGUES) * Math.PI * 2,
    });
  }
  return parts;
}

export const FIRE_PARTS: readonly FirePart[] = [
  // Ground halo first: it is what makes the marker readable from a distance.
  {
    kind: 'halo',
    colour: FIRE_COLOURS.halo,
    opacity: 0.7,
    radius: 0.46,
    height: 0,
    distance: 0,
    angle: 0,
  },
  // The broad flame around the skirt, then a bright core at the nozzle.
  {
    kind: 'skirt',
    colour: FIRE_COLOURS.skirt,
    opacity: 0.85,
    radius: 0.42,
    height: 0.62,
    distance: 0,
    angle: 0,
  },
  {
    kind: 'core',
    colour: FIRE_COLOURS.core,
    opacity: 0.95,
    radius: 0.24,
    height: 0.42,
    distance: 0,
    angle: 0,
  },
  ...tongues(),
];

/** Where a part's cone centre sits above the ground, in cells. */
export function firePartY(part: FirePart): number {
  return part.kind === 'halo' ? 0.03 : part.height / 2;
}

/** The ground ring's outer radius, in cells. */
export const HALO_OUTER = 0.74;
