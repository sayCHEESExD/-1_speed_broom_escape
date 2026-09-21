import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'identity';

/**
 * Longest token this server will send anywhere.
 *
 * A Bloxity JWT is a few hundred characters. The cap exists so a client cannot
 * make this server forward a megabyte of garbage to a third party on its behalf.
 */
const MAX_TOKEN_LENGTH = 4096;

/** How long a verification may take before the player is admitted as a guest. */
const VERIFY_TIMEOUT_MS = 5000;

/**
 * How long a token that verified stays trusted without asking again.
 *
 * Short on purpose. A player who joins, leaves and rejoins inside it costs one
 * call rather than three, and a token that Bloxity revokes stops working here
 * within minutes rather than for the life of the process.
 */
const CACHE_MS = 5 * 60 * 1000;

/** Most tokens remembered at once, so the cache cannot grow without bound. */
const CACHE_LIMIT = 2000;

/**
 * A plausible account id: short, and nothing but identifier characters.
 *
 * Deliberately NOT pinned to a 24-character ObjectId. Bloxity documents that
 * shape for ITEM ids, not for users, and a pattern stricter than the real ids
 * would quietly turn every signed-in player into a guest. What this has to
 * stop is an id that is not an id at all - it becomes a Map key and a log line.
 */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The shape of the one call this module makes. Swappable for tests. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Turns a player's Bloxity TOKEN into their Bloxity ACCOUNT ID - or refuses to.
 *
 * WHY THIS EXISTS. Bux purchases are fulfilled by a webhook addressed to an
 * account id, and the room hands a queued purchase to whichever session it
 * believes owns that account. It used to believe whatever id a client put in
 * its join options. An account id is not a secret - `getFriends()` returns
 * them - so any player could join claiming a friend's id and walk off with the
 * Wins that friend had just paid for.
 *
 * So the client now sends its JWT, and this asks Bloxity whose it is, with the
 * same request the SDK itself uses to check its own token:
 * `POST /v1/auth/game-token/verify` with the game slug, because Bloxity issues
 * game-scoped tokens and checks them against the game they were issued for.
 * The id this returns is the ONLY one the room ever binds.
 *
 * Three properties, all deliberate:
 *
 *  - It NEVER THROWS and never blocks for long. A Bloxity outage must not lock
 *    anyone out of a game they can play perfectly well signed out, so every
 *    failure - timeout, 5xx, bad JSON, no network - resolves to `null`, which
 *    the room reads as "play as a guest".
 *  - It FAILS CLOSED. Anything it cannot positively verify is `null`. There is
 *    no fallback that trusts the client's word, because that fallback would be
 *    exactly the hole this closes.
 *  - It is cached by token, briefly, so a reconnecting player is not a second
 *    round trip.
 */
export class BloxityIdentity {
  private readonly cache = new Map<string, { id: string; until: number }>();

  /** Verifications in flight, so two joins with one token make one request. */
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly apiBase: string = serverConfig.bloxityApiBase,
    private readonly gameSlug: string = serverConfig.bloxityGameSlug,
    private readonly timeoutMs: number = VERIFY_TIMEOUT_MS,
  ) {}

  /**
   * The Bloxity account id this token belongs to, or null.
   *
   * Null means "treat this player as signed out" - it is never an error the
   * caller has to handle.
   */
  async verify(token: unknown): Promise<string | null> {
    if (typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return null;

    const now = Date.now();
    const hit = this.cache.get(trimmed);
    if (hit && hit.until > now) return hit.id;
    if (hit) this.cache.delete(trimmed);

    const pending = this.inflight.get(trimmed);
    if (pending) return pending;

    const request = this.ask(trimmed).finally(() => this.inflight.delete(trimmed));
    this.inflight.set(trimmed, request);
    return request;
  }

  private async ask(token: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(`${this.apiBase}/v1/auth/game-token/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameSlug: this.gameSlug }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 401 is the ordinary case - an expired or forged token - and is
        // logged quietly. Anything else is Bloxity having a bad day.
        if (response.status === 401) {
          logger.info(SCOPE, 'a Bloxity token was rejected; admitting as a guest');
        } else {
          logger.warn(SCOPE, `Bloxity verify answered HTTP ${response.status}`);
        }
        return null;
      }

      // Parsed exactly as the SDK parses the same response: the user may be
      // wrapped in `{ user }` or be the body itself.
      const body = (await response.json()) as Record<string, unknown> | null;
      const user =
        body && typeof body === 'object' && body['user'] && typeof body['user'] === 'object'
          ? (body['user'] as Record<string, unknown>)
          : body;
      const id = user?.['_id'];

      if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
        logger.warn(SCOPE, 'Bloxity verify answered 2xx without a usable account id');
        return null;
      }

      this.remember(token, id);
      return id;
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : String(error);
      logger.warn(SCOPE, `could not verify a Bloxity token: ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(token: string, id: string): void {
    if (this.cache.size >= CACHE_LIMIT) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, { id, until: Date.now() + CACHE_MS });
  }
}

/** Process-wide, so every room shares one cache and one set of requests. */
export const bloxityIdentity = new BloxityIdentity();
