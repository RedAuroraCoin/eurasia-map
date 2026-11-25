/**
 * When the camera starts moving after a move, as arithmetic.
 *
 * The glide used to begin on the same frame as the move, which read as the camera
 * being yanked away from the piece the player had just touched. A short hold first —
 * long enough for the move to land — and then the same smoothstep as before.
 *
 * Kept here rather than inside the scene so the timing can be checked without a GPU.
 */

/** How long the camera waits after a move before it starts to glide. */
export const FOCUS_DELAY_MS = 260;

/** How long the glide itself takes once it starts. */
export const FOCUS_MS = 750;

export interface FocusStep {
  /** Still holding: nothing has moved yet. */
  readonly waiting: boolean;
  /** 0 at the start of the glide, 1 when it is over, smoothstepped in between. */
  readonly ease: number;
  /** The glide has finished and the camera belongs to the player again. */
  readonly done: boolean;
}

export function focusStep(
  elapsedMs: number,
  delay = FOCUS_DELAY_MS,
  duration = FOCUS_MS,
): FocusStep {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < delay) return { waiting: true, ease: 0, done: false };

  const t = Math.min(1, (elapsed - delay) / duration);
  // Smoothstep: no jolt at either end.
  return { waiting: false, ease: t * t * (3 - 2 * t), done: t >= 1 };
}
