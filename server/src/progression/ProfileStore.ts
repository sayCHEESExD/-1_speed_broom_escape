import { storage, type StoredProfile } from '../persistence/index.js';
import { logger } from '../util/logger.js';

const SCOPE = 'leaderboard-cache';

/** How often the cache is refreshed from storage. A board a minute stale is fine. */
const REFRESH_MS = 60_000;

/**
 * A READ-ONLY, possibly-stale view of every stored profile - for the
 * leaderboard, and for nothing else.
 *
 * This used to be THE profile store: every profile read into memory at boot
 * and restored from here at join. With several pods sharing one database that
 * is wrong - another pod may have saved a player since this one booted - so a
 * join now reads its profile from storage directly (`Profiles.resolve*`), and
 * this cache only feeds the boards on the vault wall.
 *
 * Refreshed from storage on a slow timer. When two copies of a profile meet,
 * the newer `updatedAt` wins, so a refresh can never roll back a save this pod
 * has just made. A guest copy that was migrated into an account is left out:
 * its progress lives on under the account, and ranking both would put the same
 * player on the board twice.
 */
class ProfileStore {
  private readonly cache = new Map<string, StoredProfile>();
  private timer: NodeJS.Timeout | null = null;

  /** Start refreshing. Never throws; a failed refresh keeps the old view. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get size(): number {
    return this.cache.size;
  }

  async refresh(): Promise<void> {
    try {
      const all = await storage.loadAll();
      for (const [key, profile] of all) this.consider(key, profile);
    } catch (error) {
      logger.warn(SCOPE, `refresh failed; keeping the previous view (${String(error)})`);
    }
  }

  /** A save this pod just made, so the board reflects it before the next refresh. */
  noteSaved(key: string, profile: StoredProfile): void {
    this.consider(key, profile);
  }

  /** Every rankable profile: migrated guest copies excluded. */
  *entries(): IterableIterator<[string, StoredProfile]> {
    for (const entry of this.cache) {
      if (!entry[1].migratedTo) yield entry;
    }
  }

  private consider(key: string, profile: StoredProfile): void {
    const current = this.cache.get(key);
    if (current && (current.updatedAt ?? 0) > (profile.updatedAt ?? 0)) {
      // Keep the newer numbers, but take a migration marker the older copy
      // lacked - it only ever arrives from storage.
      if (profile.migratedTo && !current.migratedTo) current.migratedTo = profile.migratedTo;
      return;
    }
    this.cache.set(key, { ...(current ?? {}), ...profile });
  }
}

export const profileStore = new ProfileStore();
