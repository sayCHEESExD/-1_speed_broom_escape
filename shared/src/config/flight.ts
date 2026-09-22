/**
 * Broom flight.
 *
 * The one mechanic this game is built around, and the ONE place its numbers
 * live. Both halves of the wire read them: the server simulates flight from
 * these and the client predicts with the identical figures, so the meter on
 * screen and the meter the server is billing cannot drift.
 *
 * The shape of the mechanic, in one paragraph, because every number below
 * follows from it: holding the thrust key lifts the rider and BURNS the meter
 * in real seconds. Releasing it stops the burn but not the fall. The meter
 * only refills on the ground, and slower than it drains. So a player crossing
 * a long gap has to decide when to spend and when to glide, and a course of
 * wide gaps over lava cannot be flown end to end however good the broom is.
 */
export interface FlightConfig {
  /**
   * Meter seconds spent per real second of thrust.
   *
   * Exactly 1, and it must stay 1: `flyCapacity` is authored as SECONDS OF
   * FLIGHT on the stand sign, and any other rate here would make the number
   * the player is sold differ from the number they get.
   */
  readonly drainPerSecond: number;
  /**
   * Meter seconds refilled per second STANDING ON THE GROUND.
   *
   * Under the drain rate on purpose. A broom that refilled as fast as it
   * emptied would turn every landing into a full tank and make the capacity
   * ladder meaningless - the player would simply touch down between gaps.
   * (It was 0.45, which made resting on a platform a long wait: an empty
   * starter tank took over 20 s to refill. At 0.9 it is about 11 s.)
   */
  readonly regenPerSecond: number;
  /**
   * Seconds on the ground before the refill begins.
   *
   * Stops a player tapping the floor mid-gap and taking off again with more
   * than they landed with. Long enough to feel like a rest, short enough that
   * a stage's own platforms are still where you recover.
   */
  readonly regenDelay: number;
  /** Upward acceleration while thrusting, world units per second squared. */
  readonly thrust: number;
  /**
   * Largest climb rate thrust will produce, world units per second.
   *
   * A CEILING on the rise, not on the fall: a rider who has stopped thrusting
   * drops at whatever gravity has given them. Without it, holding thrust over
   * a long stage would simply accelerate upward for ever and every ceiling in
   * the dungeon would be decoration.
   */
  readonly maxRise: number;
  /**
   * Impulse applied on the frame thrust starts FROM THE GROUND.
   *
   * The launch. A broom does not hop, so this replaces the previous game's
   * jump entirely: there is one button, it costs meter, and `jumpVelocity`
   * from the shared movement profile is what scales it.
   */
  readonly launchScale: number;
  /**
   * Air control multiplier while thrusting, against `MOVEMENT.airControl`.
   *
   * Flying steers far better than falling does - that is what makes flight a
   * route rather than a longer jump - but it is still short of ground control,
   * so a long crossing has to be aimed before it is committed to.
   */
  readonly airControl: number;
  /**
   * Downward acceleration multiplier while thrusting.
   *
   * Gravity is REDUCED rather than cancelled, so a broom at the top of its
   * climb still sinks if the rider stops. Cancelling it would make a hover
   * free and the whole meter cosmetic.
   */
  readonly gravityScale: number;
  /**
   * Meter seconds a fresh takeoff costs before any thrust is credited.
   *
   * Spam protection with teeth: without it, tapping the key sixty times a
   * second would buy sixty launch impulses for a fraction of a second of
   * meter, which is a free ladder into the sky.
   */
  readonly launchCost: number;
}

export const FLIGHT: FlightConfig = {
  drainPerSecond: 1,
  regenPerSecond: 0.9,
  regenDelay: 0.6,
  thrust: 82,
  maxRise: 21,
  launchScale: 0.8,
  airControl: 0.92,
  gravityScale: 0.34,
  launchCost: 0.35,
};

/**
 * How far a broom can carry a rider horizontally on ONE full meter.
 *
 * Used by the course verifier to decide whether a gap is crossable rather than
 * merely large, so the stage builder and the thing that checks it read one
 * definition. Deliberately conservative: it assumes the rider spends the whole
 * meter and arrives with nothing, which is the worst case a stage may ask for.
 *
 * @param runSpeed  the player's own authoritative gallop speed
 * @param capacity  the equipped broom's `flyCapacity`
 */
export const flightReach = (runSpeed: number, capacity: number): number => {
  const seconds = Math.max(0, capacity) * FLIGHT.airControl;
  return Math.max(0, runSpeed) * seconds;
};

/** Clamp a meter reading into the range a broom can actually hold. */
export const clampFlight = (value: number, capacity: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), Math.max(0, capacity));
};
