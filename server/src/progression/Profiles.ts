import { randomBytes } from 'node:crypto';
import { INITIAL_OWNED_BROOMS } from '@broom/shared';
import { storage, type StoredProfile } from '../persistence/index.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';

const SCOPE = 'profiles';

/**
 * PROFILE KEYS - whose progress a document is.
 *
 *  - An ACCOUNT's key is `bloxity:<accountId>`, and the account id only ever
 *    comes from Bloxity verifying the player's token.
 *  - A GUEST's key is the id their browser generated and keeps in
 *    localStorage (`p_...`), exactly as before accounts existed.
 *
 * The prefix is RESERVED. A browser id that starts with it is refused
 * outright, or a guest could simply name themselves `bloxity:<someone>` and be
 * handed that account's progress without ever proving who they are.
 */
export const ACCOUNT_PREFIX = 'bloxity:';

export const accountKey = (accountId: string): string => `${ACCOUNT_PREFIX}${accountId}`;

/** A browser id's shape. Wide enough for every id a real client has ever made. */
const GUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The guest key a join's `playerId` names, `null` if it names none, or
 * `'reserved'` if it tries to name an account.
 */
export const guestKeyFrom = (raw: unknown): string | null | 'reserved' => {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.startsWith(ACCOUNT_PREFIX)) return 'reserved';
  return GUEST_ID.test(raw) ? raw : null;
};

/** A new guest identity, for a browser whose old one was migrated into an account. */
export const freshGuestKey = (): string => `p_${randomBytes(9).toString('base64url')}`;

/** Most purchase transaction ids a profile remembers. Far more than a session will ever reclaim. */
const APPLIED_GRANTS_KEPT = 200;

/** Everything a live session writes, from its player state. */
export const snapshotOf = (player: PlayerState, appliedGrants: ReadonlySet<string>): StoredProfile => ({
  totalSpeed: player.totalSpeed,
  wins: player.wins,
  ownedBrooms: player.ownedBrooms,
  rebirths: player.rebirths,
  ownedTrails: player.ownedTrails,
  trailSlot: player.trailSlot,
  bestStage: player.bestStage,
  updatedAt: Date.now(),
  appliedGrants: [...appliedGrants].slice(-APPLIED_GRANTS_KEPT),
});

/**
 * Put a profile's DERIVING facts onto player state - or a fresh start's, for
 * null. Level, movement speed and the equipped broom are left to their own
 * services, which the caller re-runs afterwards in the same order `onJoin` does.
 */
export const applyProfile = (player: PlayerState, profile: StoredProfile | null): void => {
  player.totalSpeed = profile?.totalSpeed ?? 0;
  player.wins = profile?.wins ?? 0;
  // A profile saved before the roster existed owns nothing; the starter is
  // free, so it is always granted rather than leaving the player unmounted.
  player.ownedBrooms = (profile?.ownedBrooms ?? 0) | INITIAL_OWNED_BROOMS;
  player.rebirths = profile?.rebirths ?? 0;
  player.ownedTrails = profile?.ownedTrails ?? 0;
  player.trailSlot = profile?.trailSlot ?? 0;
  player.bestStage = profile?.bestStage ?? 0;
};

/** Has this profile got anything worth carrying into an account? */
export const hasProgress = (profile: StoredProfile | null): boolean =>
  !!profile &&
  (profile.totalSpeed > 0 ||
    profile.wins > 0 ||
    profile.rebirths > 0 ||
    profile.bestStage > 0 ||
    profile.ownedTrails > 0 ||
    (profile.ownedBrooms & ~INITIAL_OWNED_BROOMS) !== 0);

/** Which profile a session ends up on, and anything the caller must act on. */
export interface Resolution {
  /** The key the session saves to from now on. */
  readonly key: string;
  /** What to load. Null is a fresh start. */
  readonly profile: StoredProfile | null;
  /** Set when the browser's old guest id is spent and it must use this one. */
  readonly newGuestKey?: string;
  /** Set when this resolution migrated a guest's progress into the account. */
  readonly migratedFrom?: string;
}

/**
 * The profile a VERIFIED account plays on, migrating a guest's progress into
 * it the first time the account is seen.
 *
 * THE RULES, in the order they are applied:
 *
 *  1. An account that has a profile ALWAYS wins. Browser data never touches it.
 *  2. An account with none, signing in from a browser whose guest profile has
 *     real progress, gets a COPY of that progress (`insertIfAbsent`, stamped
 *     `migratedFrom`). Mid-session, `liveGuest` is the session's current state,
 *     which is newer than its last autosave.
 *  3. Only once that insert has succeeded is the guest copy marked
 *     `migratedTo`. A crash between the two leaves the progress in both places
 *     - duplicated, never lost - and the guest copy keeps its data as a
 *     recovery copy either way.
 *  4. A guest copy already `migratedTo` somewhere is never migrated again,
 *     which is what stops one browser seeding progress into many accounts. An
 *     empty guest profile is not migrated at all.
 *  5. If the insert loses a race (another pod or tab created the account a
 *     moment earlier), the winner is loaded instead.
 *
 * Throws `StorageUnavailableError` if storage cannot answer - the caller
 * refuses the join, or stays on its current profile.
 */
export const resolveAccount = async (
  accountId: string,
  guestKey: string | null,
  liveGuest?: StoredProfile,
): Promise<Resolution> => {
  const key = accountKey(accountId);

  const existing = await storage.get(key);
  if (existing) return { key, profile: existing };

  if (guestKey) {
    // The STORED guest copy is read even when the live state is at hand: it
    // is the one that carries the migration marker and any unknown fields.
    const storedGuest = await storage.get(guestKey);
    const source = liveGuest ? { ...(storedGuest ?? {}), ...liveGuest } : storedGuest;

    if (source && !storedGuest?.migratedTo && hasProgress(source as StoredProfile)) {
      const seed: StoredProfile = { ...(source as StoredProfile), migratedFrom: guestKey, updatedAt: Date.now() };
      delete seed.migratedTo;
      delete seed.appliedGrants;

      if (await storage.insertIfAbsent(key, seed)) {
        // Marked only NOW, after the account copy exists.
        try {
          await storage.write(guestKey, { ...(source as StoredProfile), migratedTo: key });
        } catch {
          // Still queued, so it lands when storage recovers. Until then the
          // guest copy is unmarked - which can duplicate progress, never lose it.
          logger.warn(SCOPE, `migration marker for ${guestKey} queued; it will land when storage is back`);
        }
        logger.info(SCOPE, `migrated guest progress ${guestKey} -> ${key}`);
        return { key, profile: seed, migratedFrom: guestKey };
      }
      // Lost the race: somebody else created the account just now. Theirs wins.
      return { key, profile: await storage.get(key) };
    }
  }

  return { key, profile: null };
};

/**
 * The profile a GUEST plays on.
 *
 * A guest copy that was migrated into an account is a recovery copy: it is
 * never restored, and the browser is handed a fresh id so that its new guest
 * progress cannot be saved over that copy. Throws if storage cannot answer.
 */
export const resolveGuest = async (guestKey: string | null): Promise<Resolution> => {
  if (!guestKey) {
    const fresh = freshGuestKey();
    return { key: fresh, profile: null, newGuestKey: fresh };
  }
  const guest = await storage.get(guestKey);
  if (guest?.migratedTo) {
    const fresh = freshGuestKey();
    return { key: fresh, profile: null, newGuestKey: fresh };
  }
  return { key: guestKey, profile: guest };
};
