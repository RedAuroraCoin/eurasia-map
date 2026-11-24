/**
 * The explosion timeline, as arithmetic.
 *
 * It used to live inline in the two views, driven by whatever clock arrived in
 * `render`. That turned out to be the bug behind "a fireball stays on the cell
 * after the shot": in chess mode the *world* clock can stand still — it never runs
 * behind the last day the city save has settled — and every animation driven by it
 * froze on its first frame. So the explosion is now a pure function of elapsed
 * render time, and the view is handed a clock that always moves.
 */

/** How long the explosion lives, in milliseconds. */
export const BLAST_MS = 1700;

export interface BlastFrame {
  /** 0 at the start, 1 at the end. */
  readonly t: number;
  readonly ringScale: number;
  readonly ringOpacity: number;
  readonly fireballScale: number;
  readonly fireballY: number;
  readonly fireballOpacity: number;
  readonly scorchOpacity: number;
  /** True on the frame the explosion has to be taken off the scene. */
  readonly done: boolean;
}

/**
 * One frame of the explosion. The first 12% holds at full strength: on a phone the
 * opening frames are the only ones a player is sure to see.
 */
export function blastFrame(elapsedMs: number): BlastFrame {
  const t = Math.max(0, Math.min(1, elapsedMs / BLAST_MS));
  const ease = 1 - Math.pow(1 - t, 3);
  const alpha = t < 0.12 ? 1 : 1 - (t - 0.12) / 0.88;

  return {
    t,
    ringScale: 0.3 + ease * 3.6,
    ringOpacity: 0.95 * alpha,
    fireballScale: 0.35 + ease * 1.8,
    fireballY: 0.45 + ease * 1.4,
    fireballOpacity: 0.95 * Math.min(1, alpha * 1.6),
    scorchOpacity: 0.55 * Math.min(1, t * 5) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1),
    done: t >= 1,
  };
}
