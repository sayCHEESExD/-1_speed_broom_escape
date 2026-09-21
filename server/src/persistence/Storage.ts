/**
 * THE STORAGE CONTRACT: what the game asks of wherever profiles and purchases
 * live. Two implementations, and `createStorage` is the ONLY place either is
 * named: MongoDB when `MONGODB_URI` is set (Bloxity Legion injects one per
 * game+channel), the JSON file otherwise (local development).
 *
 * Why PER KEY, and why it matters on Legion. Legion runs several pods against
 * ONE database. The previous contract loaded every profile at boot and wrote
 * the whole map back on each save - with two pods, each would write back its
 * own stale copy of everybody the other had changed. So:
 *
 *  - nothing ever writes back a whole-map snapshot: one document per player,
 *    and a write touches only the fields it names;
 *  - a profile is READ FROM STORAGE AT JOIN, never from a cache filled at boot,
 *    because another pod may have saved it since. (`loadAll` exists for the
 *    leaderboard, which may be a minute stale and says so.)
 */

/**
 * One player's saved progress.
 *
 * The fixed fields are the DERIVING facts - level, speed and the equipped broom
 * are recomputed from them on load, so a tuning change reaches returning
 * players. The index signature is deliberate: a document may carry fields this
 * build does not know about (written by a newer build, or by hand), and every
 * store must hand them back unchanged and never drop them on a write.
 */
export interface StoredProfile {
  totalSpeed: number;
  wins: number;
  ownedBrooms: number;
  rebirths: number;
  ownedTrails: number;
  trailSlot: number;
  bestStage: number;
  /** Wall clock of the last save. Newest wins when two copies are compared. */
  updatedAt: number;
  /**
   * Transaction ids of Bux purchases already paid into this profile.
   *
   * The exactly-once half of purchase fulfilment that lives WITH the Wins it
   * paid: a grant claimed by a pod that died before marking it applied is
   * re-claimable, and this list is how the second attempt knows not to pay
   * again. See `GrantStorage`.
   */
  appliedGrants?: string[];
  /** Account profiles only: the guest key this account's progress came from. */
  migratedFrom?: string;
  /**
   * Guest profiles only: the account key this guest's progress was migrated
   * INTO. Such a profile is a recovery copy - never restored, never migrated
   * again, never ranked.
   */
  migratedTo?: string;
  /**
   * How the player was last SHOWN: their Bloxity display name and profile
   * picture URL. Display only, kept so the leaderboards can name players who
   * are not connected. Never read to identify anybody, never shown as an id,
   * and refreshed from Bloxity every time the player is online.
   */
  displayName?: string;
  pfp?: string;
  [unknownField: string]: unknown;
}

/**
 * The fields a live session writes. Everything else in a document - migration
 * markers, fields from newer builds - is left exactly as it is.
 */
export const SESSION_FIELDS = [
  'totalSpeed',
  'wins',
  'ownedBrooms',
  'rebirths',
  'ownedTrails',
  'trailSlot',
  'bestStage',
  'updatedAt',
  'appliedGrants',
  'displayName',
  'pfp',
] as const;

/**
 * Storage could not answer.
 *
 * THROWN, never swallowed into "no profile": a read that failed and was taken
 * for "this player has nothing" would let them in on an empty profile, and the
 * first autosave would write that emptiness over their real progress. The room
 * refuses the join instead; the client's own retry gets them in once storage is
 * back.
 */
export class StorageUnavailableError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`storage unavailable: ${what}${cause ? ` (${String(cause)})` : ''}`);
    this.name = 'StorageUnavailableError';
  }
}

export interface ProfileStorage {
  /**
   * Connect and prepare. NEVER throws and never blocks the server from
   * listening: `/health` must keep answering while the database is down, or
   * Legion restart-loops the pod. Failures are logged loudly and every later
   * call fails cleanly instead.
   */
  open(): Promise<void>;

  /**
   * One profile, or null if there is none.
   *
   * Throws `StorageUnavailableError` if it cannot tell - see above for why
   * "cannot tell" must never become "none". A snapshot this process has queued
   * but not yet written is newer than the stored copy, and is what is returned.
   */
  get(key: string): Promise<StoredProfile | null>;

  /**
   * Queue the latest snapshot for a key. Returns at once.
   *
   * Only the newest queued snapshot per key is written; a failed write is
   * retried with backoff for as long as it takes and is NEVER dropped. Writes
   * set the fields they carry and preserve every other field of the document.
   */
  put(key: string, profile: StoredProfile): void;

  /**
   * Write NOW and wait for it to be durable. Throws on failure (and leaves the
   * snapshot queued, so it still lands later). Used where the next step must
   * not happen unless this one did - migration, and switching profiles.
   */
  write(key: string, profile: StoredProfile): Promise<void>;

  /**
   * Create a profile only if the key has none. True if this call created it;
   * false if one already existed (a race lost to another pod or session).
   * Throws if storage cannot answer.
   */
  insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean>;

  /** Every profile, for the leaderboard. Throws if storage cannot answer. */
  loadAll(): Promise<Map<string, StoredProfile>>;

  /** Wait until every queued write has landed, or `timeoutMs` passes. */
  flush(timeoutMs?: number): Promise<void>;

  close(): Promise<void>;

  /** For logs: which store this is. */
  readonly kind: 'mongo' | 'json';
}

/** One paid Bux purchase, as the webhook recorded it. */
export interface GrantRecord {
  readonly transactionId: string;
  readonly accountId: string;
  readonly sku: string;
  readonly wins: number;
}

/**
 * Bux purchases, durably, across pods and restarts.
 *
 * The lifecycle is claim -> apply -> mark applied, and each step is atomic in
 * the store:
 *
 *  - `record` inserts under the transaction id as a UNIQUE key, so a webhook
 *    retry is recognised however many pods it lands on;
 *  - `claim` hands each pending grant to exactly one caller, so two pods
 *    holding sessions for one account cannot both pay it;
 *  - `markApplied` closes it once the Wins are durably in the profile.
 *
 * A claim whose holder died before `markApplied` becomes claimable again after
 * a timeout, and the profile's `appliedGrants` list is what stops the second
 * attempt paying twice.
 */
export interface GrantStorage {
  /** Durably record a purchase. 'duplicate' if this transaction was already recorded. */
  recordGrant(grant: GrantRecord): Promise<'recorded' | 'duplicate'>;
  /** Atomically claim every pending (or abandoned) grant for an account. */
  claimGrants(accountId: string, claimant: string): Promise<GrantRecord[]>;
  /** Close a claimed grant. */
  markApplied(transactionId: string, profileKey: string): Promise<void>;
  /** Cheap check: is anything waiting for this account? */
  hasPendingGrants(accountId: string): Promise<boolean>;
}

export type Storage = ProfileStorage & GrantStorage;

/** A claim older than this is presumed abandoned by a dead pod. */
export const GRANT_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
