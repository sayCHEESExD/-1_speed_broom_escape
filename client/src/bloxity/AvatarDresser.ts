import {
  DEFAULT_APPEARANCE,
  DEFAULT_PROPORTIONS,
  type AvatarAppearance,
  type AvatarProportions,
} from '@broom/shared';
import type { Mount } from '../player/Mount.js';
import { BloxityAvatar } from './BloxityAvatar.js';
import { bloxityRiderFactory } from './BloxityRiderFactory.js';
import { describeItem, peekItem } from './bloxityAssets.js';

/**
 * The body key while the rider is still the BUNDLED character - before any
 * Bloxity body has been built, or after one failed to load. Deliberately not
 * a key any look can produce, so the first look of all - Bloxity's default
 * included - always builds a Bloxity body.
 */
const BUNDLED = '\u0000bundled';

/** Retry a Bloxity body that failed to load: from here, doubling, to the cap. */
const RETRY_MIN_MS = 4000;
const RETRY_MAX_MS = 60_000;

/**
 * Puts one player's Bloxity appearance onto one mount.
 *
 * BLOXITY'S APPEARANCE IS THE SOURCE OF TRUTH - including Bloxity's DEFAULT
 * avatar. A player with nothing equipped is not "use this game's character":
 * they wear Bloxity's own default body (`player.glb` with its stock parts) in
 * Bloxity's own default skin (`skins/0.png`), exactly as the portal draws
 * them. The bundled `player.fbx` and its texture are a FALLBACK ONLY, worn
 * while the Bloxity body is loading and if it cannot be loaded at all - and a
 * failed load is retried on a backoff, so the fallback is never permanent.
 *
 * The single place that decides WHICH body a rider has, and it is deliberately
 * shared by the local player and every remote one: a player who looks one way
 * on their own screen and another way on everybody else's is the bug this
 * whole feature exists to remove, and two code paths is how that happens.
 *
 * The split of work is what keeps a re-dress cheap:
 *
 *  - the BODY is rebuilt only when a body PART changes, because that is the
 *    only thing that changes its geometry;
 *  - the skin, the hat, the back item and the proportions are applied to
 *    whatever body is currently mounted, and cost no rebuild at all.
 *
 * So the common case - somebody changes hat mid-run - re-parents one mesh.
 */
export class AvatarDresser {
  private readonly mount: Mount;
  private avatar: BloxityAvatar;

  /** The look as ASKED for, before a hat has had its say. */
  private requested: AvatarAppearance = DEFAULT_APPEARANCE;
  private requestedProportions: AvatarProportions = DEFAULT_PROPORTIONS;

  /** The look actually worn, after `forceHead`. */
  private appearance: AvatarAppearance = DEFAULT_APPEARANCE;
  private proportions: AvatarProportions = DEFAULT_PROPORTIONS;

  /** The body currently built or being built, as a key. `BUNDLED` until one is. */
  private bodyKey = BUNDLED;
  private retryDelay = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Guards against an out-of-order build.
   *
   * A body is fetched over the network, so two quick changes can resolve in
   * either order. The later request wins by token, not by arrival, which is
   * the same rule the skin and item loaders use.
   */
  private bodyToken = 0;

  private disposed = false;

  constructor(mount: Mount) {
    this.mount = mount;
    const rider = mount.rider;
    this.avatar = new BloxityAvatar(rider.visual, rider.model);
    // Start on Bloxity's DEFAULT avatar straight away, rather than waiting for
    // a look to arrive: a player whose portal never reports an avatar change
    // - a guest, a default account, an SDK that loaded late - must still be
    // drawn as Bloxity draws them, not as this game's bundled character. A
    // real look replaces this the moment it arrives.
    this.setLook(DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS);
  }

  /**
   * Wear this look.
   *
   * Safe to call on every patch: an unchanged look does no work, and nothing
   * here blocks. The mount keeps whatever body it already has - the bundled
   * default on a first join - until a new one has finished loading, so a
   * player is always drawn as something rather than as nothing.
   */
  setLook(requested: AvatarAppearance, proportions: AvatarProportions): void {
    if (this.disposed) return;

    this.requested = requested;
    this.requestedProportions = proportions;

    const appearance = this.forceHead(requested);
    this.appearance = appearance;
    this.proportions = proportions;

    // ALWAYS a Bloxity body. Nothing equipped yields Bloxity's default one -
    // `BloxityRiderFactory` keeps the stock parts for every empty slot, and
    // `BloxityAvatar` gives an unskinned Bloxity body Bloxity's default skin.
    const key = bodyKeyOf(appearance);
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      this.cancelRetry();
      this.retryDelay = RETRY_MIN_MS;
      void this.rebuildBody(appearance);
    }

    // The worn layer goes on regardless: it is valid on either body, and on a
    // rebuild it is applied again once the new one has arrived.
    this.avatar.apply(appearance, proportions);
  }

  dispose(): void {
    this.disposed = true;
    this.bodyToken += 1;
    this.cancelRetry();
    this.avatar.dispose();
  }

  /**
   * Let a hat override the head, the way the portal does.
   *
   * Bloxity applies `forceHeadId` when a hat is EQUIPPED - it writes the value
   * straight into `headId` - so a look that came from the portal already obeys
   * it and this changes nothing. It is applied again here because a renderer
   * should not depend on that: the look can reach this game from a join
   * option, from replicated state, or from an account dressed before the hat
   * declared the constraint, and in each of those a stale head would be drawn
   * inside a helmet that was modelled around the stock one.
   *
   * An unknown hat is fetched and the look re-applied when it lands, rather
   * than awaited: a hat nobody has seen before must not stall the body of a
   * player who is already on screen.
   */
  private forceHead(appearance: AvatarAppearance): AvatarAppearance {
    const hatId = appearance.hatId;
    if (!hatId) return appearance;

    const hat = peekItem(hatId);
    if (hat === undefined) {
      // Not looked up yet. Fetch, then run the whole decision again.
      void describeItem(hatId).then(() => {
        if (this.disposed || this.requested.hatId !== hatId) return;
        this.setLook(this.requested, this.requestedProportions);
      });
      return appearance;
    }

    const forced = hat?.forceHeadId;
    if (forced === undefined || forced === null) return appearance;

    // `'-1'` is Bloxity's "none", and none means the DEFAULT head - their
    // renderer restores the stock geometry rather than hiding anything. This
    // game spells that as an empty id, which `BloxityRiderFactory` already
    // reads as "leave the default head alone".
    const headId = forced === '-1' || forced === '' ? '' : forced;
    if (headId === appearance.headId) return appearance;

    return { ...appearance, headId };
  }

  private async rebuildBody(appearance: AvatarAppearance): Promise<void> {
    const token = (this.bodyToken += 1);

    const model = await bloxityRiderFactory.build(appearance);
    if (this.disposed || token !== this.bodyToken) return;

    if (!model) {
      // Bloxity's base body could not be fetched. The FALLBACK: keep - or go
      // back to - the bundled character, and try again on a backoff. Not
      // before: an avatar the player has actually equipped must not be
      // replaced by this game's texture because one request failed.
      if (this.mount.rider.model.userData['bloxityRider'] === true) {
        this.mount.setRider(null);
        const rider = this.mount.rider;
        this.avatar.rebind(rider.visual, rider.model, false);
        this.avatar.apply(this.appearance, this.proportions);
      }
      this.bodyKey = BUNDLED;
      this.scheduleRetry();
      return;
    }

    this.mount.setRider(model);

    const rider = this.mount.rider;
    this.avatar.rebind(rider.visual, rider.model, true);
    // Re-wear onto the body that just arrived. The skin and the accessories
    // were applied to the OLD one, and a rebind deliberately forgets them -
    // which is also what guarantees the Bloxity skin goes on AFTER the body,
    // with nothing left to paint the bundled texture over it afterwards.
    this.avatar.apply(this.appearance, this.proportions);
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed || this.bodyKey !== BUNDLED) return;
      this.setLook(this.requested, this.requestedProportions);
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/**
 * What makes two looks the same BODY.
 *
 * Body parts only. A hat, a skin or a set of proportions changes how a rider
 * looks without changing the geometry underneath, so including them here would
 * refetch and rebuild an identical body every time somebody changed hat.
 */
const bodyKeyOf = (a: AvatarAppearance): string =>
  [a.headId, a.torsoId, a.armLId, a.armRId, a.legLId, a.legRId].join('|');
