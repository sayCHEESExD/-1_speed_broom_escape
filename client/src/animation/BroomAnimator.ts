import { BroomAnimationState } from '@broom/shared';
import type { BroomModel } from '../broom/BroomModel.js';
import { DEATH, FLY, GAIT } from '../config/animationConfig.js';
import type { AnimationInput } from './AnimationInput.js';

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth 0..1 ramp between two thresholds. */
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The broom animator.
 *
 * The ONLY animation state machine for the broom. It consumes a read-only
 * `AnimationInput` and writes exclusively to the model's animated nodes - the
 * body and the bristles - plus the enchantment's brightness. It never moves
 * `root`, never touches velocity, and never decides a gameplay outcome. That
 * is the same separation the previous games enforced, and it is why swapping
 * brooms cannot break movement.
 *
 * THERE ARE TWO FLIGHT ANIMATIONS and the difference between them is the whole
 * job of this class:
 *
 *  1. RIDING - the broom level, the nose a few degrees down at speed, the
 *     bundle streaming flat out behind, a slow roll as the rider steers.
 *  2. ASCENDING - the nose pitched well up, the bundle flared and thrown down
 *     and back as it pushes against the air, the enchantment lit, the whole
 *     silhouette leaning into the climb.
 *
 * They are not two clips: they are one pose blended by `climb`, a smoothed
 * 0..1 that follows whether thrust is actually being spent. Blending rather
 * than switching is what makes a tap of the key read as a nudge upward rather
 * than as a pose popping on and off - and a broom that snapped between two
 * attitudes at the patch rate is the single most obvious way this mechanic
 * could have looked wrong.
 *
 * The sway phase advances with DISTANCE, not wall-clock time, so the bank and
 * the bundle's flutter stay in step with real movement - and the cadence is
 * clamped, so they stay readable when a late-game broom is covering four
 * hundred units a second.
 */
export class BroomAnimator {
  private readonly model: BroomModel;

  private phase = 0;
  private state: BroomAnimationState = BroomAnimationState.Idle;

  /** Seconds into the landing settle, or the death. */
  private landTime = -1;
  private deathTime = -1;

  /** Smoothed bank, so steering does not snap the broom onto its side. */
  private bank = 0;

  /** Smoothed cruise blend, so a speed spike does not pop the pose. */
  private cruise = 0;

  /**
   * Smoothed ASCENT blend, 0 level and 1 fully nose-up.
   *
   * The one number the two flight animations are told apart by. It rises fast
   * and falls slower, deliberately: thrust should look like it took effect on
   * the frame it was pressed, and letting go should look like a broom settling
   * rather than a pose being cancelled.
   */
  private climb = 0;

  constructor(model: BroomModel) {
    this.model = model;
  }

  get currentState(): BroomAnimationState {
    return this.state;
  }

  /**
   * The sway phase, in radians.
   *
   * Handed to the rider so both halves of the mount move to the SAME cycle. A
   * rider running its own clock is what makes a mounted pair look like two
   * animations played at each other rather than one performance.
   */
  get gaitPhase(): number {
    return this.phase;
  }

  /** How far into the climb pose the broom is, 0..1. Read by the rider. */
  get climbBlend(): number {
    return this.climb;
  }

  /** Seconds the death animation has been running, or -1. */
  get deathProgress(): number {
    return this.deathTime < 0 ? -1 : clamp(this.deathTime / DEATH.duration, 0, 1);
  }

  /** Clear every transient, e.g. after a respawn. */
  reset(): void {
    this.phase = 0;
    this.landTime = -1;
    this.deathTime = -1;
    this.bank = 0;
    this.cruise = 0;
    this.climb = 0;
    this.state = BroomAnimationState.Idle;
    this.model.resetPose();
  }

  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);

    if (input.dying) {
      this.deathTime = this.deathTime < 0 ? 0 : this.deathTime + dt;
      this.state = BroomAnimationState.Dying;
      this.writeDeath();
      return;
    }
    this.deathTime = -1;

    if (input.landed) this.landTime = 0;
    if (this.landTime >= 0) {
      this.landTime += dt;
      if (this.landTime > FLY.landDuration) this.landTime = -1;
    }

    // The cruise blend is measured against the player's OWN authoritative
    // speed scale, so "cruising" means the same thing at level 1 and level 80.
    const scale = Math.max(1, input.moveMultiplier);
    const target = smoothstep(
      GAIT.hoverSpeed * scale,
      GAIT.cruiseSpeed * scale,
      input.horizontalSpeed,
    );
    this.cruise += (target - this.cruise) * (1 - Math.exp(-6 * dt));

    // Asymmetric on purpose: pressing thrust should look instant and releasing
    // it should look like settling.
    const climbRate = input.flying ? FLY.climbInRate : FLY.climbOutRate;
    this.climb += ((input.flying ? 1 : 0) - this.climb) * (1 - Math.exp(-climbRate * dt));

    const stride = this.model.definition.strideLength;
    const frequency = clamp(
      input.horizontalSpeed / stride,
      GAIT.minFrequency,
      GAIT.maxFrequency,
    );

    const moving = input.horizontalSpeed > GAIT.idleSpeed;
    if (moving) {
      this.phase = (this.phase + frequency * TAU * dt) % TAU;
    } else {
      // Ease back toward a neutral phase, so setting off never begins with the
      // broom already rolled onto one side.
      const settleTarget = this.phase > Math.PI ? TAU : 0;
      this.phase += (settleTarget - this.phase) * (1 - Math.exp(-8 * dt));
      if (this.phase >= TAU - 1e-4) this.phase = 0;
    }

    this.bank +=
      (clamp(input.turn, -1, 1) * -GAIT.bankAngle - this.bank) *
      (1 - Math.exp(-GAIT.bankRate * dt));

    this.state = resolveState(input, moving, this.cruise);
    this.write(input, moving);
  }

  /**
   * ONE pose, blended.
   *
   * Every attitude this broom ever holds is written here from three numbers:
   * `cruise` (how fast), `climb` (how hard it is thrusting) and the vertical
   * velocity (which way it is actually going). There is deliberately no branch
   * between "grounded" and "airborne" poses - a broom does not change shape
   * when it leaves the floor, and a branch would be somewhere for the two
   * halves to disagree on the frame it did.
   */
  private write(input: AnimationInput, moving: boolean): void {
    const model = this.model;

    // Vertical attitude WITHOUT thrust: nose down as it falls, level as it
    // rises ballistically. This is what a broom that has run its meter dry
    // does, and telling it apart from a climb at a glance is the point.
    const rise = clamp(input.verticalVelocity / FLY.velocityReference, -1, 1);
    const ballisticPitch = rise >= 0 ? FLY.risePitch * rise : FLY.fallPitch * -rise;

    // The cruise tuck: a broom at speed drops its nose a few degrees.
    const cruisePitch = lerp(FLY.hoverPitch, FLY.cruisePitch, this.cruise);

    // And the climb, which overrides both as it comes in. `climb` is the ONLY
    // thing that produces a nose-up attitude, so a nose-up broom always means
    // "the meter is being spent" and never anything else.
    const pitch = lerp(cruisePitch + ballisticPitch, FLY.climbPitch, this.climb);

    // Bob: a gentle hover wobble at rest, a faster shallower one at speed, and
    // a firm push upward while thrusting.
    const bobAmount = lerp(FLY.bob.hover, FLY.bob.cruise, this.cruise);
    const weight = moving ? 1 : FLY.idleWeight;
    const bob =
      Math.sin(this.phase * 2 + (moving ? 0 : performance.now() * 0.0016)) *
      bobAmount *
      weight;

    const settle = this.landTime >= 0 ? 1 - clamp(this.landTime / FLY.landDuration, 0, 1) : 0;

    model.body.position.set(0, bob - FLY.landDrop * settle, 0);
    model.body.rotation.set(
      pitch,
      0,
      // The bank is the steer, plus a slow roll from the sway cycle so a broom
      // held straight is never perfectly rigid.
      this.bank + Math.sin(this.phase) * FLY.rollSway * weight,
    );
    model.body.scale.set(1, 1 - 0.12 * settle, 1);

    /*
     * The bundle.
     *
     * Streams flat back at speed, hangs slightly at a hover, and under thrust
     * FLARES: it swings down and back, which is the visual claim that the
     * broom is pushing against something. It also flutters with the sway
     * phase, harder the faster the broom is going, so a bundle is never a
     * rigid block bolted to a stick.
     */
    const streamed = lerp(FLY.bristleHang, FLY.bristleStream, this.cruise);
    const flutter =
      Math.sin(this.phase * 3) * lerp(FLY.bristleFlutter.hover, FLY.bristleFlutter.cruise, this.cruise) * weight;
    model.bristles.rotation.set(
      lerp(streamed, FLY.bristleFlare, this.climb) + flutter,
      Math.sin(this.phase * 2) * FLY.bristleYaw * weight,
      Math.sin(this.phase) * FLY.bristleRoll * weight,
    );

    // The enchantment brightens with thrust, so a broom seen head-on - with no
    // attitude to read - still says whether the meter is being spent.
    model.setGlow(this.climb * 0.8 + this.cruise * 0.2);
  }

  /**
   * The fall-over.
   *
   * The broom keels onto one side, pitches nose-down and sinks, and the bundle
   * drops. Simple and readable, exactly like the rest of the visual language -
   * this is a toy broom tipping out of the sky, not a ragdoll.
   */
  private writeDeath(): void {
    const model = this.model;
    const t = clamp(this.deathTime / DEATH.duration, 0, 1);
    // Ease-out, so it goes over quickly and settles rather than rotating at a
    // constant rate like a turntable.
    const eased = 1 - (1 - t) * (1 - t);

    model.body.position.set(0, -DEATH.drop * eased, 0);
    model.body.rotation.set(DEATH.pitch * eased, 0, DEATH.roll * eased);
    model.body.scale.set(1, 1, 1);
    model.bristles.rotation.set(FLY.bristleHang + 0.5 * eased, 0, 0);
    model.setGlow(0);
  }
}

const resolveState = (
  input: AnimationInput,
  moving: boolean,
  cruise: number,
): BroomAnimationState => {
  // Thrust wins, and it wins FIRST - for the same reason the server resolves
  // it first. A broom under thrust is ascending whatever else is true of it,
  // because that pose is the only on-screen statement that the meter is being
  // spent.
  if (input.flying) return BroomAnimationState.Ascending;
  if (!input.grounded) return BroomAnimationState.Airborne;
  if (!moving) return BroomAnimationState.Idle;
  return cruise > 0.5 ? BroomAnimationState.Cruise : BroomAnimationState.Hover;
};
