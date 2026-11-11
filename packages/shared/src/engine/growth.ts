import { BALANCE, MS_PER_DAY } from '../balance';
import { hash01 } from '../rng';

/**
 * How far a building has grown, 0..1.
 *
 * Ease-out cubic: work happens early, then the last storeys take the remaining
 * month. That reads as "under construction" rather than "stuck at 100%", and it
 * makes the first day after claiming feel rewarding.
 */
export function growthProgress(_cell: number, bornAt: number, nowMs: number): number {
  if (!Number.isFinite(bornAt) || bornAt <= 0) return 0;
  const total = BALANCE.growth.days * MS_PER_DAY;
  const p = Math.min(1, Math.max(0, (nowMs - bornAt) / total));
  const eased = 1 - Math.pow(1 - p, 3);
  // The very first frame is not nothing, or the pop-up animation has nothing to show.
  return Math.min(1, Math.max(0.02, eased));
}

/** Deterministic per-cell multiplier so a street of identical boxes does not read as a bug. */
export function heightVariation(cell: number): number {
  const v = BALANCE.growth.variation;
  return 1 - v / 2 + hash01(cell * 2654435761) * v;
}

/** Final render scale for a building, including the per-cell variation. */
export function cellHeight(cell: number, bornAt: number, nowMs: number): number {
  return growthProgress(cell, bornAt, nowMs) * heightVariation(cell);
}

/**
 * True once the building has reached full height. Time-based, not curve-based:
 * the ease-out curve is asymptotic enough that a threshold on it would report
 * "grown" most of a day early, and the UI cares about the month, not the easing.
 */
export function isGrown(_cell: number, bornAt: number, nowMs: number): boolean {
  if (bornAt <= 0) return false;
  return nowMs >= bornAt + BALANCE.growth.days * MS_PER_DAY;
}
