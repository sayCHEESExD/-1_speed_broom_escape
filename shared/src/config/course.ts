import type { Aabb } from '../types/math.js';
import { BROOMS, broomForSlot, type BroomDefinition } from './brooms.js';
import { FLIGHT } from './flight.js';
import { MOVEMENT, resolveMovementProfile } from './movement.js';
import { totalSpeedToReach } from './speed.js';

/**
 * The world, as pure data.
 *
 * Everything the player can stand on, bump into or be killed by is defined
 * here, and both the renderer and the authoritative server read the same
 * arrays. There are no world coordinates anywhere else - a platform the client
 * draws but the server does not know about is the one bug this file exists to
 * make impossible.
 *
 * The world is LINEAR along +Z: a wide starting vault, then thirty stages of
 * dark magical dungeon.
 *
 * WHAT MAKES THIS COURSE DIFFERENT from the previous games in the series is
 * the one thing every pattern below is authored against: the player rides a
 * broom with a FINITE flight meter, so a gap is no longer "can you jump it"
 * but "can you afford it". Two rules follow from that and they are the whole
 * design brief:
 *
 *  - Almost every gap here is WIDER than a ballistic hop can clear at the
 *    level the stage is built for (`BALLISTIC` below is that number, derived
 *    rather than guessed). Flight is not a shortcut in this game, it is the
 *    route.
 *  - No stage may be flyable end to end on one meter. Stages are long, the
 *    gaps are many, and the meter only refills standing STILL on a platform -
 *    so the decision the player is actually making, over and over, is when to
 *    spend and when to land.
 */

/** What a solid is for. Presentation reads this; the simulation does not. */
export type SolidKind =
  /** The flagstone dungeon floor. */
  | 'floor'
  /** The starting vault's floor. */
  | 'lobby'
  /** The raised deck of the training hall. */
  | 'training'
  /** A raised stone block to hop onto or over. */
  | 'block'
  /** A timber walkway or plank bridge. */
  | 'plank'
  /** A full-height dungeon column to weave around. */
  | 'pillar'
  /** Cracked, weathered masonry: the ruined halls. */
  | 'ruin'
  /** The small win pad at the left of a stage's end. */
  | 'winPad'
  /** A broom display stand. */
  | 'stand'
  /** A platform that periodically sinks. Rendered with a warning shake. */
  | 'sinking'
  /** Frost-slick flagstone. Slippery, via the surface region laid over it. */
  | 'ice'
  /** Dark granite: vaults, spires, the steppers over the lava. */
  | 'stone'
  /** A hewn beam, laid as a walkway. */
  | 'log'
  /** Black iron: crusher frames and the rails they run in. */
  | 'metal'
  /**
   * The dungeon ROOF.
   *
   * Never stood on and never bumped into sideways - `resolveAxis` skips any
   * solid whose underside is above the rider's head - so its whole job is to
   * be the thing `resolveCeiling` stops a climb against.
   */
  | 'ceiling'
  /**
   * A conjured platform: glowing, thin, and hanging in mid-air.
   *
   * The signature surface of this game. A rune slab has nothing under it and
   * is placed exactly where the course wants the player to be able to REST -
   * so it is also the thing that makes the flight meter a decision rather than
   * a countdown, because landing on one is how the meter comes back.
   */
  | 'rune';

/** One axis-aligned solid. */
export interface CourseSolid extends Aabb {
  readonly kind: SolidKind;
  /** Stage this belongs to; -1 for the starting vault. */
  readonly stage: number;
}

/**
 * A solid that rises and sinks as a pure function of TIME.
 *
 * Both sides evaluate `sinkingOffsetAt`, so a platform is in the same place on
 * every machine with nothing replicated and nothing to forge. The cycle is
 * deliberately four-part - up, warning shake, sunk, rising - because a
 * platform that vanished without warning would be a coin flip rather than a
 * decision.
 */
export interface SinkingSolid extends CourseSolid {
  /** Seconds for one complete up-warn-down-up cycle. */
  readonly cycle: number;
  /** Offset into the cycle, so a field of platforms is never in lockstep. */
  readonly phase: number;
  /** Seconds of the cycle spent fully up and steady. */
  readonly steady: number;
  /** Seconds of visible shaking before it drops. */
  readonly warn: number;
  /** Seconds spent out of reach at the bottom. */
  readonly sunk: number;
  /** How far it drops. Far enough to be genuinely gone. */
  readonly depth: number;
}

/**
 * A pool of something lethal, under the platforms.
 *
 * The bottom of the world in most of this dungeon. `surfaceY` is where the
 * pool is drawn and `deathY` is barely below it, so falling in reads as being
 * swallowed rather than as a long drop into nothing.
 */
export interface HazardPool {
  readonly stage: number;
  /**
   * What the pool is made of. PRESENTATION ONLY.
   *
   * Lava, void and water kill identically and by the same rule; the difference
   * is what the player is looking at while it happens, which is the whole
   * reason a dozen stages can share one mechanic without reading as one stage
   * built a dozen times.
   */
  readonly surface: 'lava' | 'void' | 'water';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly surfaceY: number;
  readonly deathY: number;
}

/**
 * The previous game called this quicksand, and half the codebase still reads
 * better with the old word for "the pit under the platforms".
 */
export type QuicksandRegion = HazardPool;

/** How a hazard moves. */
export type HazardKind =
  /** Sweeps side to side across the corridor. */
  | 'sweeper'
  /** Rolls down the corridor toward the player, then recycles to the top. */
  | 'roller'
  /**
   * Orbits a fixed centre in the horizontal plane.
   *
   * The workhorse of the later stages: a swinging chain, a spinning blade and
   * a censer on a rope are all this, at different radii and rates. Several
   * placed at one centre with stepped radii make a BAR rather than a ball,
   * which is how a blade and its shaft are drawn without any new physics.
   */
  | 'spinner'
  /**
   * Falls from above onto a fixed spot, rests, and rises again.
   *
   * Falling masonry and overhead crushers are the same hazard: the difference
   * is how far it falls and how long it waits. It hovers for most of its cycle
   * so the shadow underneath is a real warning rather than a formality.
   */
  | 'faller'
  /** Orbits like a spinner, drawn as a column of arcane wind. */
  | 'tornado'
  /**
   * A STATIC bed of spikes.
   *
   * Does not move at all, and that is why it belongs here rather than among
   * the solids: it is a killer with a position, tested by exactly the same
   * code every other hazard is, so a spike field costs the collision model
   * nothing it was not already paying. The dungeon's cheapest threat, and the
   * one that makes a low ceiling frightening.
   */
  | 'spike';

/**
 * A killer.
 *
 * Position is a pure function of TIME, so the server evaluates it from its own
 * clock and the client from the replicated one. There is no hazard state to
 * replicate and nothing for a client to assert.
 */
export interface CourseHazard {
  readonly kind: HazardKind;
  readonly stage: number;
  /** Centre of the sweep, or the lane a roller runs down. */
  readonly x: number;
  readonly y: number;
  /** Resting Z for a sweeper; ignored by a roller, which uses from/to. */
  readonly z: number;
  readonly radius: number;
  /**
   * Sweeper: half-amplitude in X.
   * Spinner / tornado: orbit radius about (`x`, `z`).
   * Faller: how far above `y` it hovers before it drops.
   * Roller / spike: unused.
   */
  readonly sweep: number;
  /**
   * Sweeper / spinner / tornado: radians per second.
   * Roller: units per second down the lane.
   * Faller: seconds for one complete hover-fall-rest-rise cycle.
   * Spike: unused.
   */
  readonly rate: number;
  /** Offset so a row of hazards is never in lockstep. */
  readonly phase: number;
  /** Roller: the Z it starts from (the far end) and rolls toward. */
  readonly fromZ: number;
  readonly toZ: number;
}

/** Scenery the client draws and the simulation ignores. */
export type DecorationKind =
  /** A dead tree: a bare trunk and a few broken limbs. */
  | 'tree'
  /**
   * A canopy sitting at platform height with NO solid under it.
   *
   * The trap: it reads as somewhere to land and is not.
   */
  | 'falseFloor'
  /** A ruined arch: two uprights and a lintel. Its solids are separate. */
  | 'arch'
  /** A drifting bank of cave mist, high above the world. */
  | 'cloud'
  /** A blocky boulder. Rubble on the vault floors. */
  | 'rock'
  /** A sheet of falling water down a cavern wall. */
  | 'waterfall'
  /** A wall torch: a bracket with a flame on it. */
  | 'torch'
  /** A standing brazier: a bowl of fire on three legs. */
  | 'brazier'
  /** A floating arcane crystal, slowly turning. */
  | 'crystal'
  /** A hanging chain, from the ceiling down into the dark. */
  | 'chain';

export interface Decoration {
  readonly kind: DecorationKind;
  readonly stage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
}

/**
 * A patch of ground that changes how the broom HANDLES on it.
 *
 * Two mechanics need this and they are the same one pointed in different
 * directions: frost lowers `grip` so a cruise keeps its momentum through a
 * turn, and the gale galleries add a constant `windX` that has to be leaned
 * into. Both are read by `stepPlayer` itself, so the server's simulation and
 * the client's prediction cannot handle differently - which for a surface
 * whose whole point is the feel of the controls is the difference between a
 * stage and a rubber-banding mess.
 */
export interface SurfaceRegion {
  readonly stage: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /**
   * Multiplier on ground acceleration AND braking, 1 being normal ground.
   *
   * Below 1 is frost: slower to speed up, far slower to stop or turn. It
   * scales both, deliberately - lowering only the braking would make frost a
   * place where the broom is simply harder to stop, rather than one where it
   * is harder to steer.
   */
  readonly grip: number;
  /** Constant sideways push, world units per second squared. */
  readonly windX: number;
  /** Constant push along the course. Negative holds the player back. */
  readonly windZ: number;
}

/**
 * A stretch of world that is WIDER than the running corridor.
 *
 * The starting vault is one by definition; the guardian's hall is the other.
 * Movement clamps to whatever this says, the floor is laid at the same width,
 * and the renderer builds its walls from the same list - so a wide area cannot
 * end up with a floor and a boundary that disagree.
 */
export interface WideArea {
  readonly minZ: number;
  readonly maxZ: number;
  readonly halfWidth: number;
}

/** One stage. */
export interface StageDefinition {
  /** 1-based, as shown on the gate. */
  readonly index: number;
  readonly name: string;
  readonly difficulty: string;
  /** Advisory only - shown on the gate, never enforced. */
  readonly recommendedLevel: number;
  /**
   * Lifetime Speed the recommended level corresponds to.
   *
   * DERIVED from `recommendedLevel` through the same curve the player actually
   * levels on, never authored beside it.
   */
  readonly recommendedSpeed: number;
  /**
   * Seconds of flight the stage is built to be cleared on.
   *
   * Advisory, shown on the gate beside the level, and derived from the roster
   * the same way the Speed figure is: it is the `flyCapacity` of the broom a
   * player at the recommended level is expected to be holding. A player on
   * less can still clear the stage by resting more; a player on more spends
   * fewer landings. That IS the ladder.
   */
  readonly recommendedFly: number;
  readonly startZ: number;
  readonly endZ: number;
  /** Centre of the small win pad at the player's LEFT at the stage end. */
  readonly winPadX: number;
  readonly winPadZ: number;
  /** Wins awarded for reaching it. */
  readonly winReward: number;
}

/** Global world metrics. */
export const COURSE = {
  /**
   * Half-width of the running corridor.
   *
   * Every lateral position in the stages is expressed as a FRACTION of this
   * (see `lane`), so widening the world moves the obstacles with it instead of
   * leaving them clustered down the middle of a wider floor.
   */
  halfWidth: 32,
  /** Top of the course floor. Everything is measured from here. */
  floorY: 0,
  /** Thickness of a floor slab, so a slab has an underside to head-butt. */
  floorThickness: 4,
  /** Height of the dungeon side walls. Visual; the X clamp is what holds. */
  wallHeight: 34,

  /**
   * The bottom of the world.
   *
   * A REAL surface, drawn under the whole map. Without it a fall shows the
   * underside of the course and an infinite void, which is what makes a world
   * look unfinished; with it, falling reads as dropping into a pit that was
   * always there.
   */
  pitFloorY: -22,

  /** Starting vault footprint. Deliberately large enough for a full room. */
  lobbyHalfWidth: 58,
  lobbyStartZ: -112,
  lobbyEndZ: 0,

  /** Bridge from one stage's end to the next stage's run-up. */
  stageGap: 26,
  /** How many stages exist. */
  stageCount: 30,
} as const;

/**
 * Surface of a lava pool, relative to the floor it replaces.
 *
 * Deep enough that the platforms above it read as suspended, shallow enough
 * that the glow lights their undersides.
 */
const POOL_Y = -6;

interface StageTuning {
  readonly name: string;
  readonly difficulty: string;
  /**
   * Level the stage is built around.
   *
   * The ramp is smooth and it respects the rebirth ladder: the level cap is
   * 25 per rebirth, so stage 5 at 19 is inside a first run, stage 10 at 58
   * wants two rebirths, and stage 20 at 120 wants four. Nothing here asks for
   * a level the ladder cannot reach.
   */
  readonly recommendedLevel: number;
  /**
   * Seconds of flight the stage is tuned for.
   *
   * Read straight off the broom roster's ladder - 10, 12, 15, 18, 20, 25, 30,
   * 35 - rather than invented here, so the gate advertises a figure a player
   * can actually go and buy.
   */
  readonly recommendedFly: number;
}

/**
 * What a broom can do on a BALLISTIC launch - no thrust at all.
 *
 * THE pair of numbers this whole course is authored against, and both are
 * derived rather than guessed: the launch impulse is
 * `jumpVelocity * FLIGHT.launchScale`, gravity brings it back in `2v/g`
 * seconds, and the broom travels at its own cruise speed for that whole time.
 *
 * The two behave COMPLETELY DIFFERENTLY as a player progresses, and that
 * asymmetry is what this course's difficulty is built on:
 *
 *  - `reach` runs away. Travel speed is multiplied by level, by rebirth and by
 *    the broom, so a level-160 rider covers eight hundred units in one hop.
 *    Width alone can therefore never keep flight essential - a gap authored
 *    wide enough to stop them would be a gap the stage could not physically
 *    contain.
 *  - `rise` barely moves. Launch velocity is deliberately tuned to scale far
 *    more gently than travel speed (see `resolveMovementProfile`), and the
 *    height a launch reaches goes as its SQUARE over a fixed gravity - which
 *    works out at about three units at the start of the game and eleven at the
 *    end of it.
 *
 * So ELEVATION is the gate, and width is the texture. A platform higher than
 * `rise` cannot be reached without spending meter by anybody, at any level, on
 * any broom - which is exactly the property "flight is essential" needs, and
 * the one property that survives a progression curve with no speed cap.
 */
interface Ballistic {
  /** Horizontal distance one launch covers. */
  readonly reach: number;
  /** Height one launch reaches. */
  readonly rise: number;
}

/**
 * The ballistic figures for a given profile.
 *
 * Exported as `ballisticAt` so `verify-course` checks every gap against the
 * same function that authored it, rather than against a copy of the formula
 * that is free to drift.
 */
export const ballisticFor = (runSpeed: number, jumpVelocity: number): Ballistic => {
  const launch = jumpVelocity * FLIGHT.launchScale;
  return {
    reach: runSpeed * ((2 * launch) / MOVEMENT.gravity),
    rise: (launch * launch) / (2 * MOVEMENT.gravity),
  };
};

/** The broom a player at a given stage is expected to be holding. */
const broomForFly = (seconds: number): BroomDefinition => {
  for (const broom of BROOMS) {
    if (broom.flyCapacity >= seconds) return broom;
  }
  return BROOMS[BROOMS.length - 1] as BroomDefinition;
};

/**
 * What a player the stage was BUILT FOR can do without thrust.
 *
 * Resolved from the stage's own advertised level and flight - the two figures
 * on its gate - through the same movement formula the simulation runs, so the
 * numbers a stage is authored against are the numbers the player it is
 * advertised to actually has.
 */
const ballisticAtStage = (tuning: StageTuning): Ballistic => {
  const broom = broomForFly(tuning.recommendedFly);
  const profile = resolveMovementProfile(
    tuning.recommendedLevel,
    0,
    broom.moveBonus,
    broom.jumpBonus,
  );
  return ballisticFor(profile.runSpeed, profile.jumpVelocity);
};

/** The base profile: level 1, no rebirths, the starter broom. */
const BASE_BALLISTIC: Ballistic = (() => {
  const starter = broomForSlot(1);
  const profile = resolveMovementProfile(1, 0, starter.moveBonus, starter.jumpBonus);
  return ballisticFor(profile.runSpeed, profile.jumpVelocity);
})();

/**
 * The gap a stage should use, given how far through the ladder it is.
 *
 * Scaled from the BASE ballistic reach rather than the stage's own, and that
 * is deliberate: a stage-30 gap scaled to a level-160 hop would be eight
 * hundred units across and the stage would be ten thousand units long for
 * eight crossings. Width is the texture of a crossing - how committing it
 * feels, how long the meter runs - and `riseFor` is what makes it a crossing
 * at all.
 *
 * @param t 0 at the first stage, 1 at the last
 */
const gapFor = (t: number): number => BASE_BALLISTIC.reach * (1.35 + t * 1.15);

/**
 * The CLIMB a stage should use between two platforms.
 *
 * THE number that keeps this course honest. Scaled from the ballistic rise of
 * the player the stage is built for and then some, so the far platform is
 * above what any launch can reach however fast its owner is travelling - and
 * so the only way onto it is to spend meter.
 *
 * Takes the stage's tuning rather than a fraction, because the rise it has to
 * beat depends on the profile the stage is played at and on nothing else.
 */
const riseFor = (tuning: StageTuning): number => ballisticAtStage(tuning).rise * 1.5;

/**
 * Every stage, in one table.
 *
 * Name, difficulty word, recommended level and recommended FLIGHT for all
 * thirty, so tuning the ladder is editing rows here rather than hunting
 * through builders. The gap and the climb each stage is built from are derived
 * from these rows through `gapFor` and `riseFor`, which is what keeps a
 * stage's difficulty and the figures on its gate the same statement.
 */
const STAGE_TUNING: readonly StageTuning[] = [
  { name: 'Escape', difficulty: 'EASY', recommendedLevel: 1, recommendedFly: 10 },
  { name: 'Spike Vault', difficulty: 'EASY', recommendedLevel: 4, recommendedFly: 10 },
  { name: 'Crypt Slabs', difficulty: 'EASY', recommendedLevel: 8, recommendedFly: 12 },
  { name: 'Chain Gallery', difficulty: 'NORMAL', recommendedLevel: 13, recommendedFly: 12 },
  { name: 'Guardian Vault', difficulty: 'NORMAL', recommendedLevel: 19, recommendedFly: 15 },
  { name: 'The Chasm', difficulty: 'NORMAL', recommendedLevel: 26, recommendedFly: 15 },
  { name: 'Pillar Climb', difficulty: 'NORMAL', recommendedLevel: 33, recommendedFly: 15 },
  { name: 'Crusher Span', difficulty: 'HARD', recommendedLevel: 41, recommendedFly: 18 },
  { name: 'Lava Steppers', difficulty: 'HARD', recommendedLevel: 49, recommendedFly: 18 },
  { name: 'Frost Ledges', difficulty: 'HARD', recommendedLevel: 58, recommendedFly: 18 },
  { name: 'Gale Gallery', difficulty: 'HARD', recommendedLevel: 66, recommendedFly: 20 },
  { name: 'Spire Ascent', difficulty: 'INSANE', recommendedLevel: 74, recommendedFly: 20 },
  { name: 'Rune Maze', difficulty: 'INSANE', recommendedLevel: 82, recommendedFly: 20 },
  { name: 'Bone Bridge', difficulty: 'INSANE', recommendedLevel: 89, recommendedFly: 25 },
  { name: 'Catacombs', difficulty: 'INSANE', recommendedLevel: 96, recommendedFly: 25 },
  { name: 'Drowned Halls', difficulty: 'INSANE', recommendedLevel: 103, recommendedFly: 25 },
  { name: 'Hex Storm', difficulty: 'NIGHTMARE', recommendedLevel: 108, recommendedFly: 25 },
  { name: 'Black Temple', difficulty: 'NIGHTMARE', recommendedLevel: 112, recommendedFly: 25 },
  { name: 'Ember Run', difficulty: 'NIGHTMARE', recommendedLevel: 116, recommendedFly: 25 },
  { name: 'Warden Hall', difficulty: 'NIGHTMARE', recommendedLevel: 120, recommendedFly: 25 },
  // 21-30. The increments tighten deliberately: past stage 20 the difficulty
  // comes from the obstacles, not from demanding another twenty levels for
  // each one. Stage 30 asks for level 160, which is six rebirths - a real ask
  // for a final stage, and one the ladder actually reaches.
  { name: 'Shadow Span', difficulty: 'NIGHTMARE', recommendedLevel: 124, recommendedFly: 30 },
  { name: 'Bone Valley', difficulty: 'NIGHTMARE', recommendedLevel: 128, recommendedFly: 30 },
  { name: 'Floating Crypts', difficulty: 'NIGHTMARE', recommendedLevel: 132, recommendedFly: 30 },
  { name: 'Lava Fortress', difficulty: 'NIGHTMARE', recommendedLevel: 136, recommendedFly: 30 },
  { name: 'Thornwood Deep', difficulty: 'NIGHTMARE', recommendedLevel: 140, recommendedFly: 30 },
  { name: 'Frozen Crypt', difficulty: 'NIGHTMARE', recommendedLevel: 144, recommendedFly: 30 },
  { name: 'Grand Sanctum', difficulty: 'NIGHTMARE', recommendedLevel: 148, recommendedFly: 35 },
  { name: 'Hex Tempest', difficulty: 'NIGHTMARE', recommendedLevel: 152, recommendedFly: 35 },
  { name: 'Final Descent', difficulty: 'NIGHTMARE', recommendedLevel: 156, recommendedFly: 35 },
  { name: 'Dark Summit', difficulty: 'NIGHTMARE', recommendedLevel: 160, recommendedFly: 35 },
];

/**
 * Wins per stage, as specified.
 *
 * The ONE place a stage reward is written. Anything past the table continues
 * the same roughly-doubling curve, so a thirty-first stage needs no edit here.
 */
const STAGE_REWARDS = [
  1, 3, 8, 20, 50, 120, 200, 400,
  // Nine onward continues the same accelerating curve. Never flat, and never
  // a step down: a later stage that paid less than an earlier one would make
  // the whole ladder something to farm backwards.
  700, 1200, 2000, 3200, 5000, 8000, 12_000, 18_000, 27_000, 40_000, 60_000,
  90_000,
  // 21-30, continuing the same roughly-x1.5 climb rather than the doubling
  // the fallback would have used - thirty stages of doubling ends in numbers
  // that mean nothing.
  135_000, 200_000, 300_000, 450_000, 675_000, 1_000_000, 1_500_000,
  2_200_000, 3_300_000, 5_000_000,
] as const;

export const stageReward = (index: number): number => {
  const at = Math.max(1, Math.floor(index));
  const authored = STAGE_REWARDS[at - 1];
  if (authored !== undefined) return authored;
  const last = STAGE_REWARDS[STAGE_REWARDS.length - 1] as number;
  return Math.round(last * 2 ** (at - STAGE_REWARDS.length));
};

/**
 * The win pad: small, rectangular, and at the player's LEFT at the stage end.
 *
 * LEFT is POSITIVE X in this game. The camera looks down +Z and its right is
 * `(-cos yaw, sin yaw)`, which at yaw 0 is world -X - so the player's left
 * hand points at +X. A pad authored at a negative X sits on the wrong side of
 * the screen however "left-hand" the number reads.
 */
export const WIN_PAD = {
  width: 11,
  length: 11,
  /** Distance in from the left-hand wall. */
  insetX: 11,
  /** How far it stands proud of the floor, so it reads as a pad. */
  height: 0.35,
} as const;

/**
 * HEADROOM above the tallest thing in a stage, before the roof.
 *
 * The number that decides how much of a stage can be flown OVER rather than
 * through. Generous enough that a crossing is made in open air rather than
 * scraping along a ceiling, tight enough that climbing to two hundred units
 * and gliding the whole stage - which is exactly what an open-topped dungeon
 * allowed - is no longer a route.
 *
 * It also has to clear `MOUNT_HEIGHT`, or a player standing on the highest
 * platform in a stage would be inside its roof.
 */
const CEILING_CLEARANCE = 30;

/** Thickness of a roof slab, so it has an underside to head-butt. */
const CEILING_THICKNESS = 5;

/** First stage begins exactly where the vault floor ends. */
const FIRST_STAGE_Z: number = COURSE.lobbyEndZ;

const solids: CourseSolid[] = [];
const wideAreas: WideArea[] = [];
const sinking: SinkingSolid[] = [];
const pools: HazardPool[] = [];
const hazards: CourseHazard[] = [];
const decorations: Decoration[] = [];
const surfaces: SurfaceRegion[] = [];
const stages: StageDefinition[] = [];

/**
 * A lateral position, as a fraction of the corridor's half-width.
 *
 * Every obstacle offset in this file goes through here. That is what makes the
 * world's width one number to change: authoring `-6.5` would have left the
 * platforms huddled in the middle the moment the corridor got wider.
 */
const lane = (fraction: number): number => COURSE.halfWidth * fraction;

/** Push a floor slab spanning the full corridor, or a given half-width. */
const pushFloor = (
  stage: number,
  fromZ: number,
  toZ: number,
  kind: SolidKind = 'floor',
  topY: number = COURSE.floorY,
  halfWidth: number = COURSE.halfWidth,
): void => {
  if (toZ <= fromZ) return;
  solids.push({
    minX: -halfWidth,
    maxX: halfWidth,
    minY: topY - COURSE.floorThickness,
    maxY: topY,
    minZ: fromZ,
    maxZ: toZ,
    kind,
    stage,
  });
};

/** Push an arbitrary box, given its centre and size. */
const pushBox = (
  stage: number,
  kind: SolidKind,
  centreX: number,
  baseY: number,
  centreZ: number,
  width: number,
  height: number,
  length: number,
): void => {
  solids.push({
    minX: centreX - width / 2,
    maxX: centreX + width / 2,
    minY: baseY,
    maxY: baseY + height,
    minZ: centreZ - length / 2,
    maxZ: centreZ + length / 2,
    kind,
    stage,
  });
};

/**
 * A SUSPENDED platform: a thin slab with nothing under it.
 *
 * The unit this whole course is built out of. `topY` is what the player stands
 * on and the slab hangs a couple of units below it, so the thing reads as
 * floating over the pool rather than as a pillar rising out of it - which is
 * what makes a dungeon full of them look like a dungeon full of them rather
 * than like a floor with holes cut in it.
 */
const pushIsland = (
  stage: number,
  kind: SolidKind,
  centreX: number,
  topY: number,
  centreZ: number,
  width: number,
  length: number,
  thickness = 1.6,
): void => {
  pushBox(stage, kind, centreX, topY - thickness, centreZ, width, thickness, length);
};

/**
 * Floor for a stage that is WIDER than the corridor, and the boundary to go
 * with it.
 *
 * One call, because these two facts must never be written separately: a floor
 * laid at 54 with a clamp still at 32 is a room the player cannot ride into,
 * and a clamp at 54 with a floor at 32 is a room they fall out of.
 */
const markWide = (fromZ: number, toZ: number, halfWidth: number): void => {
  wideAreas.push({ minZ: fromZ, maxZ: toZ, halfWidth });
};

const pushWideFloor = (
  stage: number,
  fromZ: number,
  toZ: number,
  halfWidth: number,
  kind: SolidKind = 'floor',
  topY: number = COURSE.floorY,
): void => {
  pushFloor(stage, fromZ, toZ, kind, topY, halfWidth);
  markWide(fromZ, toZ, halfWidth);
};

/**
 * A pool of lava, void or water filling the corridor between two Z.
 *
 * The counterpart to `pushIsland`: one call lays the thing that kills and the
 * platforms are placed over it. A stretch of course with islands and no pool
 * would be a drop to the pit floor and a long walk back; a pool with no
 * islands is a wall.
 */
const pushPool = (
  stage: number,
  fromZ: number,
  toZ: number,
  surface: HazardPool['surface'] = 'lava',
  halfWidth: number = COURSE.halfWidth,
): void => {
  pools.push({
    stage,
    surface,
    minX: -halfWidth,
    maxX: halfWidth,
    minZ: fromZ,
    maxZ: toZ,
    surfaceY: COURSE.floorY + POOL_Y,
    deathY: COURSE.floorY + POOL_Y - 1.4,
  });
};

/**
 * A rotating arm: a row of hazard balls stepped out along one radius.
 *
 * Each ball orbits the same centre at the same rate with the same phase, so
 * together they sweep as one rigid bar - which is what a chain, a blade and a
 * censer all are. Built from the existing orbit rather than from a new "bar"
 * primitive, so there is still exactly one hazard shape to test against and
 * the whole thing stays a pure function of time.
 *
 * @param inner first radius to place a ball at, so a hub can be left clear
 */
const pushSpinArm = (
  stage: number,
  kind: HazardKind,
  centreX: number,
  centreZ: number,
  y: number,
  inner: number,
  outer: number,
  ballRadius: number,
  rate: number,
  phase: number,
): void => {
  // Spaced by a little under a diameter, so the arm is continuous and a broom
  // can never thread between two balls of the same bar.
  const step = ballRadius * 1.5;
  for (let r = inner; r <= outer + 0.01; r += step) {
    hazards.push({
      kind,
      stage,
      x: centreX,
      y,
      z: centreZ,
      radius: ballRadius,
      sweep: r,
      rate,
      phase,
      fromZ: 0,
      toZ: 0,
    });
  }
};

/** One thing that falls out of the dark onto a fixed spot and comes back. */
const pushFaller = (
  stage: number,
  x: number,
  z: number,
  radius: number,
  height: number,
  period: number,
  phase: number,
  baseY: number = COURSE.floorY,
): void => {
  hazards.push({
    kind: 'faller',
    stage,
    x,
    // Resting height: sitting ON the floor, so the impact lands where the
    // shadow was rather than a body-length above it.
    y: baseY + radius,
    z,
    radius,
    sweep: height,
    rate: period,
    phase,
    fromZ: 0,
    toZ: 0,
  });
};

/**
 * A BED OF SPIKES: a row of static killers across part of the corridor.
 *
 * The dungeon's basic punctuation, and the reason a low platform is not
 * automatically a safe one. Laid as several overlapping spheres rather than
 * one wide box because the collision model already tests spheres and a bed
 * that used a new shape would be a new thing to get wrong.
 */
const pushSpikeBed = (
  stage: number,
  centreX: number,
  z: number,
  width: number,
  y: number = COURSE.floorY,
): void => {
  const radius = 2.2;
  const count = Math.max(1, Math.round(width / (radius * 1.6)));
  const step = count > 1 ? width / (count - 1) : 0;
  for (let i = 0; i < count; i += 1) {
    const x = centreX - width / 2 + step * i;
    hazards.push({
      kind: 'spike',
      stage,
      x,
      // Sitting ON the surface, so a broom skimming just over the tips lives.
      y: y + radius * 0.75,
      z,
      radius,
      sweep: 0,
      rate: 0,
      phase: 0,
      fromZ: 0,
      toZ: 0,
    });
  }
};

/** A patch of ground that handles differently. Frost, or a gale. */
const pushSurface = (
  stage: number,
  fromZ: number,
  toZ: number,
  halfWidth: number,
  grip: number,
  windX = 0,
  windZ = 0,
): void => {
  surfaces.push({
    stage,
    minX: -halfWidth,
    maxX: halfWidth,
    minZ: fromZ,
    maxZ: toZ,
    grip,
    windX,
    windZ,
  });
};

/** A torch on the wall at a given Z, on both sides. Pure decoration. */
const pushWallTorches = (stage: number, fromZ: number, toZ: number, spacing = 30): void => {
  for (let z = fromZ + spacing / 2; z < toZ; z += spacing) {
    for (const side of [-1, 1]) {
      decorations.push({
        kind: 'torch',
        stage,
        x: side * (COURSE.halfWidth - 1.6),
        y: COURSE.floorY + 9,
        z,
        scale: 1.4,
        rotationY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }
};

/**
 * Lay a ROOF over a stretch of the world.
 *
 * THE thing that makes this a dungeon rather than a canyon, and the thing that
 * keeps flight a route rather than an altitude. Without it, holding thrust for
 * ten seconds puts a rider two hundred units up with the entire stage below
 * them and nothing between - which is not the mechanic the course was authored
 * for, and which no amount of gap tuning can answer.
 *
 * Placed per stage at whatever that stage's own tallest platform is, plus
 * `CEILING_CLEARANCE`. Per stage rather than one flat slab, deliberately: a
 * corridor stage tops out at seven units and a spire at a hundred and ninety,
 * and a roof high enough for the spire would be no roof at all over the
 * corridor.
 *
 * It is never stood on and never bumped into sideways: `resolveAxis` skips any
 * solid whose underside is above the rider's head, and `surfaceYAt` only
 * offers surfaces within a step of the feet. Its ONLY role is to be what
 * `resolveCeiling` stops a climb against.
 */
const pushCeiling = (
  stage: number,
  fromZ: number,
  toZ: number,
  topY: number,
  halfWidth: number,
): void => {
  if (toZ <= fromZ) return;
  const base = topY + CEILING_CLEARANCE;
  solids.push({
    // Wider than the corridor, so the roof meets the walls rather than
    // stopping short of them and leaving a slot of sky down each side.
    minX: -halfWidth - 4,
    maxX: halfWidth + 4,
    minY: base,
    maxY: base + CEILING_THICKNESS,
    minZ: fromZ,
    maxZ: toZ,
    kind: 'ceiling',
    stage,
  });
};

// ---------------------------------------------------------------------------
// The starting vault.
//
// Left: the broom shop. Centre: open ground. Right: the training hall. Back:
// deliberately empty, so it stays a wall rather than becoming a third feature
// area.
// ---------------------------------------------------------------------------

solids.push({
  minX: -COURSE.lobbyHalfWidth,
  maxX: COURSE.lobbyHalfWidth,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: COURSE.floorY,
  minZ: COURSE.lobbyStartZ,
  maxZ: COURSE.lobbyEndZ,
  kind: 'lobby',
  stage: -1,
});

/**
 * The broom shop, down the player's LEFT wall.
 *
 * That wall is at +X, not -X. The camera looks down +Z and its right is
 * `(-cos yaw, sin yaw)`, which at yaw 0 is world -X - so the player's left
 * hand points at +X.
 *
 * A column along Z rather than a row along X: the vault is far deeper than it
 * is wide, and a row would have run straight across the middle of the space
 * the players are meant to gather in.
 */
export const STAND_ROW = {
  /** X of every stand. */
  x: 44,
  /** Z of the first stand, and the spacing down the wall. */
  firstZ: -96,
  spacingZ: 9.5,
  width: 6.5,
  length: 6.5,
  height: 0.6,
  /** How close the player must be to claim. */
  claimRadius: 3.6,
} as const;

/** Centre of the stand for a 1-based broom slot. */
export const standZ = (slot: number): number =>
  STAND_ROW.firstZ + (Math.floor(slot) - 1) * STAND_ROW.spacingZ;

/**
 * One tier of treadmill.
 *
 * Three tiers, two machines each, and the tier is the whole difference between
 * them: a level gate and a multiplier. Unlike the previous game's identical
 * belts this IS a ladder, which is why a tier carries its requirement rather
 * than the player being expected to remember it - the console prints it.
 */
export interface TreadmillTier {
  /** 1-based tier number, matching the row it stands in. */
  readonly tier: number;
  /** Level a player must have reached for the belt to pay. */
  readonly minLevel: number;
  /** Speed multiplier the belt pays at. */
  readonly multiplier: number;
}

/**
 * The training hall, on the RIGHT of the vault.
 *
 * Six treadmills in three tiers of two. TWO per tier is the point: a tier a
 * player has unlocked should never be something to queue for, and a single
 * belt per tier in a fifteen-player room would be exactly that.
 *
 * The belts run along X and the tiers step along Z, so a runner faces back
 * into the vault and the three tiers read as three ranks receding from the
 * spawn point. Building the belt along Z instead is what made the previous
 * game's first version read as a row of beds.
 */
export const TRAINING = {
  /** Raised deck footprint, on the player's RIGHT - which is -X. */
  minX: -56,
  maxX: -16,
  minZ: -96,
  maxZ: -20,
  /** Deck top. A shallow step, inside the simulation's landing tolerance. */
  deckY: 0.6,

  /** Belt footprint. The belt runs along X; the tiers step along Z. */
  beltLength: 15,
  beltWidth: 8.5,
  /** Walkable height of a belt above the deck. */
  beltHeight: 0.5,
  /** The two columns of machines, in X. */
  columnX: [-46, -26] as const,
  /** Z of the first tier's row, and the spacing between tiers. */
  firstZ: -82,
  spacingZ: 22,

  /**
   * THE TIERS, and the one place their gates and multipliers are written.
   *
   * Read by the server to decide what a belt pays, by the console sign to say
   * so, and by the verifier to check the two agree. A level a player has not
   * reached pays NOTHING rather than paying the base rate: a locked machine
   * that quietly worked would make the ladder invisible.
   */
  tiers: [
    { tier: 1, minLevel: 0, multiplier: 1 },
    { tier: 2, minLevel: 20, multiplier: 1.5 },
    { tier: 3, minLevel: 75, multiplier: 2 },
  ] as readonly TreadmillTier[],

  /**
   * Belt speed, in world units per second.
   *
   * A treadmill has no position delta to measure, so the BELT supplies the
   * distance and it flows through the identical per-stride formula. That is
   * why a treadmill needs no progression path of its own.
   */
  beltSpeed: 26,
} as const;

/** How many belts there are: two per tier. */
export const TREADMILL_COUNT = TRAINING.tiers.length * TRAINING.columnX.length;

/** Centre Z of a 1-based belt index. Two belts share each tier's row. */
export const treadmillZ = (index: number): number => {
  const tier = Math.max(1, Math.ceil(Math.floor(index) / TRAINING.columnX.length));
  return TRAINING.firstZ + (tier - 1) * TRAINING.spacingZ;
};

/** Centre X of a 1-based belt index: which column of the pair it is in. */
export const treadmillX = (index: number): number => {
  const column = (Math.max(1, Math.floor(index)) - 1) % TRAINING.columnX.length;
  return TRAINING.columnX[column] as number;
};

/** The tier a 1-based belt index belongs to. Never throws on a stray index. */
export const treadmillTier = (index: number): TreadmillTier => {
  const at = Math.max(1, Math.ceil(Math.floor(index) / TRAINING.columnX.length));
  return (TRAINING.tiers[at - 1] ?? TRAINING.tiers[0]) as TreadmillTier;
};

/** Walkable height of every treadmill belt. */
export const TREADMILL_BELT_Y = TRAINING.deckY + TRAINING.beltHeight;

/** Nobody is on a treadmill. */
export const NO_TREADMILL = 0;

/**
 * Which treadmill a position is standing on, or 0.
 *
 * Derived from position ALONE, by both sides, every step. There is no
 * treadmill message: riding on starts it and riding off stops it, so there is
 * nothing for a client to claim and nothing to keep after stepping off.
 *
 * It deliberately does NOT check the player's level. The belt a player is
 * STANDING ON is a fact about geometry; whether that belt pays them is a fact
 * about progression, and it is decided by the server's Speed service against
 * the level it owns. Folding the gate in here would mean a locked machine the
 * animator also refused to run, and a player standing on a moving belt that
 * claimed they were not on one.
 */
export const treadmillAt = (x: number, y: number, z: number): number => {
  if (y < TREADMILL_BELT_Y - 1.2 || y > TREADMILL_BELT_Y + 3) return NO_TREADMILL;
  for (let index = 1; index <= TREADMILL_COUNT; index += 1) {
    if (Math.abs(x - treadmillX(index)) > TRAINING.beltLength / 2) continue;
    if (Math.abs(z - treadmillZ(index)) > TRAINING.beltWidth / 2) continue;
    return index;
  }
  return NO_TREADMILL;
};

// The training deck and its six belts are real solids, so the player rides
// onto them the same way they ride onto anything else.
solids.push({
  minX: TRAINING.minX,
  maxX: TRAINING.maxX,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: TRAINING.deckY,
  minZ: TRAINING.minZ,
  maxZ: TRAINING.maxZ,
  kind: 'training',
  stage: -1,
});

for (let i = 1; i <= TREADMILL_COUNT; i += 1) {
  pushBox(
    -1,
    'training',
    treadmillX(i),
    TRAINING.deckY,
    treadmillZ(i),
    TRAINING.beltLength,
    TRAINING.beltHeight,
    TRAINING.beltWidth,
  );
}

// The broom stands.
for (let slot = 1; slot <= 10; slot += 1) {
  pushBox(
    -1,
    'stand',
    STAND_ROW.x,
    COURSE.floorY,
    standZ(slot),
    STAND_ROW.width,
    STAND_ROW.height,
    STAND_ROW.length,
  );
}

/*
 * The vault's roof.
 *
 * High enough to clear the scoreboards on the back wall and the shop signs
 * down the left, and low enough that the starting room reads as a room. It is
 * also what stops a player taking off at spawn and watching the whole course
 * from above before they have earned a single Win.
 */
pushCeiling(-1, COURSE.lobbyStartZ, COURSE.lobbyEndZ, 22, COURSE.lobbyHalfWidth);

// Braziers down the middle of the vault, so the room is lit by something.
for (let z = COURSE.lobbyStartZ + 18; z < COURSE.lobbyEndZ - 10; z += 26) {
  for (const side of [-1, 1]) {
    decorations.push({
      kind: 'brazier',
      stage: -1,
      x: side * 16,
      y: COURSE.floorY,
      z,
      scale: 1.3,
      rotationY: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// The stages.
// ---------------------------------------------------------------------------

/** Solid floor at the start of every stage, to land, rest and re-aim on. */
const START_RUNWAY = 26;

/** Solid floor leading to the finish. */
const FINISH_APRON = 26;

/**
 * A CHAIN OF SUSPENDED ISLANDS over a pool - the course's primary pattern.
 *
 * Everything that matters about this game's difficulty is in the four numbers
 * it takes. The gap is wider than a hop, so crossing it spends meter. The rise
 * means the far side is also HIGHER, which is the part a faster broom cannot
 * simply outrun: launch height barely scales with the movement multiplier
 * while travel speed runs away, so elevation is what keeps a late-game player
 * spending thrust rather than skipping the whole stage in one ballistic arc.
 *
 * Every island is somewhere to LAND, and landing is how the meter comes back,
 * so the pattern is self-pacing: a player who spends everything on the first
 * two gaps waits on the third.
 *
 * @returns the Z the chain ends at
 */
const pushIslandChain = (
  stage: number,
  fromZ: number,
  count: number,
  gap: number,
  rise: number,
  options: {
    readonly island?: number;
    readonly width?: number;
    readonly kind?: SolidKind;
    readonly startY?: number;
    readonly zigzag?: number;
    readonly surface?: HazardPool['surface'];
  } = {},
): { z: number; y: number } => {
  const island = options.island ?? 13;
  const width = options.width ?? lane(0.55);
  const kind = options.kind ?? 'rune';
  const zigzag = options.zigzag ?? 0;
  let y = options.startY ?? COURSE.floorY;
  let at = fromZ;

  pushPool(stage, fromZ, fromZ + count * (island + gap), options.surface ?? 'lava');

  for (let i = 0; i < count; i += 1) {
    at += gap;
    /*
     * The climb varies in SIZE but never in direction.
     *
     * It used to step down every fourth island for rhythm, and that was a real
     * mistake: a downward crossing is one gravity makes for free, so every
     * fourth gap in the game stopped asking for thrust. The rhythm now comes
     * from a short step among long ones - still a route through a cave rather
     * than a staircase, and still above a launch every single time.
     */
    y += rise * (i % 4 === 3 ? 0.8 : 1);
    const x = zigzag === 0 ? 0 : lane(zigzag) * (i % 2 === 0 ? 1 : -1);
    pushIsland(stage, kind, x, y, at + island / 2, width, island);
    at += island;
  }
  return { z: at, y };
};

/**
 * A way back DOWN to floor level, so a stage that climbed can finish.
 *
 * A chain that ended ninety units up would drop the player into the finish
 * apron from a height they cannot aim through, and a finish arrived at by
 * falling is a finish that cannot be missed on purpose - which is worse, not
 * better, because the win pad is off to one side and has to be steered to.
 *
 * Two shapes, chosen by how far there is to come down, and the split is the
 * point: a short drop is STAIRS the broom rides straight over, because the
 * simulation steps over a kerb and not over a storey. A long one is a flight
 * of wide catch ledges, each within a free fall of the last - stairs at 0.72 a
 * riser would have been four hundred units of staircase for the spire, which
 * is longer than the stage it was ending.
 *
 * @returns the Z the descent ends at
 */
const pushDescent = (
  stage: number,
  fromZ: number,
  fromY: number,
  toY: number,
  width: number = COURSE.halfWidth * 2,
): number => {
  const drop = fromY - toY;
  if (drop <= 0.01) return fromZ;

  // A short step down: a real flight of stairs, ridden rather than fallen.
  if (drop <= 10) {
    const rise = 0.72;
    const tread = 2.6;
    const count = Math.max(1, Math.ceil(drop / rise));
    for (let i = 0; i < count; i += 1) {
      const top = fromY - ((i + 1) / count) * drop;
      pushBox(
        stage,
        'stone',
        0,
        COURSE.floorY - COURSE.floorThickness,
        fromZ + tread / 2 + i * tread,
        width,
        top - (COURSE.floorY - COURSE.floorThickness),
        tread,
      );
    }
    return fromZ + count * tread;
  }

  // A long way down: wide ledges, a free fall apart. Falling costs nothing and
  // there is no fall damage in this game, so this is a descent the player can
  // take at their own pace without spending a second of meter.
  const stepDown = 11;
  const ledge = 13;
  const count = Math.ceil(drop / stepDown);
  let y = fromY;
  let at = fromZ;
  for (let i = 0; i < count; i += 1) {
    y = i === count - 1 ? toY : y - stepDown;
    pushIsland(stage, 'stone', 0, y, at + ledge / 2, width * 0.55, ledge, 1.8);
    at += ledge;
  }
  return at;
};

/**
 * Stage 1 - ESCAPE.
 *
 * The one stage that has to teach the whole game, and it teaches it by making
 * the first gap unhoppable. There is no ledge to edge along and no low route:
 * a moat of lava, five conjured slabs across it, and gaps a third wider than
 * a ballistic launch can reach. The player presses Space, the broom lifts,
 * the meter drains, and the mechanic has explained itself in two seconds.
 *
 * The slabs are deliberately generous - wide, long, close in height - because
 * the lesson is the meter, not the landing.
 */
const buildEscape = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const gap = gapFor(t);
  // The very first climb in the game, and it is already past a launch: the
  // stage teaches the mechanic by making the first slab unreachable without it.
  const end = pushIslandChain(stage, z, 5, gap, riseFor(tuning) * 1.1, {
    island: 17,
    width: lane(0.8),
  });
  pushWallTorches(stage, z, end.z, 26);
  return pushDescent(stage, end.z, end.y, COURSE.floorY);
};

/**
 * Stage 2 - SPIKE VAULT.
 *
 * Floor all the way, and none of it safe. Beds of spikes span the corridor
 * with narrow safe strips between them, so the stage is crossed in short
 * hops - the first time the player has to spend meter in small deliberate
 * amounts rather than in one big crossing.
 */
const buildSpikeVault = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const bay = 22;
  const bays = 7;
  pushFloor(stage, z, z + bays * bay);
  for (let i = 0; i < bays; i += 1) {
    const at = z + i * bay;
    pushSpikeBed(stage, 0, at + bay * 0.55, COURSE.halfWidth * 1.7);
    // A block to perch on between beds, high enough that the spikes below it
    // are a real reason to be up here.
    if (i % 2 === 0) {
      pushBox(
        stage,
        'block',
        lane(0.5) * (i % 4 === 0 ? 1 : -1),
        COURSE.floorY,
        at + bay * 0.2,
        lane(0.5),
        // Above a launch, so the perch is somewhere thrust puts you rather than
        // somewhere a hop does.
        riseFor(tuning) * 1.4,
        8,
      );
    }
  }
  pushWallTorches(stage, z, z + bays * bay, 22);
  return z + bays * bay;
};

/**
 * Stage 3 - CRYPT SLABS.
 *
 * Sinking platforms over lava. Every row keeps at least one slab up at every
 * moment - the phases are a third of a cycle apart - so the crossing is always
 * possible and always on a clock, which is the point: the meter and the
 * platform cycle are two timers the player has to satisfy at once.
 */
const buildCryptSlabs = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const rows = 8;
  const gap = gapFor(t) * 0.8;
  const slab = 12;
  const rise = riseFor(tuning);
  const length = rows * (slab + gap);
  pushPool(stage, z, z + length, 'lava');

  let y = COURSE.floorY;
  for (let row = 0; row < rows; row += 1) {
    const at = z + row * (slab + gap) + gap + slab / 2;
    // Every row is a step UP, for the same reason every island in a chain is:
    // a row of slabs at one height is a row a fast player skips across without
    // ever touching the meter, however wide the gaps between them are.
    y += rise;
    for (let column = 0; column < 3; column += 1) {
      const x = lane(-0.62 + column * 0.62);
      sinking.push({
        minX: x - lane(0.26),
        maxX: x + lane(0.26),
        minY: y - 1.6,
        maxY: y,
        minZ: at - slab / 2,
        maxZ: at + slab / 2,
        kind: 'sinking',
        stage,
        cycle: 6,
        // A third of a cycle apart, so exactly one of the three is always up.
        phase: (column * 6) / 3 + row * 0.4,
        steady: 3,
        warn: 0.9,
        sunk: 1.2,
        // Deep enough to be genuinely gone, and measured from the row's own
        // height rather than from the floor - these rows climb.
        depth: Math.max(9, rise + 4),
      });
    }
  }
  return pushDescent(stage, z + length, y, COURSE.floorY);
};

/**
 * Stage 4 - CHAIN GALLERY.
 *
 * Islands over a void, with censers swinging between them on long chains. The
 * gaps are ordinary; the chains are what makes the crossing expensive, because
 * a player who waits for a clear line spends meter hovering and a player who
 * does not spends it on the way back up.
 */
const buildChainGallery = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const gap = gapFor(t);
  const rise = riseFor(tuning);
  const end = pushIslandChain(stage, z, 6, gap, rise, {
    island: 14,
    width: lane(0.5),
    surface: 'void',
    zigzag: 0.3,
  });

  let at = z + gap + 14;
  for (let i = 0; i < 5; i += 1) {
    const centreZ = at + gap / 2;
    pushSpinArm(stage, 'spinner', 0, centreZ, COURSE.floorY + 4 + i * rise, 5, lane(0.6), 2.6, 1.1 + i * 0.12, i * 1.3);
    decorations.push({
      kind: 'chain',
      stage,
      x: 0,
      y: COURSE.floorY + 26,
      z: centreZ,
      scale: 1.6,
      rotationY: 0,
    });
    at += gap + 14;
  }
  return pushDescent(stage, end.z, end.y, COURSE.floorY);
};

/**
 * Stage 5 - GUARDIAN VAULT.
 *
 * A wide hall with the dungeon's guardian in it, and the one stage in the game
 * where the answer is to stay OFF the floor: raised rubble and broken arches
 * let a player who manages their meter cross without ever being reachable,
 * while a player who runs dry is on the ground with it.
 */
const RUINS = { halfWidth: 54, length: 250 } as const;

/**
 * The guardian's hall, DERIVED from the floor that is laid for it below.
 *
 * Written once by `buildGuardianVault` while this module is still evaluating,
 * which is why the Z fields are mutable and start at zero: the arena's extent
 * is whatever the build cursor happened to reach, and a hand-written pair here
 * would be free to disagree with the floor. Everything that reads it - the
 * guardian's territory, the verifier - imports this module and therefore runs
 * after the stage loop has finished.
 */
export const RUINS_ARENA: { minZ: number; maxZ: number; readonly halfWidth: number } = {
  minZ: 0,
  maxZ: 0,
  halfWidth: RUINS.halfWidth,
};

const pushArch = (stage: number, x: number, z: number, height = 12): void => {
  const legWidth = 4;
  const span = 16;
  for (const side of [-1, 1]) {
    pushBox(stage, 'ruin', x + side * (span / 2), COURSE.floorY, z, legWidth, height, legWidth);
  }
  pushBox(stage, 'ruin', x, COURSE.floorY + height, z, span + legWidth, 3, legWidth);
  decorations.push({ kind: 'arch', stage, x, y: COURSE.floorY, z, scale: 1, rotationY: 0 });
};

const buildGuardianVault = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const half = RUINS.halfWidth;
  const length = RUINS.length;
  pushWideFloor(stage, z, z + length, half);

  // The territory is DERIVED from the floor rather than authored beside it: a
  // guardian whose patrol range and whose floor disagree is one that walks off
  // the edge of its own stage.
  RUINS_ARENA.minZ = z;
  RUINS_ARENA.maxZ = z + length;

  for (let row = 0; row < 6; row += 1) {
    const at = z + 24 + row * 38;
    for (const side of [-1, 1]) {
      pushArch(stage, side * (18 + (row % 2) * 14), at, 12 + t * 6);
      // Rubble to perch on, and the HIGH ROUTE for a player with meter: out of
      // the guardian's reach, above what a launch can climb, and the whole
      // reason this stage rewards arriving with a full bar.
      pushIsland(
        stage,
        'ruin',
        side * (half - 14),
        COURSE.floorY + riseFor(tuning) * 1.6 + row * 1.4,
        at + 16,
        14,
        14,
      );
      decorations.push({
        kind: 'rock',
        stage,
        x: side * (half - 26),
        y: COURSE.floorY,
        z: at + 8,
        scale: 1.5,
        rotationY: row,
      });
    }
    decorations.push({
      kind: 'brazier',
      stage,
      x: 0,
      y: COURSE.floorY,
      z: at,
      scale: 1.5,
      rotationY: 0,
    });
  }
  return z + length;
};

/**
 * Stage 6 - THE CHASM.
 *
 * One enormous gap, and the stage the whole meter exists for. There is exactly
 * one rune slab in the middle of it, placed at the far edge of what the
 * recommended broom can reach - so the crossing is two committed burns with a
 * landing in between, and a player who tries to do it in one arrives short.
 */
const buildChasm = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const span = gapFor(t) * 2.4;
  const rise = riseFor(tuning);
  pushPool(stage, z, z + span * 2 + 18, 'void');

  pushIsland(stage, 'rune', 0, COURSE.floorY + rise, z + span + 9, lane(0.7), 18);
  decorations.push({
    kind: 'crystal',
    stage,
    x: 0,
    y: COURSE.floorY + rise + 7,
    z: z + span + 9,
    scale: 2.2,
    rotationY: 0,
  });

  // Two narrow ledges off to the sides, for a player who would rather make
  // three cheap crossings than two expensive ones. The route is longer in
  // distance and shorter in meter, which is the trade the stage is about.
  for (const side of [-1, 1]) {
    pushIsland(stage, 'stone', side * lane(0.72), COURSE.floorY + rise * 0.8, z + span * 0.55, lane(0.3), 12);
    pushIsland(stage, 'stone', side * lane(0.72), COURSE.floorY + rise * 1.5, z + span * 1.45 + 18, lane(0.3), 12);
  }
  return z + span * 2 + 18;
};

/**
 * Stage 7 - PILLAR CLIMB.
 *
 * Column tops over lava, each one higher than the last by more than a launch
 * can rise. The stage cannot be run at ANY speed, which is exactly what it is
 * for: it is the proof that the course does not become trivial once the
 * movement multiplier gets large.
 */
const buildPillarClimb = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const count = 9;
  const gap = gapFor(t) * 0.72;
  const cap = 11;
  // Half again over the stage's own rise, because THIS is the stage whose
  // whole argument is that speed cannot substitute for thrust.
  const rise = riseFor(tuning) * 1.5;
  const length = count * (gap + cap);
  pushPool(stage, z, z + length, 'lava');

  let y = COURSE.floorY + rise;
  let at = z;
  for (let i = 0; i < count; i += 1) {
    at += gap;
    y += i < count - 2 ? rise : -rise * 2;
    const x = lane(0.45) * Math.sin(i * 1.4);
    // The column under the cap: real geometry down into the lava, so the top
    // reads as somewhere that was built rather than as a floating tile.
    pushBox(stage, 'pillar', x, COURSE.floorY + POOL_Y, at + cap / 2, cap * 0.7, y - (COURSE.floorY + POOL_Y), cap * 0.7);
    pushIsland(stage, 'stone', x, y, at + cap / 2, cap, cap, 1.2);
    at += cap;
  }
  return pushDescent(stage, at, y, COURSE.floorY);
};

/**
 * Stage 8 - CRUSHER SPAN.
 *
 * A narrow suspended walkway with masonry falling onto it. Nowhere to go
 * sideways, so the only dodge is up - and going up costs meter that the walkway
 * itself, being a single unbroken run, gives no chance to earn back.
 */
const buildCrusherSpan = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const length = 190;
  const rise = riseFor(tuning);
  pushPool(stage, z, z + length, 'lava');
  // The walkway is ABOVE a launch from the run-up, so even getting onto the
  // stage costs meter.
  pushIsland(stage, 'plank', 0, COURSE.floorY + rise, z + length / 2, lane(0.34), length, 1.4);

  for (let i = 0; i < 8; i += 1) {
    pushFaller(
      stage,
      lane(0.12) * (i % 2 === 0 ? 1 : -1),
      z + 16 + i * 22,
      4.2,
      26,
      2.6 - t * 0.5,
      i * 0.55,
      COURSE.floorY + rise,
    );
  }
  // Two rest slabs, and only two. The stage is about arriving with enough.
  for (const at of [z + length * 0.34, z + length * 0.7]) {
    pushIsland(stage, 'rune', lane(0.55), COURSE.floorY + rise * 1.6, at, lane(0.3), 14);
  }
  return z + length;
};

/**
 * Stage 9 - LAVA STEPPERS.
 *
 * Small stones over a wide lava lake, zigzagging across the corridor. The gaps
 * are diagonal, so the crossing costs more meter than its Z distance suggests
 * - the first stage where aiming matters as much as spending.
 */
const buildLavaSteppers = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const end = pushIslandChain(stage, z, 10, gapFor(t) * 0.78, riseFor(tuning), {
    island: 10,
    width: lane(0.3),
    kind: 'stone',
    zigzag: 0.62,
  });
  for (let i = 0; i < 5; i += 1) {
    pushFaller(stage, lane(0.5) * (i % 2 ? 1 : -1), z + 30 + i * 34, 3.4, 24, 3, i * 0.8);
  }
  return pushDescent(stage, end.z, end.y, COURSE.floorY);
};

/**
 * Stage 10 - FROST LEDGES.
 *
 * Frost-slick ledges with gaps between them. Grip is low, so a landing slides
 * toward the far edge - and a player who spent their whole meter on the
 * crossing has nothing left to correct it with.
 */
const buildFrostLedges = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const end = pushIslandChain(stage, z, 8, gapFor(t) * 0.85, riseFor(tuning), {
    island: 16,
    width: lane(0.6),
    kind: 'ice',
    surface: 'water',
  });
  pushSurface(stage, z, end.z, COURSE.halfWidth, 0.22);
  for (let i = 0; i < 4; i += 1) {
    decorations.push({
      kind: 'crystal',
      stage,
      x: lane(0.7) * (i % 2 ? 1 : -1),
      y: COURSE.floorY + 10,
      z: z + 40 + i * 46,
      scale: 2,
      rotationY: i,
    });
  }
  return pushDescent(stage, end.z, end.y, COURSE.floorY);
};

/**
 * Stage 11 - GALE GALLERY.
 *
 * A crosswind that acts in the AIR as well as on the ground, over a chain of
 * narrow islands. Flying costs the same meter it always did and buys less
 * distance in the direction the player wanted, which is the most direct way a
 * stage can say "spend more".
 */
const buildGaleGallery = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const end = pushIslandChain(stage, z, 7, gapFor(t) * 0.9, riseFor(tuning), {
    island: 14,
    width: lane(0.34),
    kind: 'rune',
    surface: 'void',
  });
  const half = (end.z - z) / 2;
  pushSurface(stage, z, z + half, COURSE.halfWidth, 1, 26 + t * 14);
  pushSurface(stage, z + half, end.z, COURSE.halfWidth, 1, -(26 + t * 14));
  for (let i = 0; i < 4; i += 1) {
    pushSpinArm(stage, 'tornado', lane(0.4) * (i % 2 ? 1 : -1), z + 36 + i * 44, COURSE.floorY + 6, 4, 12, 3.4, 1.4, i);
  }
  return pushDescent(stage, end.z, end.y, COURSE.floorY);
};

/**
 * Stage 12 - SPIRE ASCENT.
 *
 * A vertical shaft. The ledges spiral upward with barely any Z between them,
 * so nothing here can be crossed by going fast - the only axis that helps is
 * the one only thrust reaches. The descent at the far end is free, which is
 * the stage's reward for having climbed it.
 */
const buildSpireAscent = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const steps = 10;
  // Capped at twice the stage's own rise: a shaft is a climb, not a
  // skyscraper, and a step the player cannot make in one burn would be a wall
  // rather than a stage.
  const rise = Math.min(riseFor(tuning) * 1.3, 22);
  const length = 150;
  pushPool(stage, z, z + length, 'void');

  let y = COURSE.floorY + rise;
  for (let i = 0; i < steps; i += 1) {
    const angle = i * 1.15;
    y += rise;
    pushIsland(
      stage,
      i % 3 === 0 ? 'rune' : 'stone',
      Math.cos(angle) * lane(0.6),
      y,
      z + 18 + (i / steps) * (length - 40) + Math.sin(angle) * 12,
      lane(0.34),
      14,
    );
  }

  // The landing shelf at the top, and a long glide down to the apron. A shaft
  // with no way out but another climb would be a dead end.
  pushIsland(stage, 'stone', 0, y + rise, z + length - 14, lane(0.9), 26);
  return pushDescent(stage, z + length, y + rise, COURSE.floorY);
};

/**
 * Stage 13 - RUNE MAZE.
 *
 * Narrow conjured bridges branching around blade wheels. Every branch is a
 * bet: the short way is guarded, the long way is cheap, and the player has to
 * price both against a meter they can see draining.
 */
const buildRuneMaze = (stage: number, z: number, t: number, tuning: StageTuning): number => {
  const length = 210;
  const rise = riseFor(tuning);
  pushPool(stage, z, z + length, 'void');

  for (let i = 0; i < 6; i += 1) {
    const at = z + 20 + i * 32;
    const side = i % 2 === 0 ? 1 : -1;
    // The guarded short way, straight down the middle.
    pushIsland(stage, 'rune', 0, COURSE.floorY + rise + i * rise * 0.7, at, lane(0.22), 24);
    pushSpinArm(stage, 'spinner', 0, at, COURSE.floorY + rise + 2 + i * rise * 0.7, 4, lane(0.4), 2.4, 1.5 + t, i * 0.9);
    // The long way round, off to one side and one step lower.
    pushIsland(stage, 'stone', side * lane(0.66), COURSE.floorY + i * rise * 0.7, at + 14, lane(0.24), 18);
  }
  const top = COURSE.floorY + rise + 6 * rise * 0.7;
  pushIsland(stage, 'stone', 0, top, z + length - 16, lane(0.8), 24);
  return pushDescent(stage, z + length, top, COURSE.floorY);
};

/**
 * The generated stages, 14 onward.
 *
 * Six patterns, cycled, each taking the stage's own difficulty fraction. This
 * is the architecture proving it extends: a stage past thirteen is a row in
 * `STAGE_TUNING` and a slot in this rotation, and nothing else.
 */
type PatternId = 'chain' | 'spikes' | 'slabs' | 'pillars' | 'shaft' | 'maze';

const PATTERNS: readonly PatternId[] = [
  'chain',
  'spikes',
  'pillars',
  'slabs',
  'shaft',
  'maze',
];

const buildPattern = (
  stage: number,
  z: number,
  t: number,
  tuning: StageTuning,
  pattern: PatternId,
): number => {
  switch (pattern) {
    case 'spikes':
      return buildSpikeVault(stage, z, t, tuning);
    case 'slabs':
      return buildCryptSlabs(stage, z, t, tuning);
    case 'pillars':
      return buildPillarClimb(stage, z, t, tuning);
    case 'shaft':
      return buildSpireAscent(stage, z, t, tuning);
    case 'maze':
      return buildRuneMaze(stage, z, t, tuning);
    default: {
      // The island chain, dressed differently each time it comes round so six
      // patterns over seventeen stages never read as six patterns.
      const flavour = stage % 3;
      const end = pushIslandChain(stage, z, 8 + (stage % 3), gapFor(t), riseFor(tuning), {
        island: 13,
        width: lane(flavour === 1 ? 0.34 : 0.5),
        kind: flavour === 2 ? 'ice' : 'rune',
        surface: flavour === 0 ? 'lava' : flavour === 1 ? 'void' : 'water',
        zigzag: flavour === 1 ? 0.5 : 0,
      });
      if (flavour === 2) pushSurface(stage, z, end.z, COURSE.halfWidth, 0.3);
      if (flavour === 1) {
        for (let i = 0; i < 4; i += 1) {
          pushFaller(stage, lane(0.3) * (i % 2 ? 1 : -1), z + 34 + i * 40, 3.8, 24, 2.8, i * 0.7);
        }
      }
      return pushDescent(stage, end.z, end.y, COURSE.floorY);
    }
  }
};

/** Running build cursor. Each stage begins exactly where the last one ended. */
let cursorZ: number = FIRST_STAGE_Z;

for (let stageIndex = 0; stageIndex < COURSE.stageCount; stageIndex += 1) {
  const tuning = STAGE_TUNING[
    Math.min(stageIndex, STAGE_TUNING.length - 1)
  ] as StageTuning;
  const startZ = cursorZ;
  // 0 at the first stage, 1 at the last. Every gap, rise and rate in the
  // builders is a function of it, so the whole ladder tunes from one number.
  const t = stageIndex / Math.max(1, COURSE.stageCount - 1);
  let z = startZ;

  // Where this stage's own geometry begins in the arrays, so its roof can be
  // laid at whatever height it actually turns out to reach. A stage's height
  // is no more knowable up front than its length is.
  const solidsFrom = solids.length;
  const sinkingFrom = sinking.length;

  // The run-up: solid, torch-lit, and long enough to rest the meter on.
  pushFloor(stageIndex, z, z + START_RUNWAY);
  pushWallTorches(stageIndex, z, z + START_RUNWAY, 18);
  z += START_RUNWAY;

  switch (stageIndex) {
    case 0:
      z = buildEscape(stageIndex, z, t, tuning);
      break;
    case 1:
      z = buildSpikeVault(stageIndex, z, t, tuning);
      break;
    case 2:
      z = buildCryptSlabs(stageIndex, z, t, tuning);
      break;
    case 3:
      z = buildChainGallery(stageIndex, z, t, tuning);
      break;
    case 4:
      z = buildGuardianVault(stageIndex, z, t, tuning);
      break;
    case 5:
      z = buildChasm(stageIndex, z, t, tuning);
      break;
    case 6:
      z = buildPillarClimb(stageIndex, z, t, tuning);
      break;
    case 7:
      z = buildCrusherSpan(stageIndex, z, t, tuning);
      break;
    case 8:
      z = buildLavaSteppers(stageIndex, z, t, tuning);
      break;
    case 9:
      z = buildFrostLedges(stageIndex, z, t, tuning);
      break;
    case 10:
      z = buildGaleGallery(stageIndex, z, t, tuning);
      break;
    case 11:
      z = buildSpireAscent(stageIndex, z, t, tuning);
      break;
    case 12:
      z = buildRuneMaze(stageIndex, z, t, tuning);
      break;
    default:
      z = buildPattern(
        stageIndex,
        z,
        t,
        tuning,
        PATTERNS[(stageIndex - 13) % PATTERNS.length] as PatternId,
      );
      break;
  }

  // The finish apron, and the small win pad at the player's LEFT.
  //
  // That is POSITIVE X. The camera looks down +Z and its right is
  // `(-cos yaw, sin yaw)`, which at yaw 0 is world -X - so a pad authored at
  // -10 sits on the player's right, however "left-hand" the number reads.
  pushFloor(stageIndex, z, z + FINISH_APRON);
  const winPadX = COURSE.halfWidth - WIN_PAD.insetX;
  const winPadZ = z + FINISH_APRON / 2;
  pushBox(
    stageIndex,
    'winPad',
    winPadX,
    COURSE.floorY,
    winPadZ,
    WIN_PAD.width,
    WIN_PAD.height,
    WIN_PAD.length,
  );
  // Braziers either side of the pad, so the one thing a player is looking for
  // at the end of a stage is also the brightest thing in the room.
  for (const side of [-1, 1]) {
    decorations.push({
      kind: 'brazier',
      stage: stageIndex,
      x: winPadX + side * (WIN_PAD.width / 2 + 3),
      y: COURSE.floorY,
      z: winPadZ,
      scale: 1.2,
      rotationY: 0,
    });
  }
  z += FINISH_APRON;

  // The bridge across to the next stage's run-up.
  pushFloor(stageIndex, z, z + COURSE.stageGap);
  const endZ = z + COURSE.stageGap;
  cursorZ = endZ;

  /*
   * And the roof, measured from what the stage actually built.
   *
   * Read back out of the arrays rather than tracked by each builder, for the
   * same reason a stage's LENGTH comes from the build cursor: a figure every
   * builder had to remember to report would be a figure one of them eventually
   * forgot, and the result - a spire poking through its own ceiling - is the
   * kind of bug that only shows up at the top of a stage nobody reaches early.
   */
  // Annotated, because `COURSE` is `as const` and the inferred type of its
  // members is the literal rather than `number`.
  let stageTop: number = COURSE.floorY;
  let stageHalfWidth: number = COURSE.halfWidth;
  for (let i = solidsFrom; i < solids.length; i += 1) {
    const solid = solids[i] as CourseSolid;
    if (solid.maxY > stageTop) stageTop = solid.maxY;
    if (solid.maxX > stageHalfWidth) stageHalfWidth = solid.maxX;
  }
  for (let i = sinkingFrom; i < sinking.length; i += 1) {
    const platform = sinking[i] as SinkingSolid;
    if (platform.maxY > stageTop) stageTop = platform.maxY;
  }
  pushCeiling(stageIndex, startZ, endZ, stageTop, stageHalfWidth);

  stages.push({
    index: stageIndex + 1,
    name: tuning.name,
    difficulty: tuning.difficulty,
    recommendedLevel: tuning.recommendedLevel,
    recommendedSpeed: totalSpeedToReach(tuning.recommendedLevel),
    recommendedFly: tuning.recommendedFly,
    startZ,
    endZ,
    winPadX,
    winPadZ,
    winReward: stageReward(stageIndex + 1),
  });
}

/** Every static solid, vault included. */
export const COURSE_SOLIDS: readonly CourseSolid[] = solids;

/** Every platform that sinks. */
export const SINKING_SOLIDS: readonly SinkingSolid[] = sinking;

/** Every lethal pool. */
export const QUICKSAND: readonly HazardPool[] = pools;

/** Every hazard. */
export const COURSE_HAZARDS: readonly CourseHazard[] = hazards;

/** Every piece of scenery the simulation ignores. */
export const DECORATIONS: readonly Decoration[] = decorations;

/** Every stage, in order. */
export const STAGES: readonly StageDefinition[] = stages;

/**
 * The base ballistic figures, exported so the verifier checks the rule rather
 * than a number copied out of it.
 */
export const BALLISTIC_REACH = BASE_BALLISTIC.reach;
export const BALLISTIC_RISE = BASE_BALLISTIC.rise;

/**
 * THE HARD END OF THE GAME. Z past which there is no more world.
 *
 * Sits past the last finish pad, so it never interferes with the final stage -
 * the player banks the last win and is returned to the vault long before this
 * matters.
 *
 * It is a CLAMP rather than a wall, and that is what makes it absolute:
 * `clampToBounds` applies it to the RESULT of every substep, after the move
 * has already integrated, so no speed outruns it the way a collider could be
 * tunnelled. It constrains Z and says nothing about Y, so there is no top to
 * fly over; it applies at every X, so there is no way around the side; and it
 * is not geometry, so there is nothing to see or to destroy.
 */
export const COURSE_END_Z: number =
  (stages[stages.length - 1]?.endZ ?? COURSE.lobbyEndZ) - 2;

/**
 * How far a sinking platform has dropped at a given time.
 *
 * The ONE definition, evaluated by the server to decide what the player is
 * standing on and by the client to draw it.
 */
export const sinkingOffsetAt = (
  platform: SinkingSolid,
  time: number,
): { drop: number; warning: boolean } => {
  const cycle = Math.max(0.1, platform.cycle);
  let t = (time + platform.phase) % cycle;
  if (t < 0) t += cycle;

  const steadyEnd = platform.steady;
  const warnEnd = steadyEnd + platform.warn;
  const sinkEnd = warnEnd + 0.45;
  const sunkEnd = sinkEnd + platform.sunk;

  if (t < steadyEnd) return { drop: 0, warning: false };
  // Still up, but shaking - the warning the player is meant to read.
  if (t < warnEnd) return { drop: 0, warning: true };
  if (t < sinkEnd) {
    const k = (t - warnEnd) / 0.45;
    return { drop: platform.depth * k * k, warning: false };
  }
  if (t < sunkEnd) return { drop: platform.depth, warning: false };

  // Rising back into place.
  const rise = Math.max(0.2, cycle - sunkEnd);
  const k = Math.min((t - sunkEnd) / rise, 1);
  return { drop: platform.depth * (1 - k), warning: false };
};

/**
 * Where a hazard is at a given time.
 *
 * The ONE definition of a hazard's position. The server evaluates it against
 * its own elapsed clock to decide a death; the client evaluates it against the
 * replicated clock to draw it. Neither can drift from the other because there
 * is nothing to drift - it is the same pure function.
 *
 * Writes into `out` so a per-substep hazard test allocates nothing.
 */
export const hazardPositionAt = (
  hazard: CourseHazard,
  time: number,
  out: { x: number; y: number; z: number },
): void => {
  out.x = hazard.x;
  out.y = hazard.y;
  out.z = hazard.z;

  switch (hazard.kind) {
    case 'spike':
      // Static. Returning the authored position unchanged is the whole
      // implementation, which is why a spike bed costs the hazard system
      // nothing it was not already paying for.
      return;
    case 'roller': {
      const span = Math.max(1, hazard.fromZ - hazard.toZ);
      let travelled = (time * hazard.rate + hazard.phase) % span;
      if (travelled < 0) travelled += span;
      out.z = hazard.fromZ - travelled;
      return;
    }
    case 'spinner':
    case 'tornado': {
      // A circle about (x, z). Several of these at stepped radii and one
      // phase make a rigid bar, which is how every chain, blade and censer in
      // the game is drawn without a second kind of collision test.
      const angle = time * hazard.rate + hazard.phase;
      out.x = hazard.x + hazard.sweep * Math.cos(angle);
      out.z = hazard.z + hazard.sweep * Math.sin(angle);
      return;
    }
    case 'faller': {
      out.y = fallerHeightAt(hazard, time);
      return;
    }
    default:
      // Sweeper: side to side across the corridor.
      out.x = hazard.x + hazard.sweep * Math.sin(time * hazard.rate + hazard.phase);
  }
};

/**
 * Height of a faller at a given time.
 *
 * Split out because the client needs it on its own, to size the warning shadow
 * on the ground from the SAME number the kill is decided by. A shadow drawn
 * from a second estimate of the drop is a warning that lies.
 */
export const fallerHeightAt = (hazard: CourseHazard, time: number): number => {
  const period = Math.max(0.6, hazard.rate);
  let t = (time + hazard.phase) % period;
  if (t < 0) t += period;

  const hoverEnd = period * 0.52;
  const fallEnd = hoverEnd + period * 0.1;
  const restEnd = fallEnd + period * 0.14;

  if (t < hoverEnd) return hazard.y + hazard.sweep;
  if (t < fallEnd) {
    // Accelerating, so it reads as falling rather than as descending.
    const k = (t - hoverEnd) / (fallEnd - hoverEnd);
    return hazard.y + hazard.sweep * (1 - k * k);
  }
  if (t < restEnd) return hazard.y;

  // Winched back up, decelerating into the hover.
  const k = (t - restEnd) / Math.max(0.1, period - restEnd);
  return hazard.y + hazard.sweep * k * (2 - k);
};

/**
 * How far from the centreline a hazard can ever get.
 *
 * Kind-aware, because `sweep` does not mean the same thing to all of them: it
 * is a horizontal amplitude to a sweeper and an orbit radius to a spinner, but
 * a FALL HEIGHT to a faller, which never moves sideways at all.
 */
export const hazardReachX = (hazard: CourseHazard): number => {
  switch (hazard.kind) {
    case 'sweeper':
    case 'spinner':
    case 'tornado':
      return Math.abs(hazard.x) + hazard.sweep + hazard.radius;
    default:
      // Rollers, fallers and spikes hold their lane.
      return Math.abs(hazard.x) + hazard.radius;
  }
};

/**
 * The Z range a hazard can ever reach, for the collision index's buckets.
 *
 * One definition, because a hazard bucketed too narrowly is simply not there:
 * it is drawn, it kills on the server, and the client's prediction never sees
 * it.
 */
export const hazardZRange = (hazard: CourseHazard): { minZ: number; maxZ: number } => {
  switch (hazard.kind) {
    case 'roller':
      return { minZ: hazard.toZ - hazard.radius, maxZ: hazard.fromZ + hazard.radius };
    case 'spinner':
    case 'tornado':
      return {
        minZ: hazard.z - hazard.sweep - hazard.radius,
        maxZ: hazard.z + hazard.sweep + hazard.radius,
      };
    default:
      return { minZ: hazard.z - hazard.radius, maxZ: hazard.z + hazard.radius };
  }
};

/**
 * Half-width of the playable corridor at a given Z.
 *
 * The vault is far wider than the run it feeds into, so the clamp has to know
 * where the player is standing.
 */
export const corridorHalfWidthAt = (z: number): number => {
  if (z <= COURSE.lobbyEndZ) return COURSE.lobbyHalfWidth;
  for (const area of wideAreas) {
    if (z >= area.minZ && z <= area.maxZ) return area.halfWidth;
  }
  return COURSE.halfWidth;
};

/**
 * Every stretch wider than the corridor, the starting vault included.
 *
 * The renderer walks this to build its walls, so a wall and a boundary cannot
 * end up in different places.
 */
export const WIDE_AREAS: readonly WideArea[] = [
  { minZ: COURSE.lobbyStartZ, maxZ: COURSE.lobbyEndZ, halfWidth: COURSE.lobbyHalfWidth },
  ...wideAreas,
];

/** The stage containing this Z, or null. */
export const stageAt = (z: number): StageDefinition | null => {
  for (const stage of stages) {
    if (z >= stage.startZ && z <= stage.endZ) return stage;
  }
  return null;
};

/**
 * The stage whose win pad the player is standing on, or null.
 *
 * A POSITION test rather than a message: a client says only that it thinks it
 * finished, and this is what the server checks that claim with.
 */
export const winPadAt = (x: number, y: number, z: number): StageDefinition | null => {
  if (y < COURSE.floorY - 1.5 || y > COURSE.floorY + 7) return null;
  for (const stage of stages) {
    if (Math.abs(z - stage.winPadZ) > WIN_PAD.length / 2) continue;
    if (Math.abs(x - stage.winPadX) > WIN_PAD.width / 2) continue;
    return stage;
  }
  return null;
};

/**
 * Every patch of ground that handles differently.
 *
 * Read by `stepPlayer` on both sides, so frost is exactly as slippery in the
 * client's prediction as in the server's simulation.
 */
export const SURFACE_REGIONS: readonly SurfaceRegion[] = surfaces;

/**
 * The surface a position is standing on, or null for ordinary ground.
 *
 * Returns the FIRST match, so a small patch pushed before the sheet it sits on
 * wins.
 */
export const surfaceAt = (x: number, z: number): SurfaceRegion | null => {
  for (const region of surfaces) {
    if (x < region.minX || x > region.maxX) continue;
    if (z < region.minZ || z > region.maxZ) continue;
    return region;
  }
  return null;
};

/** The lethal pool a position is inside, or null. */
export const quicksandAt = (x: number, z: number): HazardPool | null => {
  for (const pit of pools) {
    if (x < pit.minX || x > pit.maxX) continue;
    if (z < pit.minZ || z > pit.maxZ) continue;
    return pit;
  }
  return null;
};
