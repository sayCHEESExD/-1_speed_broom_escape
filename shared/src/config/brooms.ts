/**
 * The broom roster.
 *
 * A broom REPLACES the boots of the first game and the broom of the second:
 * it is the movement vehicle, the progression ladder, the flight budget and
 * the thing the player actually looks at, all in one record. Everything a
 * system needs to know about a broom lives here and nowhere else, so adding an
 * eleventh broom is a new entry in `BROOMS` and nothing more - no movement
 * code, no renderer branch and no server case statement changes.
 *
 * Deliberately framework-free: the client turns `shape` and `palette` into
 * blocky geometry, the server reads `speedPerStep`, `flyCapacity`, `moveBonus`
 * and `winsRequired`, and neither knows the other's half exists.
 */

/**
 * Blocky proportions, in world units, for the generic broom the client builds
 * every model from.
 *
 * These are the numbers that decide whether a broom reads as a schoolroom twig
 * or a racing besom, so they are data rather than per-broom modelling code:
 * one builder consumes the whole struct and there is no second way to make a
 * broom.
 */
export interface BroomShape {
  /** Shaft: thickness (X and Y) and length along its own axis (Z). */
  readonly shaftThickness: number;
  readonly shaftLength: number;
  /** How much thinner the nose end is than the tail end, 0..1. */
  readonly shaftTaper: number;
  /** The bristle bundle hung off the tail: length, and its widest radius. */
  readonly bristleLength: number;
  readonly bristleRadius: number;
  /** How many bristle slats are drawn around the bundle. */
  readonly bristleCount: number;
  /** The binding collar between shaft and bristles. */
  readonly bindWidth: number;
  readonly bindLength: number;
  /** Footrest pegs: how far out they stick and how far back they sit. */
  readonly pegSpread: number;
  readonly pegZ: number;
  /** Radius of the magical glow orb at the nose. 0 hides it. */
  readonly emberRadius: number;
  /** Height of the seat above the shaft's own centre line. */
  readonly seatHeight: number;
}

/** Flat, saturated toy colours. Hex, as three.js takes them. */
export interface BroomPalette {
  /** The shaft. */
  readonly wood: number;
  /** The darker underside of the shaft and the peg stems. */
  readonly woodDark: number;
  /** The bristle bundle. */
  readonly bristle: number;
  /** The bristle tips, so a bundle is not one flat slab of colour. */
  readonly bristleTip: number;
  /** The binding collar and the pegs. */
  readonly bind: number;
  /** The magical glow: the nose ember, the rune bands, the exhaust. */
  readonly glow: number;
}

/** Enchantments bolted onto the generic broom. */
export type BroomFeature =
  /** Glowing rune bands burned into the shaft. */
  | 'runes'
  /** A short pennant flying from the collar. */
  | 'pennant'
  /** Twin flame vents at the base of the bristles. */
  | 'vents'
  /** A crystal lashed under the nose. */
  | 'crystal'
  /** Carved barbs down the top of the shaft. */
  | 'barbs'
  /** A pair of small folded wings at the collar. */
  | 'wings'
  /** A halo ring hovering around the shaft. */
  | 'halo'
  /** A second, shorter bristle bundle stacked over the first. */
  | 'doubleTail';

/** How one broom flies, looks and is unlocked. */
export interface BroomDefinition {
  /** Stable id, used in saves and in the model cache. Never re-used. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /**
   * Slot number, 1-based and contiguous.
   *
   * The replicated `broomSlot` and the owned-broom bitmask are indexed by
   * this, so it is the wire identity and `id` is the human one.
   */
  readonly slot: number;
  /** Wins needed to claim it from its stand. Slot 1 is free. */
  readonly winsRequired: number;
  /**
   * Speed farmed per stride while riding this broom.
   *
   * The whole progression ladder: a better broom farms the currency faster,
   * which raises the level, which raises movement speed, which opens later
   * stages. Matches the "+N Speed" label above each stand.
   */
  readonly speedPerStep: number;
  /**
   * SECONDS OF FLIGHT the broom holds when full.
   *
   * The second ladder, and the one this game is built around. The meter starts
   * here, drains while the thrust is held and refills on the ground - so a
   * better broom is not merely faster, it clears a gap the previous one could
   * not reach the far side of. Matches the "Fly" column on the stand.
   */
  readonly flyCapacity: number;
  /** Multiplier on base movement speed. A better broom is a faster broom. */
  readonly moveBonus: number;
  /** Multiplier on the launch impulse that lifts the rider off the ground. */
  readonly jumpBonus: number;
  /** Uniform scale applied to the built model. */
  readonly scale: number;
  /**
   * Where the rider sits, measured from the broom's own origin, before
   * `scale`.
   *
   * `y` is the height of the rider model's own origin, not of the seat: the
   * supplied FBX puts its origin at the feet and its hip joints 1.21 units
   * above that, so a seat that looks right is `seatY - 1.21`. Setting it to
   * the seat height instead is what buries the rider's legs inside the shaft.
   */
  readonly riderOffset: Readonly<{ x: number; y: number; z: number }>;
  /**
   * Distance in world units between two "strides".
   *
   * A broom has no legs, so this drives the SWAY cycle - the gentle roll and
   * the bristle flutter - and keeps the rider's posting bob tied to distance
   * covered rather than to wall-clock time.
   */
  readonly strideLength: number;
  readonly shape: BroomShape;
  readonly palette: BroomPalette;
  readonly features: readonly BroomFeature[];
}

/** Proportion presets, so ten brooms are ten variations of four builds. */
const BUILD = {
  /** School besoms: stubby shaft, fat untidy bundle. */
  school: {
    shaftThickness: 0.34,
    shaftLength: 4.2,
    shaftTaper: 0.62,
    bristleLength: 1.6,
    bristleRadius: 0.72,
    bristleCount: 9,
    bindWidth: 0.5,
    bindLength: 0.5,
    pegSpread: 0.5,
    pegZ: -0.4,
    emberRadius: 0,
    seatHeight: 0.26,
  },
  /** Club brooms: longer, straighter, a tidier bundle. */
  club: {
    shaftThickness: 0.32,
    shaftLength: 4.9,
    shaftTaper: 0.5,
    bristleLength: 1.9,
    bristleRadius: 0.66,
    bristleCount: 11,
    bindWidth: 0.48,
    bindLength: 0.55,
    pegSpread: 0.52,
    pegZ: -0.35,
    emberRadius: 0.16,
    seatHeight: 0.26,
  },
  /** Racing brooms: long, thin, a swept bundle and a lit nose. */
  racer: {
    shaftThickness: 0.28,
    shaftLength: 5.6,
    shaftTaper: 0.4,
    bristleLength: 2.2,
    bristleRadius: 0.58,
    bristleCount: 13,
    bindWidth: 0.44,
    bindLength: 0.6,
    pegSpread: 0.5,
    pegZ: -0.3,
    emberRadius: 0.24,
    seatHeight: 0.24,
  },
  /** Relics: heavy, ornate, and lit from inside. */
  relic: {
    shaftThickness: 0.38,
    shaftLength: 6.1,
    shaftTaper: 0.46,
    bristleLength: 2.5,
    bristleRadius: 0.78,
    bristleCount: 15,
    bindWidth: 0.6,
    bindLength: 0.7,
    pegSpread: 0.58,
    pegZ: -0.3,
    emberRadius: 0.3,
    seatHeight: 0.3,
  },
} as const satisfies Record<string, BroomShape>;

/**
 * The roster, in stand order along the shop wall.
 *
 * The two ladders are AUTHORED TOGETHER and they are deliberately different
 * shapes. `speedPerStep` runs away - 1, 2, 5, 20, 50, 100, 250, 500, 1000,
 * 2000 - because farming income is what a long game is made of. `flyCapacity`
 * barely moves: 10 seconds to 35 over the whole ladder, and three brooms in
 * the middle share 25. That flatness is the point. Flight is the thing the
 * course is designed around, so a late broom must open routes an early one
 * cannot reach WITHOUT making the course trivial to fly end to end.
 */
export const BROOMS: readonly BroomDefinition[] = [
  {
    id: 'twigbundle',
    name: 'Twig Bundle',
    slot: 1,
    winsRequired: 0,
    speedPerStep: 1,
    flyCapacity: 10,
    moveBonus: 1,
    jumpBonus: 1,
    scale: 1,
    riderOffset: { x: 0, y: -0.95, z: -0.15 },
    strideLength: 2.6,
    shape: BUILD.school,
    palette: {
      wood: 0x9a6b3f,
      woodDark: 0x72492a,
      bristle: 0xc79a52,
      bristleTip: 0xe3bd7c,
      bind: 0x5c3f25,
      glow: 0x8fd4ff,
    },
    features: [],
  },
  {
    id: 'oaksweeper',
    name: 'Oak Sweeper',
    slot: 2,
    winsRequired: 3,
    speedPerStep: 2,
    flyCapacity: 12,
    moveBonus: 1.05,
    jumpBonus: 1,
    scale: 1.01,
    riderOffset: { x: 0, y: -0.95, z: -0.15 },
    strideLength: 2.6,
    shape: BUILD.school,
    palette: {
      wood: 0x7d5230,
      woodDark: 0x5c3b21,
      bristle: 0xa8803c,
      bristleTip: 0xd0a862,
      bind: 0x4a3119,
      glow: 0x9ae2ff,
    },
    features: ['barbs'],
  },
  {
    id: 'cinderstraw',
    name: 'Cinder Straw',
    slot: 3,
    winsRequired: 15,
    speedPerStep: 5,
    flyCapacity: 15,
    moveBonus: 1.12,
    jumpBonus: 1.03,
    scale: 1.02,
    riderOffset: { x: 0, y: -0.95, z: -0.15 },
    strideLength: 2.7,
    shape: BUILD.club,
    palette: {
      wood: 0x6b4326,
      woodDark: 0x4d2f19,
      bristle: 0xd2622c,
      bristleTip: 0xffa53d,
      bind: 0x3d2614,
      glow: 0xff9d3d,
    },
    features: ['vents'],
  },
  {
    id: 'nightthorn',
    name: 'Nightthorn',
    slot: 4,
    winsRequired: 50,
    speedPerStep: 20,
    flyCapacity: 18,
    moveBonus: 1.2,
    jumpBonus: 1.06,
    scale: 1.03,
    riderOffset: { x: 0, y: -0.95, z: -0.15 },
    strideLength: 2.7,
    shape: BUILD.club,
    palette: {
      wood: 0x3b3550,
      woodDark: 0x2a2540,
      bristle: 0x5d4f7d,
      bristleTip: 0x8f7ecb,
      bind: 0x201c33,
      glow: 0xb46bff,
    },
    features: ['runes', 'barbs'],
  },
  {
    id: 'silvergale',
    name: 'Silver Gale',
    slot: 5,
    winsRequired: 100,
    speedPerStep: 50,
    flyCapacity: 20,
    moveBonus: 1.3,
    jumpBonus: 1.08,
    scale: 1.03,
    riderOffset: { x: 0, y: -0.97, z: -0.15 },
    strideLength: 2.8,
    shape: BUILD.racer,
    palette: {
      wood: 0xc9cedb,
      woodDark: 0x98a0b1,
      bristle: 0xe6ecf5,
      bristleTip: 0xffffff,
      bind: 0x6d7688,
      glow: 0x8fd4ff,
    },
    features: ['pennant', 'crystal'],
  },
  {
    id: 'emberbolt',
    name: 'Emberbolt',
    slot: 6,
    winsRequired: 500,
    speedPerStep: 100,
    flyCapacity: 25,
    moveBonus: 1.42,
    jumpBonus: 1.1,
    scale: 1.04,
    riderOffset: { x: 0, y: -0.97, z: -0.15 },
    strideLength: 2.8,
    shape: BUILD.racer,
    palette: {
      wood: 0x5a2420,
      woodDark: 0x3d1715,
      bristle: 0xd8342c,
      bristleTip: 0xffd24a,
      bind: 0x2f1414,
      glow: 0xff6a1e,
    },
    features: ['vents', 'runes'],
  },
  {
    id: 'stormlash',
    name: 'Stormlash',
    slot: 7,
    winsRequired: 2000,
    speedPerStep: 250,
    flyCapacity: 25,
    moveBonus: 1.55,
    jumpBonus: 1.12,
    scale: 1.04,
    riderOffset: { x: 0, y: -0.97, z: -0.15 },
    strideLength: 2.9,
    shape: BUILD.racer,
    palette: {
      wood: 0x2f4a5e,
      woodDark: 0x203645,
      bristle: 0x4d7f9e,
      bristleTip: 0xa9dcf2,
      bind: 0x18262f,
      glow: 0x5bd4ff,
    },
    features: ['runes', 'wings'],
  },
  {
    id: 'grimheart',
    name: 'Grimheart',
    slot: 8,
    winsRequired: 5000,
    speedPerStep: 500,
    flyCapacity: 25,
    moveBonus: 1.7,
    jumpBonus: 1.14,
    scale: 1.05,
    riderOffset: { x: 0, y: -1, z: -0.15 },
    strideLength: 2.9,
    shape: BUILD.relic,
    palette: {
      wood: 0x232028,
      woodDark: 0x14121a,
      bristle: 0x3c3546,
      bristleTip: 0x6b5f7d,
      bind: 0x0f0d14,
      glow: 0x54ff9f,
    },
    features: ['runes', 'barbs', 'doubleTail'],
  },
  {
    id: 'sunspire',
    name: 'Sunspire',
    slot: 9,
    winsRequired: 50_000,
    speedPerStep: 1000,
    flyCapacity: 30,
    moveBonus: 1.9,
    jumpBonus: 1.2,
    scale: 1.06,
    riderOffset: { x: 0, y: -1, z: -0.15 },
    strideLength: 3,
    shape: BUILD.relic,
    palette: {
      wood: 0xb8862c,
      woodDark: 0x8a621c,
      bristle: 0xffd24a,
      bristleTip: 0xfff2b0,
      bind: 0x6a4a12,
      glow: 0xffe14d,
    },
    features: ['runes', 'halo', 'crystal', 'pennant'],
  },
  {
    id: 'voidcomet',
    name: 'Void Comet',
    slot: 10,
    winsRequired: 100_000,
    speedPerStep: 2000,
    flyCapacity: 35,
    moveBonus: 2.15,
    jumpBonus: 1.28,
    scale: 1.07,
    riderOffset: { x: 0, y: -1, z: -0.15 },
    strideLength: 3.1,
    shape: BUILD.relic,
    palette: {
      wood: 0x1b1430,
      woodDark: 0x110c20,
      bristle: 0x4c2f8a,
      bristleTip: 0xd07aff,
      bind: 0x0a0718,
      glow: 0xd46bff,
    },
    features: ['runes', 'halo', 'wings', 'doubleTail', 'vents'],
  },
];

/** Slot -> definition. Built once; slots are contiguous from 1. */
const BY_SLOT: ReadonlyMap<number, BroomDefinition> = new Map(
  BROOMS.map((broom) => [broom.slot, broom]),
);

/** The broom every player starts on. Free, and the only one owned at join. */
export const STARTER_BROOM_SLOT = 1;

/**
 * The broom in a slot, or the starter when the slot is unknown.
 *
 * Never throws: a slot arriving from a save file or a stale client must
 * degrade to the starter rather than take a room down.
 */
export const broomForSlot = (slot: number): BroomDefinition => {
  const found = BY_SLOT.get(Math.floor(slot));
  if (found) return found;
  return BY_SLOT.get(STARTER_BROOM_SLOT) as BroomDefinition;
};

/** Bit for one slot in the owned-brooms mask. Slot 1 is bit 0. */
export const broomBit = (slot: number): number => 1 << (Math.floor(slot) - 1);

/** True when `ownedMask` includes this slot. */
export const ownsBroom = (ownedMask: number, slot: number): boolean =>
  (ownedMask & broomBit(slot)) !== 0;

/** The owned mask a brand new profile starts with. */
export const INITIAL_OWNED_BROOMS = broomBit(STARTER_BROOM_SLOT);

/**
 * The best broom a mask owns.
 *
 * "Best" is by `speedPerStep`, which is the ladder the stands are ordered by,
 * so equipping the best owned can never be a downgrade after a purchase. The
 * fly ladder rises with it - it never steps down between two consecutive
 * brooms - so the same choice is also never a downgrade in the air.
 */
export const bestOwnedBroom = (ownedMask: number): BroomDefinition => {
  let best = broomForSlot(STARTER_BROOM_SLOT);
  for (const broom of BROOMS) {
    if (!ownsBroom(ownedMask, broom.slot)) continue;
    if (broom.speedPerStep > best.speedPerStep) best = broom;
  }
  return best;
};
