import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning.
 *
 * Data-driven on purpose: every number both animators use lives here, so the
 * mount can be re-tuned without touching a line of logic. All rider rotations
 * are in CHARACTER space (see `PlayerRig`); all broom rotations are in the
 * broom's own node space.
 */

/** The sway cycle every broom rides to. */
export const GAIT = {
  /**
   * Cycle frequency clamp, in cycles per second.
   *
   * The upper bound is the single most important number in this file. Phase
   * advances with DISTANCE, so a level-80 broom at four hundred units a second
   * would otherwise sway 150 times a second - a strobe, not a ride. Clamping
   * the cadence means the motion stays readable at any speed and the sense of
   * pace comes from the world going past, which is where it belongs.
   */
  minFrequency: 0.55,
  maxFrequency: 2.6,

  /** Below this speed the broom is hanging still. */
  idleSpeed: 0.6,
  /** Speed at which the hover pose is fully in effect, before the multiplier. */
  hoverSpeed: 8,
  /** Speed at which the cruise pose is fully in effect, before the multiplier. */
  cruiseSpeed: 20,

  /** How far the broom banks into a steer, and how quickly it gets there. */
  bankAngle: deg(24),
  bankRate: 5,
} as const;

/**
 * FLIGHT: the two riding animations and everything between them.
 *
 * One pose blended by `climb`, never two clips. The level ride and the nose-up
 * ascent share every number here; what changes between them is how far toward
 * `climbPitch` and `bristleFlare` the blend has travelled.
 */
export const FLY = {
  /** Body pitch at a hover and at full cruise. Negative is nose-UP. */
  hoverPitch: deg(2),
  cruisePitch: deg(-6),
  /**
   * Body pitch under thrust - THE ascending animation.
   *
   * Well past anything the cruise or the ballistic arc can produce, so a
   * nose-up broom always means "the meter is being spent" and never anything
   * else. Big enough to read from behind at speed and short of vertical,
   * because a broom standing on its tail would hide the rider.
   */
  climbPitch: deg(-27),

  /** Ballistic attitude, for a broom with no thrust left. */
  risePitch: deg(-6),
  fallPitch: deg(14),
  /** Vertical velocity at which those pitches are fully applied. */
  velocityReference: 16,

  /** How quickly the climb pose comes in, and how slowly it lets go. */
  climbInRate: 16,
  climbOutRate: 7,

  /** Vertical bob amplitude, hover -> cruise, in world units. */
  bob: { hover: 0.09, cruise: 0.045 },
  /** Amplitude retained while hanging still, so a parked broom is alive. */
  idleWeight: 0.35,
  /** Slow roll from the sway cycle, on top of the steering bank. */
  rollSway: deg(3),

  /** Seconds of settle after touching down, and how far the broom dips. */
  landDuration: 0.18,
  landDrop: 0.22,

  /** Bristle bundle pitch: hanging at rest, streaming flat at speed. */
  bristleHang: deg(16),
  bristleStream: deg(-4),
  /**
   * Bristle pitch under thrust.
   *
   * Thrown DOWN and back, which is the bundle's whole contribution to the
   * ascent: it is the visual claim that the broom is pushing against
   * something, and without it a climbing broom is just a tilted stick.
   */
  bristleFlare: deg(42),
  /** Flutter, yaw and roll of the bundle as the broom sways. */
  bristleFlutter: { hover: deg(2.5), cruise: deg(6) },
  bristleYaw: deg(5),
  bristleRoll: deg(7),
} as const;

/** The fall-over. Readable, brief, and deliberately not gruesome. */
export const DEATH = {
  /** Seconds the whole animation runs before the respawn is applied. */
  duration: 0.55,
  /** How far the broom keels over, in radians. */
  roll: deg(96),
  /** How far it pitches nose-down as it goes. */
  pitch: deg(24),
  /** How far the body sinks. */
  drop: 0.6,
} as const;

/**
 * The rider.
 *
 * A single held pose plus secondary motion - which is the whole brief: the
 * player should look naturally seated rather than frozen, and the broom is
 * what carries the performance.
 *
 * The rider's WALK CYCLE NEVER PLAYS. A rider whose legs cycle while they are
 * astride a broom is the single most obvious way a mounted character looks
 * wrong, so the locomotion cycle does not exist on this side of the mount.
 */
export const RIDE = {
  /** The seated pose, held while riding. */
  pose: {
    // Thighs forward and YAWED OUTWARD, so the legs straddle the shaft and reach the pegs. The
    // outward part has to be a yaw, not a roll: a thigh already swung forward
    // is pointing along the character's own Z, and rolling about Z just spins
    // it about its own length - which is why a roll left the knees inside the
    // broom however far it was pushed.
    LegL1: { x: deg(-72), y: deg(22) },
    LegR1: { x: deg(-72), y: deg(-22) },
    // Shins fold back and OUT, so the feet hang past the broom's flanks
    // rather than tucking under its belly. The thigh alone cannot clear a
    // barrel wider than it is long - the hips are only 0.6 apart - so the
    // outward reach has to come from the shin.
    LegL2: { x: deg(66), y: deg(14) },
    LegR2: { x: deg(66), y: deg(-14) },
    // Arms forward and yawed IN, as though holding reins over the withers.
    // The shoulders are a full unit apart, so without the inward yaw the hands
    // sit wider than the broom's neck.
    ArmL1: { x: deg(-54), y: deg(-26) },
    ArmR1: { x: deg(-54), y: deg(26) },
    ArmL2: { x: deg(34) },
    ArmR2: { x: deg(34) },
    // A slight forward set through the spine, head level.
    Spine1: { x: deg(8) },
    Spine2: { x: deg(3) },
    Neck1: { x: deg(-8) },
  } satisfies PoseDefinition,

  /** Amplitude of the rider's own bounce against the broom's sway. */
  bounce: { hover: deg(3), cruise: deg(6) },
  /** Vertical rise and fall in the seat, in world units. */
  postingHeight: { hover: 0.025, cruise: 0.05 },
  /** Extra forward lean at full cruise - the racing tuck. */
  cruiseLean: deg(13),
  /**
   * Extra forward lean while CLIMBING.
   *
   * Layered on top of the broom's own nose-up pitch rather than replacing it:
   * the broom tilts back and the rider leans in, which together read as
   * someone driving a climb rather than as a passenger being tipped backward.
   */
  climbLean: deg(19),
  /** How far the arms reach forward as the rider hauls the nose up. */
  climbArmReach: deg(-20),
  /** Idle breathing, so a stopped rider is never completely still. */
  breathFrequency: 0.4,
  breathAmount: deg(2),

  /** Lean applied while falling without thrust, blended by vertical velocity. */
  riseLean: deg(-9),
  fallLean: deg(11),
  /** Arms rise as the broom leaves the ground. */
  jumpArmLift: deg(-22),

  /** How far the rider slumps as the broom goes over. */
  deathSlump: deg(52),
} as const;

/** Seconds a pose change takes to blend in. One number, used everywhere. */
export const POSE_BLEND_RATE = 12;
