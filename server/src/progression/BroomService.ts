import {
  COURSE,
  STAND_ROW,
  broomBit,
  broomForSlot,
  bestOwnedBroom,
  ownsBroom,
  standZ,
  type BroomDefinition,
} from '@broom/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

/** How a claim was resolved. */
export interface BroomClaim {
  readonly granted: boolean;
  readonly broom: BroomDefinition | null;
  readonly reason?: 'unknown-slot' | 'not-at-stand' | 'already-owned' | 'too-poor' | 'cooldown';
}

/**
 * Milliseconds between two accepted claims from one player.
 *
 * Spam protection ONLY, which is why it is short and why it is checked last.
 * An broom already owned or a player not at the stand is refused on its own
 * merits, and neither should ever be reported as a cooldown.
 */
const CLAIM_COOLDOWN_MS = 250;

/**
 * Server authority over which brooms a player owns and which one they ride.
 *
 * Claiming is a DELIBERATE ACT: the player has to walk their current mount
 * onto the stand while holding enough Wins. Reaching the Wins total alone does
 * nothing, which is what makes the lobby a place rather than a menu.
 *
 * Wins are SPENT - the price is deducted here - and the best broom OWNED is
 * always equipped, so a purchase can never downgrade anyone and spending can
 * never remove an broom already claimed. Taking payment, granting the broom
 * and equipping it happen together in one method, so the wallet and the
 * inventory cannot disagree.
 */
export class BroomService {
  private readonly lastClaimAt = new Map<string, number>();

  initialise(player: PlayerState): void {
    this.lastClaimAt.set(player.sessionId, 0);
    this.equipBest(player);
  }

  forget(sessionId: string): void {
    this.lastClaimAt.delete(sessionId);
  }

  /**
   * Slot of the stand the player is standing on, or null.
   *
   * A pure position test against the authoritative transform - this is what
   * turns "near an broom" into "may claim it".
   */
  standAt(x: number, y: number, z: number): number | null {
    // The line-up is a COLUMN down the arena's left wall, so the fixed axis is
    // X and the per-slot axis is Z. A row across the middle of a room this big
    // would have cut straight through the space it exists to provide.
    if (Math.abs(x - STAND_ROW.x) > STAND_ROW.claimRadius) return null;
    if (y < COURSE.floorY - 1 || y > COURSE.floorY + 4) return null;

    for (let slot = 1; slot <= 32; slot += 1) {
      const broom = broomForSlot(slot);
      if (broom.slot !== slot) break;
      if (Math.abs(z - standZ(slot)) <= STAND_ROW.claimRadius) return slot;
    }
    return null;
  }

  /** Resolve a claim. The server decides; the client only asked. */
  claim(player: PlayerState, slot: number, speeds: SpeedService): BroomClaim {
    const requested = Math.floor(slot);
    const broom = broomForSlot(requested);
    if (broom.slot !== requested) {
      return { granted: false, broom: null, reason: 'unknown-slot' };
    }

    // THE position check, against the transform the server itself simulated.
    if (this.standAt(player.x, player.y, player.z) !== broom.slot) {
      return { granted: false, broom, reason: 'not-at-stand' };
    }

    if (ownsBroom(player.ownedBrooms, broom.slot)) {
      return { granted: false, broom, reason: 'already-owned' };
    }

    if (!wallet.canAfford(player, broom.winsRequired)) {
      return { granted: false, broom, reason: 'too-poor' };
    }

    // Checked LAST, so the deterministic reasons above are always the ones
    // reported and a burst of requests cannot mask a real refusal.
    const now = Date.now();
    if (now - (this.lastClaimAt.get(player.sessionId) ?? 0) < CLAIM_COOLDOWN_MS) {
      return { granted: false, broom, reason: 'cooldown' };
    }

    // Payment, grant and equip together. Nothing between them can fail.
    if (!wallet.spend(player, broom.winsRequired)) {
      return { granted: false, broom, reason: 'too-poor' };
    }
    player.ownedBrooms |= broomBit(broom.slot);
    this.lastClaimAt.set(player.sessionId, now);
    this.equipBest(player);
    // Movement speed, jump velocity and Speed-per-stride all follow from the
    // broom, so they are re-derived through the one formula rather than
    // written here.
    speeds.syncDerived(player);

    return { granted: true, broom };
  }

  /**
   * Equip the best broom owned.
   *
   * "Best" is by Speed per stride, which is the order the stands are in, so
   * this can never be a downgrade after a purchase.
   */
  equipBest(player: PlayerState): void {
    const best = bestOwnedBroom(player.ownedBrooms);
    player.broomSlot = best.slot;
    player.speedPerStep = best.speedPerStep;
  }
}
