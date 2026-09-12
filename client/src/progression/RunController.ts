import {
  STAND_ROW,
  broomForSlot,
  ownsBroom,
  standZ,
  winPadAt,
  type WorldCollision,
} from '@broom/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';

/** Seconds between two claim requests of the same kind. */
const REQUEST_COOLDOWN = 0.5;

/** What the controller may ask the server for. It never grants anything. */
export interface RunActions {
  claimStage(stageIndex: number): void;
  claimBroom(slot: number): void;
}

/**
 * Turns the player's position into REQUESTS.
 *
 * The one job: notice that the mount has entered a trigger volume and ask the
 * server about it. Every actual decision - whether the stage pays, whether the
 * broom is affordable, whether the player is really standing there - is made
 * server-side against the transform the server itself simulated. Nothing here
 * awards anything, and nothing here can.
 *
 * The single exception to "ask, do not decide" is DEATH, and it is a
 * prediction rather than a decision: the client starts the fall-over animation
 * the moment it can see the mount is doomed, because waiting a round trip for
 * the server's confirmation means the broom keeps galloping through thin air
 * for a tenth of a second. The server still decides; this only decides when to
 * start drawing.
 */
export class RunController {
  private readonly collision: WorldCollision;
  private readonly actions: RunActions;

  private stageCooldown = 0;
  private broomCooldown = 0;

  /** Replicated ownership, so a stand the player owns is not re-requested. */
  private ownedBrooms = 0;
  private wins = 0;

  constructor(collision: WorldCollision, actions: RunActions) {
    this.collision = collision;
    this.actions = actions;
  }

  /** Mirror the replicated wallet and inventory. Display and gating only. */
  setInventory(ownedBrooms: number, wins: number): void {
    this.ownedBrooms = ownedBrooms;
    this.wins = wins;
  }

  /**
   * @param elapsed the server's clock, for the hazard prediction. Hazards are
   *                a pure function of it on both sides.
   */
  update(delta: number, player: LocalPlayer, elapsed: number): void {
    this.stageCooldown = Math.max(0, this.stageCooldown - delta);
    this.broomCooldown = Math.max(0, this.broomCooldown - delta);

    // A mount already dying is not in any trigger volume that matters.
    if (player.isDying) return;

    const { x, y, z } = player.position;

    // Death prediction. The server confirms it with a Respawn; this is only
    // about starting the animation on the frame the player can see it happen.
    // `hasFallen` covers the death plane AND the quicksand pits, so the two
    // cannot get different answers here and on the server.
    if (this.collision.hasFallen(x, y, z) || this.collision.touchesHazard(x, y, z, elapsed)) {
      player.beginDeath();
      return;
    }

    const stage = winPadAt(x, y, z);
    if (stage && this.stageCooldown === 0) {
      this.stageCooldown = REQUEST_COOLDOWN;
      this.actions.claimStage(stage.index);
    }

    const slot = this.standAt(x, y, z);
    if (slot !== null && this.broomCooldown === 0) {
      // Asking for an broom already owned, or one the player plainly cannot
      // afford, would be a request the server refuses every frame. The server
      // still checks both - this only keeps the wire quiet.
      const broom = broomForSlot(slot);
      if (!ownsBroom(this.ownedBrooms, slot) && this.wins >= broom.winsRequired) {
        this.broomCooldown = REQUEST_COOLDOWN;
        this.actions.claimBroom(slot);
      }
    }
  }

  /**
   * Slot of the stand the player is on, or null.
   *
   * The same test the server runs, deliberately: a prediction that used
   * different bounds would ask for brooms the server refuses.
   */
  private standAt(x: number, y: number, z: number): number | null {
    if (Math.abs(x - STAND_ROW.x) > STAND_ROW.claimRadius) return null;
    if (y < -1 || y > 4) return null;
    for (let slot = 1; slot <= 32; slot += 1) {
      const broom = broomForSlot(slot);
      if (broom.slot !== slot) break;
      if (Math.abs(z - standZ(slot)) <= STAND_ROW.claimRadius) return slot;
    }
    return null;
  }
}
