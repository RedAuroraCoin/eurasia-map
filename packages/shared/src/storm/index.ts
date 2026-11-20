import { BALANCE } from '../balance';
import { hash01, makeRng } from '../rng';
import type { MapEntry } from '../map/types';

/**
 * Hurricanes as data.
 *
 * A storm is a deterministic plan — seed, side, start time, a winding path —
 * never a loop of per-frame decisions. The client animates the plan against the
 * clock; the two-player room will issue the same object and resolve the damage
 * once, from an alarm. That is what lets the storm look identical on both
 * screens without a tick loop.
 */

export type StormSide = 'west' | 'east';

export interface StormPlan {
  readonly id: number;
  readonly seed: number;
  readonly side: StormSide;
  readonly startAt: number;
  readonly endsAt: number;
  /** Control points in cell coordinates: x = column, y = row. A smooth curve through them. */
  readonly path: readonly (readonly [number, number])[];
  /** Vortex radius in cells. Damage reaches `damageRatio` of it. */
  readonly radius: number;
  /** When the funnel is fully formed and the damage is resolved. */
  readonly damageAt: number;
}

const POINTS = 5;

/**
 * Path from just outside one edge to just outside the other, with the row
 * wandering so it curves instead of cutting a straight line across the map.
 */
function buildPath(seed: number, side: StormSide, rows: number, cols: number, radius: number) {
  const rng = makeRng(seed);
  const wander = Math.max(2, rows * 0.18);
  const startRow = rows * 0.2 + rng.next() * rows * 0.6;

  const points: [number, number][] = [];
  const from = side === 'west' ? -radius : cols + radius;
  const to = side === 'west' ? cols + radius : -radius;

  for (let i = 0; i < POINTS; i++) {
    const k = i / (POINTS - 1);
    const x = from + (to - from) * k;
    // A sine on top of the walk gives a smooth serpentine with no sharp turns.
    const bend = Math.sin(k * Math.PI * 1.6 + seed) * wander * 0.5;
    const drift = (rng.next() - 0.5) * wander;
    const y = Math.min(rows - 0.5, Math.max(0.5, startRow + bend + drift));
    points.push([x, y]);
  }
  return points;
}

export interface PlanOptions {
  readonly seed: number;
  readonly id: number;
  readonly startAt: number;
  readonly durationMs: number;
  readonly rows: number;
  readonly cols: number;
  readonly radius?: number;
}

export function planStorm(options: PlanOptions): StormPlan {
  const { seed, id, startAt, durationMs, rows, cols } = options;
  const hud = BALANCE.hurricane;
  const radius = options.radius ?? hud.vortexRadiusCells;
  const side: StormSide =
    hash01(seed) < hud.sideWeights.west / (hud.sideWeights.west + hud.sideWeights.east)
      ? 'west'
      : 'east';

  return {
    id,
    seed,
    side,
    startAt,
    endsAt: startAt + durationMs,
    path: buildPath(seed, side, rows, cols, radius),
    radius,
    damageAt: startAt + durationMs * hud.damageAtRatio,
  };
}

/** Catmull-Rom through the control points: the storm never turns on a corner. */
export function stormPointAt(plan: StormPlan, at: number): [number, number] {
  const span = Math.max(1, plan.endsAt - plan.startAt);
  const t = Math.min(1, Math.max(0, (at - plan.startAt) / span));
  const points = plan.path;
  const segments = points.length - 1;
  const scaled = t * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const local = scaled - index;

  const p0 = points[Math.max(0, index - 1)] as readonly [number, number];
  const p1 = points[index] as readonly [number, number];
  const p2 = points[Math.min(points.length - 1, index + 1)] as readonly [number, number];
  const p3 = points[Math.min(points.length - 1, index + 2)] as readonly [number, number];

  const curve = (a: number, b: number, c: number, d: number): number => {
    const t2 = local * local;
    const t3 = t2 * local;
    return (
      0.5 *
      (2 * b + (-a + c) * local + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
    );
  };

  return [curve(p0[0], p1[0], p2[0], p3[0]), curve(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * Every cell the storm passes close enough to hurt. Sampled along the path once,
 * at plan time: the answer never changes, so it can be resolved in a single
 * reducer call instead of streaming damage every frame.
 */
export function stormCells(plan: StormPlan, map: MapEntry): number[] {
  const reach = plan.radius * BALANCE.hurricane.damageRadiusRatio;
  const samples: [number, number][] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    samples.push(stormPointAt(plan, plan.startAt + ((plan.endsAt - plan.startAt) * i) / steps));
  }

  const hits: number[] = [];
  for (let index = 0; index < map.mask.length; index++) {
    if (map.mask[index] !== '#') continue;
    const x = index % map.cols;
    const y = Math.floor(index / map.cols);
    let close = false;
    for (const [sx, sy] of samples) {
      const dx = sx - x;
      const dy = sy - y;
      if (dx * dx + dy * dy <= reach * reach) {
        close = true;
        break;
      }
    }
    if (close) hits.push(index);
  }
  return hits;
}

/** The storm's next spawn time, or null when it is switched off. */
export function nextStormGap(seed: number): number {
  const hud = BALANCE.hurricane;
  const span = hud.pauseMaxMs - hud.pauseMinMs;
  return hud.pauseMinMs + Math.floor(hash01(seed) * span);
}
