import type { AudioManager } from './AudioManager.js';

/**
 * Seconds between two beats of the THRUST loop.
 *
 * A fixed cadence rather than one per unit travelled, and that is the whole
 * difference between this game's loop and the previous one's hoofbeats: a
 * hoofbeat is a foot hitting the ground, so it belonged to distance, and
 * thrust is a broom pushing against the air, so it belongs to TIME. It sounds
 * the same standing still against a headwind as it does at three hundred units
 * a second, which is exactly right - the meter drains at the same rate either
 * way.
 */
const THRUST_INTERVAL = 0.14;

/** Below this, the broom is not really moving and should be silent. */
const MIN_AUDIBLE_SPEED = 2.5;

/** World units of travel between the soft ticks of an ordinary cruise. */
const CRUISE_TICK = 5.5;

/** Most cruise ticks a second, so a late-game broom hums rather than buzzes. */
const MAX_TICKS_PER_SECOND = 6;

/** What the audio layer needs to know about the mount. Read-only. */
export interface PlayerAudioInput {
  readonly horizontalSpeed: number;
  readonly maxRunSpeed: number;
  readonly isGrounded: boolean;
  readonly justJumped: boolean;
  readonly justLanded: boolean;
  readonly isDying: boolean;
  /** True while the meter is being spent. Drives the thrust loop. */
  readonly isFlying: boolean;
  /** True on the frame the meter ran dry under a held key. */
  readonly justDrained: boolean;
}

/**
 * Turns what the local mount is doing into sounds.
 *
 * Deliberately separate from `AudioManager`: one knows how to make a noise,
 * the other knows when the game wants one. Game code then has a single
 * `update` to call, and no part of the renderer or the simulation ends up with
 * an opinion about audio.
 *
 * ONLY the local player is fed through here. Remote riders are drawn and
 * animated but silent, because eight of them flying past would bury the one
 * broom whose thrust actually tells the player something.
 *
 * The thrust loop is the important one. Flight is a resource being spent, and
 * a player in mid-crossing is looking at the far platform rather than at the
 * bar - so the sound has to be the thing that says "you are still spending",
 * and the drain has to be the thing that says "you have stopped".
 */
export class PlayerAudio {
  private readonly audio: AudioManager;

  /** Distance since the last cruise tick. */
  private stride = 0;
  /** Seconds since the last beat of either loop, for the cadence clamp. */
  private sinceBeat = 0;
  /** So a death fires once per death rather than once per frame. */
  private wasDying = false;

  constructor(audio: AudioManager) {
    this.audio = audio;
  }

  update(delta: number, player: PlayerAudioInput): void {
    // A death is an EDGE. `isDying` stays true for the whole fall-over, and
    // playing on the level rather than the edge would retrigger it every frame
    // for the length of the animation.
    if (player.isDying) {
      if (!this.wasDying) {
        this.wasDying = true;
        this.audio.play('death');
      }
      this.stride = 0;
      return;
    }
    this.wasDying = false;

    if (player.justJumped) this.audio.play('jump');
    if (player.justLanded) this.audio.play('land', this.loudness(player));
    // The meter hitting zero, on the EDGE. It stays at zero for as long as the
    // player keeps holding the key, and a sound on the level would be a siren.
    if (player.justDrained) this.audio.play('drained');

    this.sinceBeat += delta;

    /*
     * THRUST beats on a clock, and it beats whatever else is happening.
     *
     * Checked before the movement loop and returning early, because the two
     * are alternatives rather than layers: a broom under thrust is making the
     * one noise the player needs to hear, and putting a cruise tick underneath
     * it would only make the thing being spent harder to hear.
     */
    if (player.isFlying) {
      this.stride = 0;
      if (this.sinceBeat < THRUST_INTERVAL) return;
      this.sinceBeat = 0;
      this.audio.play('step', 0.55 + this.loudness(player) * 0.45);
      return;
    }

    if (!player.isGrounded || player.horizontalSpeed < MIN_AUDIBLE_SPEED) {
      this.stride = 0;
      return;
    }

    this.stride += player.horizontalSpeed * delta;
    if (this.stride < CRUISE_TICK) return;
    if (this.sinceBeat < 1 / MAX_TICKS_PER_SECOND) {
      // Over the cadence ceiling: drop the beat rather than banking it, or a
      // fast broom would pay off a debt of ticks the moment it slowed.
      this.stride = 0;
      return;
    }

    this.stride = 0;
    this.sinceBeat = 0;
    this.audio.play('step', this.loudness(player) * 0.45);
  }

  /** Louder the faster the broom is going, as a fraction of its own top speed. */
  private loudness(player: PlayerAudioInput): number {
    const top = Math.max(1, player.maxRunSpeed);
    return Math.min(player.horizontalSpeed / top, 1);
  }
}
