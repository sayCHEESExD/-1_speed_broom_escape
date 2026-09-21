import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { MongoClient, MongoServerError, type Collection, type Db } from 'mongodb';
import { logger } from '../util/logger.js';
import {
  GRANT_CLAIM_TIMEOUT_MS,
  SESSION_FIELDS,
  StorageUnavailableError,
  type GrantRecord,
  type Storage,
  type StoredProfile,
} from './Storage.js';

const SCOPE = 'mongo';

/**
 * How long one operation may take before it counts as "storage unavailable".
 *
 * Bounded well inside Colyseus's 15-second seat reservation, which a join's
 * `onAuth` - token check, profile read, possibly a migration - has to fit in.
 */
const OP_TIMEOUT_MS = 4000;

/** Retry backoff for a failed queued write: doubles from here... */
const RETRY_MIN_MS = 1000;
/** ...up to here, and then keeps trying at this pace for as long as it takes. */
const RETRY_MAX_MS = 30_000;

/** A grant document, as stored. `_id` is the transaction id - the unique key. */
interface GrantDoc {
  _id: string;
  accountId: string;
  sku: string;
  wins: number;
  status: 'pending' | 'claimed' | 'applied';
  createdAt: number;
  claimedBy?: string;
  claimedAt?: number;
  appliedAt?: number;
  appliedTo?: string;
}

type ProfileDoc = StoredProfile & { _id: string };

/**
 * Profiles and purchases in MongoDB - the store on Bloxity Legion.
 *
 * Legion injects `MONGODB_URI`: "an ISOLATED managed Mongo db scoped to THIS
 * game+channel", so dev and prod never see each other's players. The database
 * used is the one the URI names (`client.db()` with no argument). There is no
 * Bloxity database API; this is the official `mongodb` driver talking to it.
 *
 * Several pods share this database, which is the whole reason for the rules
 * below. One document per player, keyed by profile key. Writes are
 * `updateOne({_id}, {$set: <session fields>}, {upsert: true})` - idempotent, and
 * touching only the fields a live session owns, so migration markers and any
 * field a newer build added survive every save. Nothing here ever `$unset`s:
 * this game has no optional field a session is allowed to clear.
 */
export class MongoStorage implements Storage {
  readonly kind = 'mongo' as const;

  private client: MongoClient | null = null;
  private db: Db | null = null;

  /** Latest unwritten snapshot per key. The newest one is all that matters. */
  private readonly queued = new Map<string, StoredProfile>();
  /** Keys with a write in flight, so a key never has two at once. */
  private readonly writing = new Set<string>();
  /** Current retry delay per key after a failure. */
  private readonly backoff = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private closed = false;

  constructor(
    private readonly uri: string,
    /** Where a legacy `profiles.json` may be waiting to be imported. */
    private readonly legacyDir: string,
  ) {}

  async open(): Promise<void> {
    try {
      this.client = new MongoClient(this.uri, {
        serverSelectionTimeoutMS: OP_TIMEOUT_MS,
        connectTimeoutMS: OP_TIMEOUT_MS,
        socketTimeoutMS: OP_TIMEOUT_MS * 2,
        // Writes are retried by this class with its own backoff; the driver's
        // single automatic retry is kept as well, for a one-off blip.
        retryWrites: true,
      });
      this.db = this.client.db();
      // `connect` fails fast if the database is down at boot - and that is
      // survivable: the driver reconnects on its own on the next operation,
      // so a pod that booted during an outage recovers without a restart.
      await this.client.connect();
      logger.info(SCOPE, `connected to database "${this.db.databaseName}"`);
      await this.prepare();
    } catch (error) {
      logger.error(
        SCOPE,
        '!!! MONGODB IS UNREACHABLE AT BOOT. The server stays up and /health keeps ' +
          'answering, but every join will be REFUSED until the database is back. ' +
          'Indexes and the legacy import will be retried.',
        error,
      );
      this.retryPrepare(RETRY_MIN_MS);
    }
  }

  /** Indexes and the legacy import - idempotent, so safe on every boot. */
  private async prepare(): Promise<void> {
    await this.grants().createIndex({ accountId: 1, status: 1 });
    await this.importLegacy();
  }

  private retryPrepare(delay: number): void {
    if (this.closed) return;
    const timer = setTimeout(() => {
      this.prepare().then(
        () => logger.info(SCOPE, 'database reachable again; indexes and legacy import done'),
        () => this.retryPrepare(Math.min(delay * 2, RETRY_MAX_MS)),
      );
    }, delay);
    timer.unref();
  }

  /**
   * Copy an existing `profiles.json` into the database - INSERT ONLY.
   *
   * `$setOnInsert` on an upsert: a profile the database already has is not
   * touched, however much older the file's copy is or however much newer. The
   * database is the source of truth once it exists, and the file is only ever
   * a seed. Running this on every boot is therefore harmless.
   */
  private async importLegacy(): Promise<void> {
    const file = joinPath(this.legacyDir, 'profiles.json');
    if (!existsSync(file)) return;

    let entries: [string, StoredProfile][];
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, StoredProfile>;
      entries = Object.entries(raw).filter(([, value]) => value && typeof value === 'object');
    } catch (error) {
      logger.error(SCOPE, `legacy ${file} could not be parsed; nothing imported`, error);
      return;
    }
    if (entries.length === 0) return;

    const result = await this.profiles().bulkWrite(
      entries.map(([key, profile]) => ({
        updateOne: {
          filter: { _id: key },
          update: { $setOnInsert: stripId(profile) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    logger.info(
      SCOPE,
      `legacy import from ${file}: ${result.upsertedCount} added, ` +
        `${entries.length - result.upsertedCount} already present (left untouched)`,
    );
  }

  // ------------------------------------------------------------- profiles

  async get(key: string): Promise<StoredProfile | null> {
    let stored: StoredProfile | null;
    try {
      const doc = await this.profiles().findOne({ _id: key }, { maxTimeMS: OP_TIMEOUT_MS });
      stored = doc ? stripId(doc) : null;
    } catch (error) {
      throw new StorageUnavailableError(`read ${key}`, error);
    }
    /*
     * A snapshot this pod has queued but not yet written is NEWER than the
     * stored copy, so its session fields win - but laid OVER the stored
     * document, never returned on its own. A session snapshot carries no
     * migration marker and no field from a newer build; returned by itself it
     * would resurrect a migrated guest copy and forget whatever it lacked.
     *
     * The stored copy is read first, and a failed read throws, even when a
     * pending snapshot exists: "the database is down" means the join is
     * refused, the same way every time.
     */
    const pending = this.queued.get(key);
    if (!pending) return stored;
    return { ...(stored ?? {}), ...sessionFields(pending) } as StoredProfile;
  }

  put(key: string, profile: StoredProfile): void {
    this.enqueue(key, profile);
    this.schedule(key, 0);
  }

  async write(key: string, profile: StoredProfile): Promise<void> {
    // Queued FIRST, so a failure below still leaves it to land later.
    this.enqueue(key, profile);
    await this.drainKey(key, true);
  }

  /**
   * Replace a key's queued snapshot with a newer one - but CARRY OVER any
   * migration marker the older one had not yet written. A marker lives only
   * in the write that sets it, so a later ordinary save replacing it in the
   * queue would otherwise make it vanish before it ever reached the database.
   */
  private enqueue(key: string, profile: StoredProfile): void {
    const previous = this.queued.get(key);
    const next: StoredProfile = { ...profile };
    if (previous?.migratedTo !== undefined && next.migratedTo === undefined) {
      next.migratedTo = previous.migratedTo;
    }
    if (previous?.migratedFrom !== undefined && next.migratedFrom === undefined) {
      next.migratedFrom = previous.migratedFrom;
    }
    this.queued.set(key, next);
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    try {
      const result = await this.profiles().updateOne(
        { _id: key },
        { $setOnInsert: stripId(profile) },
        { upsert: true },
      );
      return result.upsertedCount === 1;
    } catch (error) {
      // Two upserts racing on one new key: one inserts, the other gets a
      // duplicate-key error. That is "somebody else created it", not an outage.
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw new StorageUnavailableError(`insert ${key}`, error);
    }
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    try {
      const all = new Map<string, StoredProfile>();
      for await (const doc of this.profiles().find({}, { maxTimeMS: OP_TIMEOUT_MS * 4 })) {
        all.set(doc._id, stripId(doc));
      }
      // This pod's unwritten snapshots are newer than what it just read - laid
      // over the stored document for the same reason `get` does it.
      for (const [key, profile] of this.queued) {
        all.set(key, { ...(all.get(key) ?? {}), ...sessionFields(profile) } as StoredProfile);
      }
      return all;
    } catch (error) {
      throw new StorageUnavailableError('load all', error);
    }
  }

  async flush(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.queued.size > 0 && Date.now() < deadline) {
      await Promise.allSettled([...this.queued.keys()].map((key) => this.drainKey(key, false)));
      if (this.queued.size > 0) await sleep(250);
    }
    if (this.queued.size > 0) {
      logger.error(
        SCOPE,
        `!!! ${this.queued.size} profile write(s) did not land before shutdown: ` +
          [...this.queued.keys()].join(', '),
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.client?.close().catch(() => undefined);
  }

  /** Write one key's queued snapshot after `delay`. One timer per key. */
  private schedule(key: string, delay: number): void {
    if (this.closed || this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.drainKey(key, false);
    }, delay);
    this.timers.set(key, timer);
  }

  /**
   * Write whatever is queued for a key, newest snapshot wins.
   *
   * @param rethrow for `write()`, which must report failure to its caller. A
   *                queued `put` never throws: its failure schedules a retry.
   */
  private async drainKey(key: string, rethrow: boolean): Promise<void> {
    // Another write for this key is in flight. It will pick up the newest
    // snapshot when it finishes; a caller that must know waits for it.
    if (this.writing.has(key)) {
      if (!rethrow) return;
      while (this.writing.has(key)) await sleep(20);
      if (!this.queued.has(key)) return;
    }
    this.writing.add(key);
    try {
      while (this.queued.has(key)) {
        const snapshot = this.queued.get(key) as StoredProfile;
        await this.profiles().updateOne(
          { _id: key },
          { $set: sessionFields(snapshot) },
          { upsert: true },
        );
        // Only clear it if nothing newer arrived while this one was in flight.
        if (this.queued.get(key) === snapshot) this.queued.delete(key);
      }
      this.backoff.delete(key);
    } catch (error) {
      const delay = Math.min((this.backoff.get(key) ?? RETRY_MIN_MS / 2) * 2, RETRY_MAX_MS);
      this.backoff.set(key, delay);
      logger.warn(SCOPE, `write ${key} failed; retrying in ${delay}ms (kept, not dropped)`);
      this.writing.delete(key);
      this.schedule(key, delay);
      if (rethrow) throw new StorageUnavailableError(`write ${key}`, error);
      return;
    }
    this.writing.delete(key);
  }

  // --------------------------------------------------------------- grants

  async recordGrant(grant: GrantRecord): Promise<'recorded' | 'duplicate'> {
    try {
      await this.grants().insertOne({
        _id: grant.transactionId,
        accountId: grant.accountId,
        sku: grant.sku,
        wins: grant.wins,
        status: 'pending',
        createdAt: Date.now(),
      });
      return 'recorded';
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return 'duplicate';
      throw new StorageUnavailableError(`record grant ${grant.transactionId}`, error);
    }
  }

  async claimGrants(accountId: string, claimant: string): Promise<GrantRecord[]> {
    const claimed: GrantRecord[] = [];
    try {
      // One document at a time, each claim atomic: two pods draining the same
      // account can interleave, but no document is handed to both.
      for (;;) {
        const now = Date.now();
        const doc = await this.grants().findOneAndUpdate(
          {
            accountId,
            $or: [
              { status: 'pending' },
              { status: 'claimed', claimedAt: { $lt: now - GRANT_CLAIM_TIMEOUT_MS } },
            ],
          },
          { $set: { status: 'claimed', claimedBy: claimant, claimedAt: now } },
          { returnDocument: 'after', maxTimeMS: OP_TIMEOUT_MS },
        );
        if (!doc) break;
        claimed.push({
          transactionId: doc._id,
          accountId: doc.accountId,
          sku: doc.sku,
          wins: doc.wins,
        });
      }
    } catch (error) {
      // Anything claimed so far is returned and applied; the rest stays
      // pending (or times out back to claimable) for the next attempt.
      logger.warn(SCOPE, `claiming grants for an account stopped early`, error);
    }
    return claimed;
  }

  async markApplied(transactionId: string, profileKey: string): Promise<void> {
    try {
      await this.grants().updateOne(
        { _id: transactionId },
        { $set: { status: 'applied', appliedAt: Date.now(), appliedTo: profileKey } },
      );
    } catch (error) {
      // The profile already records it in `appliedGrants`, so a later reclaim
      // closes it without paying again. Logged, not fatal.
      logger.warn(SCOPE, `could not mark grant ${transactionId} applied; it will be closed later`, error);
    }
  }

  async hasPendingGrants(accountId: string): Promise<boolean> {
    try {
      const now = Date.now();
      const doc = await this.grants().findOne(
        {
          accountId,
          $or: [
            { status: 'pending' },
            { status: 'claimed', claimedAt: { $lt: now - GRANT_CLAIM_TIMEOUT_MS } },
          ],
        },
        { projection: { _id: 1 }, maxTimeMS: OP_TIMEOUT_MS },
      );
      return doc !== null;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------- helpers

  private profiles(): Collection<ProfileDoc> {
    if (!this.db) throw new StorageUnavailableError('not connected');
    return this.db.collection<ProfileDoc>('profiles');
  }

  private grants(): Collection<GrantDoc> {
    if (!this.db) throw new StorageUnavailableError('not connected');
    return this.db.collection<GrantDoc>('bux_grants');
  }
}

/**
 * The `$set` of a write: the fields a live session owns, plus a migration
 * marker ONLY when the write explicitly carries one (the migration itself).
 *
 * A live session's snapshot is built from its player state and never carries
 * a marker, so an ordinary save can neither set nor clear one - which is what
 * keeps `migratedTo` on a guest's recovery copy for good.
 */
const sessionFields = (profile: StoredProfile): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of SESSION_FIELDS) {
    if (profile[field] !== undefined) out[field] = profile[field];
  }
  if (profile.migratedTo !== undefined) out['migratedTo'] = profile.migratedTo;
  if (profile.migratedFrom !== undefined) out['migratedFrom'] = profile.migratedFrom;
  return out;
};

const stripId = <T extends Record<string, unknown>>(doc: T): StoredProfile => {
  const { _id: _ignored, ...rest } = doc as T & { _id?: unknown };
  return rest as unknown as StoredProfile;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
