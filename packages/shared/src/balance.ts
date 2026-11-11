import { z } from 'zod';

/**
 * Every tunable number in the game lives here and nowhere else.
 * The schema is not decoration: it is parsed at import time, so a typo in a price
 * or a negative duration fails the build instead of shipping.
 */

export const BalanceSchema = z.object({
  /** Bumped whenever a number changes in a way that alters saved games. */
  version: z.number().int().positive(),

  claim: z.object({
    cost: z.number().int().positive(),
    /** Refund when the player removes one of their own cells. */
    refund: z.number().int().nonnegative(),
    startCoins: z.number().int().nonnegative(),
  }),

  income: z.object({
    perCellPerDay: z.number().int().nonnegative(),
  }),

  growth: z.object({
    /** Days from claiming to full height. */
    days: z.number().int().positive(),
    /** Per-cell height spread, as a fraction of full height (0.28 => 0.86..1.14). */
    variation: z.number().min(0).max(0.5),
    /** Duration of the claim pop-up animation. */
    popMs: z.number().int().positive(),
  }),

  time: z.object({
    msPerDay: z.number().int().positive(),
    /** Demo mode: one in-game day per second. */
    demoMsPerDay: z.number().int().positive(),
  }),

  hurricane: z.object({
    enabledByDefault: z.boolean(),
    /** At most this many hurricanes are alive at once. */
    maxActive: z.number().int().min(1).max(4),
    firstDelayMs: z.number().int().nonnegative(),
    pauseMinMs: z.number().int().positive(),
    pauseMaxMs: z.number().int().positive(),
    lifeMinMs: z.number().int().positive(),
    lifeMaxMs: z.number().int().positive(),
    /** Share of the vortex radius that actually destroys cells. */
    damageRadiusRatio: z.number().gt(0).lt(1),
    /** Spawn weights, west and east. */
    sideWeights: z.object({ west: z.number().nonnegative(), east: z.number().nonnegative() }),
  }),

  player: z.object({
    maxNickLength: z.number().int().positive(),
  }),
});

export type Balance = z.infer<typeof BalanceSchema>;

const RAW = {
  version: 1,

  claim: {
    cost: 5,
    refund: 5,
    startCoins: 10,
  },

  income: {
    perCellPerDay: 1,
  },

  growth: {
    days: 30,
    variation: 0.28,
    popMs: 450,
  },

  time: {
    msPerDay: 86_400_000,
    demoMsPerDay: 1_000,
  },

  hurricane: {
    enabledByDefault: true,
    maxActive: 2,
    firstDelayMs: 6_000,
    pauseMinMs: 35_000,
    pauseMaxMs: 75_000,
    lifeMinMs: 28_000,
    lifeMaxMs: 42_000,
    damageRadiusRatio: 0.45,
    sideWeights: { west: 1, east: 1 },
  },

  player: {
    maxNickLength: 24,
  },
} as const;

export const BALANCE: Balance = BalanceSchema.parse(RAW);

export const MS_PER_DAY = BALANCE.time.msPerDay;

/** UTC day index — the unit both the client and the server count income in. */
export const dayIndex = (nowMs: number): number => Math.floor(nowMs / MS_PER_DAY);
