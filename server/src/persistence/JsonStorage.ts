import { existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { logger } from '../util/logger.js';
import {
  GRANT_CLAIM_TIMEOUT_MS,
  SESSION_FIELDS,
  type GrantRecord,
  type Storage,
  type StoredProfile,
} from './Storage.js';

const SCOPE = 'json-store';

/** Coalesce a burst of saves into one file write. */
const DEBOUNCE_MS = 400;

interface GrantEntry extends GrantRecord {
  status: 'pending' | 'claimed' | 'applied';
  createdAt: number;
  claimedBy?: string;
  claimedAt?: number;
  appliedTo?: string;
}

/**
 * Profiles and purchases in two JSON files - the DEVELOPMENT store, used when
 * there is no `MONGODB_URI`.
 *
 * One process owns these files, so the per-key contract is kept by merging
 * into an in-memory map and writing the file whole; what matters is that a
 * write MERGES the session's fields into the stored document instead of
 * replacing it, so fields this build does not know about survive.
 *
 * Every write is temp file -> fsync -> rename, so a reader only ever sees a
 * complete file. At boot, a leftover temp file that parses is the newest
 * complete write (the process died between fsync and rename) and is adopted;
 * one that does not parse was interrupted mid-write and is set aside. A main
 * file that does not parse is MOVED ASIDE with its bytes intact, never
 * overwritten - the old store booted empty and let the next save replace it,
 * which turned one bad byte into everyone's progress gone.
 */
export class JsonStorage implements Storage {
  readonly kind = 'json' as const;

  private readonly profiles = new Map<string, StoredProfile>();
  private readonly grants = new Map<string, GrantEntry>();
  private readonly profileFile: AtomicJsonFile;
  private readonly grantFile: AtomicJsonFile;

  constructor(directory: string) {
    this.profileFile = new AtomicJsonFile(directory, 'profiles.json');
    this.grantFile = new AtomicJsonFile(directory, 'grants.json');
  }

  async open(): Promise<void> {
    const profiles = this.profileFile.load();
    for (const [key, value] of Object.entries(profiles)) {
      if (value && typeof value === 'object') {
        // EVERY field kept, not just the ones this build knows; the known
        // numeric ones are merely made safe.
        this.profiles.set(key, normalise(value as StoredProfile));
      }
    }
    const grants = this.grantFile.load();
    for (const [id, value] of Object.entries(grants)) {
      if (value && typeof value === 'object') this.grants.set(id, value as GrantEntry);
    }
    logger.info(
      SCOPE,
      `loaded ${this.profiles.size} profile(s) and ${this.grants.size} grant(s) from ${this.profileFile.directory}`,
    );
  }

  async get(key: string): Promise<StoredProfile | null> {
    const found = this.profiles.get(key);
    return found ? { ...found } : null;
  }

  put(key: string, profile: StoredProfile): void {
    this.merge(key, profile);
    this.profileFile.scheduleWrite(() => Object.fromEntries(this.profiles));
  }

  async write(key: string, profile: StoredProfile): Promise<void> {
    this.merge(key, profile);
    await this.profileFile.writeNow(() => Object.fromEntries(this.profiles));
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    if (this.profiles.has(key)) return false;
    this.profiles.set(key, { ...profile });
    await this.profileFile.writeNow(() => Object.fromEntries(this.profiles));
    return true;
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    return new Map([...this.profiles].map(([key, value]) => [key, { ...value }]));
  }

  async flush(): Promise<void> {
    await this.profileFile.flush(() => Object.fromEntries(this.profiles));
    await this.grantFile.flush(() => Object.fromEntries(this.grants));
  }

  async close(): Promise<void> {
    await this.flush();
  }

  /** Set the session's fields over whatever is stored; keep everything else. */
  private merge(key: string, profile: StoredProfile): void {
    const next: StoredProfile = { ...(this.profiles.get(key) ?? profile) };
    for (const field of SESSION_FIELDS) {
      if (profile[field] !== undefined) (next as Record<string, unknown>)[field] = profile[field];
    }
    // A write that names a migration marker (the migration itself) sets it.
    if (profile.migratedTo !== undefined) next.migratedTo = profile.migratedTo;
    if (profile.migratedFrom !== undefined) next.migratedFrom = profile.migratedFrom;
    this.profiles.set(key, next);
  }

  // --------------------------------------------------------------- grants

  async recordGrant(grant: GrantRecord): Promise<'recorded' | 'duplicate'> {
    if (this.grants.has(grant.transactionId)) return 'duplicate';
    this.grants.set(grant.transactionId, { ...grant, status: 'pending', createdAt: Date.now() });
    // Durable before the webhook answers 2xx - that answer is what tells
    // Bloxity to keep the Bux.
    await this.grantFile.writeNow(() => Object.fromEntries(this.grants));
    return 'recorded';
  }

  async claimGrants(accountId: string, claimant: string): Promise<GrantRecord[]> {
    const now = Date.now();
    const claimed: GrantRecord[] = [];
    for (const entry of this.grants.values()) {
      if (entry.accountId !== accountId) continue;
      const abandoned =
        entry.status === 'claimed' && (entry.claimedAt ?? 0) < now - GRANT_CLAIM_TIMEOUT_MS;
      if (entry.status !== 'pending' && !abandoned) continue;
      entry.status = 'claimed';
      entry.claimedBy = claimant;
      entry.claimedAt = now;
      claimed.push({
        transactionId: entry.transactionId,
        accountId: entry.accountId,
        sku: entry.sku,
        wins: entry.wins,
      });
    }
    if (claimed.length > 0) this.grantFile.scheduleWrite(() => Object.fromEntries(this.grants));
    return claimed;
  }

  async markApplied(transactionId: string, profileKey: string): Promise<void> {
    const entry = this.grants.get(transactionId);
    if (!entry) return;
    entry.status = 'applied';
    entry.appliedTo = profileKey;
    this.grantFile.scheduleWrite(() => Object.fromEntries(this.grants));
  }

  async hasPendingGrants(accountId: string): Promise<boolean> {
    const now = Date.now();
    for (const entry of this.grants.values()) {
      if (entry.accountId !== accountId) continue;
      if (entry.status === 'pending') return true;
      if (entry.status === 'claimed' && (entry.claimedAt ?? 0) < now - GRANT_CLAIM_TIMEOUT_MS) {
        return true;
      }
    }
    return false;
  }
}

/** Known numeric fields made safe; every other field passed through untouched. */
const normalise = (value: StoredProfile): StoredProfile => {
  const out: StoredProfile = { ...value };
  for (const field of [
    'totalSpeed',
    'wins',
    'ownedBrooms',
    'rebirths',
    'ownedTrails',
    'trailSlot',
    'bestStage',
    'updatedAt',
  ] as const) {
    const n = value[field];
    out[field] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return out;
};

/**
 * One JSON file, written atomically, never overwritten when it is unreadable.
 */
class AtomicJsonFile {
  readonly path: string;
  private readonly tempPath: string;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private dirty = false;

  constructor(readonly directory: string, name: string) {
    this.path = joinPath(directory, name);
    this.tempPath = `${this.path}.tmp`;
  }

  /** Read at boot, recovering a leftover temp file and quarantining garbage. */
  load(): Record<string, unknown> {
    // A temp file that parses is a COMPLETE write that never got renamed -
    // the newest data there is. One that does not is a torn write.
    if (existsSync(this.tempPath)) {
      const fromTemp = tryParse(this.tempPath);
      if (fromTemp) {
        logger.warn(SCOPE, `recovering ${this.tempPath} (a complete write that was never renamed)`);
        renameSync(this.tempPath, this.path);
        return fromTemp;
      }
      this.quarantine(this.tempPath, 'a torn write');
    }
    if (!existsSync(this.path)) return {};
    const parsed = tryParse(this.path);
    if (parsed) return parsed;
    this.quarantine(this.path, 'unparseable');
    return {};
  }

  /** Move a bad file aside, bytes intact, and say so loudly. */
  private quarantine(file: string, why: string): void {
    const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      renameSync(file, aside);
      logger.error(
        SCOPE,
        `!!! ${file} is ${why}. It has been MOVED to ${aside} with its data intact ` +
          '(recover by hand). Starting from an empty store.',
      );
    } catch (error) {
      logger.error(SCOPE, `!!! ${file} is ${why} and could not be moved aside`, error);
      try {
        // If it cannot be moved it must at least never be overwritten silently.
        if (file === this.tempPath) unlinkSync(file);
      } catch {
        /* nothing more to do */
      }
    }
  }

  scheduleWrite(snapshot: () => Record<string, unknown>): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow(snapshot).catch(() => undefined);
    }, DEBOUNCE_MS);
    this.timer.unref();
  }

  /** Write now (after any write already in flight) and wait for it. */
  async writeNow(snapshot: () => Record<string, unknown>): Promise<void> {
    this.dirty = true;
    while (this.inflight) await this.inflight.catch(() => undefined);
    if (!this.dirty) return;
    this.dirty = false;
    this.inflight = this.writeOnce(JSON.stringify(snapshot()));
    try {
      await this.inflight;
    } catch (error) {
      this.dirty = true;
      logger.error(SCOPE, `failed to write ${this.path}; will retry`, error);
      this.scheduleWrite(snapshot);
      throw error;
    } finally {
      this.inflight = null;
    }
  }

  async flush(snapshot: () => Record<string, unknown>): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty || this.inflight) await this.writeNow(snapshot).catch(() => undefined);
  }

  private async writeOnce(payload: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const handle = await open(this.tempPath, 'w');
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(this.tempPath, this.path);
  }
}

const tryParse = (file: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};
