/**
 * The gameplay signals both animators consume each frame.
 *
 * This is the whole contract between gameplay and presentation. An animator
 * reads it and never writes back: it cannot move the mount, cannot change
 * velocity and cannot decide a gameplay outcome.
 *
 * The identical struct is produced by the local player from its own prediction
 * and by each remote player from replicated network state, so local and remote
 * mounts run the exact same animation code.
 */
export interface AnimationInput {
  /** Standing on a surface. */
  grounded: boolean;
  /** Horizontal speed in world units per second. */
  horizontalSpeed: number;
  /**
   * The player's authoritative movement multiplier.
   *
   * The cruise blend is measured against it rather than against a fixed speed:
   * at level 80 a "hover" is eighty units a second, and a fixed threshold
   * would leave every late-game broom permanently at full cruise.
   */
  moveMultiplier: number;
  /** Vertical velocity in world units per second; negative is falling. */
  verticalVelocity: number;
  /** -1..1 steering, for the bank. */
  turn: number;
  /**
   * True while THRUST is being spent.
   *
   * The one signal that separates the game's two flight animations, and it is
   * carried here rather than derived from vertical velocity for a reason: a
   * broom thrown upward by a launch and a broom climbing under power look the
   * same to the physics and must not look the same on screen. Local prediction
   * and replicated remote state both fill it, so both sides of the wire
   * animate the mechanic identically.
   */
  flying: boolean;
  /** True on the frame the mount leaves the ground under its own power. */
  jumpStarted: boolean;
  /** True on the frame the mount touches down. */
  landed: boolean;
  /** True while the death animation should play. */
  dying: boolean;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  moveMultiplier: 1,
  verticalVelocity: 0,
  turn: 0,
  flying: false,
  jumpStarted: false,
  landed: false,
  dying: false,
});
