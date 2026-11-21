import { MS_PER_DAY } from '@eurasia/shared';

/**
 * The simulated clock, in milliseconds since the epoch.
 *
 * The world runs on this clock rather than on `Date.now()`, so the speed control
 * moves income, growth and the sea together instead of only the light. `extra`
 * is the time the player has fast-forwarded past the real clock; it lives in
 * memory, and `clockFor` rebuilds the rest from the save, which is what stops a
 * loaded save from ever moving the world backwards.
 */

/** Adds one frame of fast-forward. Speed 1 is the real clock and changes nothing. */
export const advance = (extra: number, deltaMs: number, speed: number): number =>
  extra + Math.max(0, deltaMs) * (Math.max(1, speed) - 1);

export const simNow = (realNow: number, extra: number): number => realNow + extra;

/**
 * Where the world's clock stands: the real clock plus whatever was fast-forwarded,
 * but never behind the last day the save has already settled.
 */
export const clockFor = (realNow: number, extra: number, lastDay: number): number =>
  Math.max(simNow(realNow, extra), lastDay * MS_PER_DAY);
