/**
 * Trails: the movement-speed cosmetic ladder, bought with stage Wins.
 *
 * Ported from the previous game and kept structurally identical. A trail
 * multiplies how fast the player ACTUALLY moves, and it does so by feeding the
 * one movement formula (`resolveMovementProfile`) through its
 * `extraMultiplier` parameter - never a second calculation of its own.
 *
 * Deliberately NOT a Speed-per-stride modifier: the equipped ANIMAL owns that
 * axis. Keeping the two separate is what stops a cosmetic quietly multiplying
 * the wrong system.
 *
 * Ownership and the equipped slot are server state. The client asks to buy and
 * to equip, and renders whatever comes back.
 */

/** How the client draws a trail. Presentation only; never gameplay. */
export type TrailStyle = 'solid' | 'rainbow' | 'sparkle' | 'void';

export interface TrailTier {
  /** 1-based slot, matching the shop rows top to bottom. */
  readonly slot: number;
  readonly name: string;
  /** Wins deducted on purchase. */
  readonly cost: number;
  /** Multiplier applied to actual movement speed while equipped. */
  readonly multiplier: number;
  /** Base colour, as a hex integer. */
  readonly color: number;
  readonly style: TrailStyle;
}

/**
 * Ten tiers.
 *
 * Costs are pitched against THIS game's Win economy - stage rewards run 1, 3,
 * 8, 20, 50, 120, 200, 400 - so the first trail is a couple of stage-one runs
 * and the last is a serious grind.
 *
 * The multipliers are deliberately gentle. A trail scales actual movement
 * speed, which is already multiplied by level and by rebirth; a steep ladder
 * here would put a rebirthed player through the obby faster than its platforms
 * can be read, which is a worse game rather than a better reward.
 */
export const TRAIL_TIERS: readonly TrailTier[] = [
  { slot: 1, name: 'Orange Trail', cost: 5, multiplier: 1.1, color: 0xff8a1f, style: 'solid' },
  { slot: 2, name: 'Blue Trail', cost: 15, multiplier: 1.2, color: 0x3aa8ff, style: 'solid' },
  { slot: 3, name: 'Green Trail', cost: 40, multiplier: 1.35, color: 0x3ce06a, style: 'solid' },
  { slot: 4, name: 'Purple Trail', cost: 110, multiplier: 1.5, color: 0xa855f7, style: 'solid' },
  { slot: 5, name: 'Rainbow Trail', cost: 300, multiplier: 1.7, color: 0xff3b6b, style: 'rainbow' },
  { slot: 6, name: 'Frost Trail', cost: 800, multiplier: 1.9, color: 0x9fe8ff, style: 'sparkle' },
  { slot: 7, name: 'Void Trail', cost: 2200, multiplier: 2.1, color: 0x1a1622, style: 'void' },
  { slot: 8, name: 'Solar Trail', cost: 6000, multiplier: 2.4, color: 0xffd23d, style: 'sparkle' },
  { slot: 9, name: 'Nova Trail', cost: 18000, multiplier: 2.8, color: 0x7b5bff, style: 'rainbow' },
  { slot: 10, name: 'Golden Trail', cost: 60000, multiplier: 3.2, color: 0xffc733, style: 'solid' },
];

/**
 * Slots must fit `PlayerState.ownedTrails`, a uint16 bitmask - so sixteen, and
 * no more.
 */
export const MAX_TRAIL_SLOTS = 16;

/** Nothing equipped. */
export const NO_TRAIL = 0;

/** Look up a tier by its slot. */
export const trailBySlot = (slot: number): TrailTier | undefined =>
  TRAIL_TIERS.find((tier) => tier.slot === slot);

/** One bit per slot, so the whole inventory is a single replicated integer. */
export const trailMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

/** True when the player has bought this tier. */
export const isTrailOwned = (owned: number, slot: number): boolean =>
  (owned & trailMask(slot)) !== 0;

/**
 * Movement multiplier from the equipped trail.
 *
 * Returns 1 for "none equipped" and for any slot that is not owned, so an
 * unowned or forged slot can only ever mean "no bonus" - never a bonus.
 */
export const trailMultiplier = (slot: number, owned: number): number => {
  const tier = trailBySlot(slot);
  if (!tier) return 1;
  return isTrailOwned(owned, tier.slot) ? tier.multiplier : 1;
};
