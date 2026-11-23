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
    /** Share of the vortex radius that actually damages cells. */
    damageRadiusRatio: z.number().gt(0).lt(1),
    /** Vortex radius in cells. */
    vortexRadiusCells: z.number().positive(),
    /** Hit points of one tower. Damage is partial: a tower can be cracked and survive. */
    cellHp: z.number().int().positive(),
    /** Damage one hurricane does to every cell it passes over. */
    damagePerHit: z.number().int().positive(),
    /** When in the storm's life the funnel is fully formed and damage lands. */
    damageAtRatio: z.number().gt(0).lt(1),
    /** Spawn weights, west and east. */
    sideWeights: z.object({ west: z.number().nonnegative(), east: z.number().nonnegative() }),
  }),

  player: z.object({
    maxNickLength: z.number().int().positive(),
  }),

  chess: z.object({
    /** Coins each side starts with. Towers are the only thing to spend them on. */
    startCoins: z.number().int().min(0).max(1000),
    /** Income per full round, so fortifying stays possible as the sea climbs. */
    coinsPerRound: z.number().int().min(0).max(100),
    towerCost: z.number().int().positive().max(100),
    pawnCost: z.number().int().positive().max(1000),
    towerIncome: z.number().int().min(0).max(1000),
    rocketCost: z.number().int().positive().max(1000),
    rocketRange: z.number().int().positive().max(20),
    rocketCentreChance: z.number().min(0).max(1),
    rocketRingChance: z.number().min(0).max(1),
    /**
     * The round at which the sea covers the last cell. A game cannot outlast it,
     * and an average game — 40 to 45 moves each — ends on the highlands rather
     * than in an empty ocean.
     */
    fullFloodRound: z.number().int().min(1).max(500),
    /**
     * Shape of the tide. 1 is an even share every round; above 1 holds the water
     * back early and hurries it in late, which is what a long game wants: the
     * opening should not be about drowning.
     */
    floodExponent: z.number().min(0.25).max(6),
    /**
     * Ground at or above this counts as high ground when the camp is chosen: the
     * patch inside the band with the most high cells wins. It is a preference,
     * not a floor — a 2x8 patch of nothing but hills does not exist in Europe.
     */
    campMinElevation: z.number().min(0).max(4000),
    /**
     * Latitude bands the armies camp in, degrees north. White in Europe, black in
     * East Asia: the two sides of the continent, not its southern edges.
     */
    campLat: z.object({
      white: z.tuple([z.number().min(-90).max(90), z.number().min(-90).max(90)]),
      black: z.tuple([z.number().min(-90).max(90), z.number().min(-90).max(90)]),
    }),
    /** Longitude bands, same idea: Europe in the west, East Asia in the east. */
    campLon: z.object({
      white: z.tuple([z.number().min(-180).max(180), z.number().min(-180).max(180)]),
      black: z.tuple([z.number().min(-180).max(180), z.number().min(-180).max(180)]),
    }),
  }),
  flood: z.object({
    enabledByDefault: z.boolean(),
    /** Sea level when a game starts, metres above the ocean. */
    startLevel: z.number().min(0).max(9000),
    /** How far the sea climbs per in-game day, metres. */
    metresPerDay: z.number().min(0).max(1000),
    /**
     * A hurricane lifts the water at the cells it hits, not the whole sea:
     * a low cell can drown long before the level would have reached it.
     */
    stormSurge: z.number().min(0).max(3000),
    /** The sea stops here, so the last cells standing are the highest ones. */
    maxLevel: z.number().int().positive().max(9000),
  }),
});

export type Balance = z.infer<typeof BalanceSchema>;

const RAW = {
  version: 1,

  claim: {
    cost: 5,
    refund: 5,
    startCoins: 30,
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
    vortexRadiusCells: 3.4,
    cellHp: 100,
    // Three hits destroy a tower: one storm cracks it, three level it.
    damagePerHit: 35,
    damageAtRatio: 0.3,
    sideWeights: { west: 1, east: 1 },
  },

  player: {
    maxNickLength: 24,
  },

  chess: {
    startCoins: 20,
    coinsPerRound: 5,
    // A tower and a pawn cost the same: fifty coins, ten rounds of income, is a
    // decision rather than a purchase you make every other move.
    towerCost: 50,
    // A pawn costs five towers: it is a piece on the board, and pieces decide the
    // game while towers only hold ground.
    pawnCost: 250,
    /** Every tower a side owns pays this at the end of each round. */
    towerIncome: 10,
    /**
     * A rocket base: a structure that fires instead of moving a piece. The zone is
     * a 3x3 square around the aimed cell; the chance to kill depends on where the
     * target stands inside it.
     */
    rocketCost: 50,
    rocketRange: 7,
    rocketCentreChance: 0.5,
    rocketRingChance: 0.2,
    fullFloodRound: 200,
    floodExponent: 2,
    campMinElevation: 250,
    // White in Europe, moved three files north of its first placement; black back
    // in the north-east, where it stood before the bands existed.
    campLat: { white: [46, 64], black: [51, 69] },
    campLon: { white: [-10, 40], black: [130, 145] },
  },
  flood: {
    enabledByDefault: true,
    startLevel: 0,
    metresPerDay: 50,
    stormSurge: 150,
    maxLevel: 5200,
  },
} as const;

export const BALANCE: Balance = BalanceSchema.parse(RAW);

export const MS_PER_DAY = BALANCE.time.msPerDay;

/** UTC day index — the unit both the client and the server count income in. */
export const dayIndex = (nowMs: number): number => Math.floor(nowMs / MS_PER_DAY);
