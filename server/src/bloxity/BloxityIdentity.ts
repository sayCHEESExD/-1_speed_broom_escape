import { createHash } from 'node:crypto';
import { serverConfig } from '../config/serverConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'identity';

/**
 * Where Bloxity verifies a game token. A CONSTANT, not configuration.
 *
 * Exactly the call the official SDK makes to check its own token
 * (sdk.bloxity.io/legion-sdk.js, `refreshUserFromApi`): POST, the token as a
 * bearer, `{ gameSlug }` as the body. It is the one outbound call that decides
 * whose progress a session gets, and an environment variable that could point
 * it somewhere else would be an environment variable that decides that.
 *
 * (A test replaces `fetch` itself, with a module preloaded into the test
 * server - see scripts/persistence-stub.mjs. Nothing here knows about it.)
 */
const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';

/** Longest token this server will send anywhere. A Bloxity JWT is a few hundred characters. */
const MAX_TOKEN_LENGTH = 4096;

/** How long a verification may take. Well inside the 15-second seat reservation. */
const VERIFY_TIMEOUT_MS = 5000;

/** Longest a VERIFIED answer is trusted without asking again (and never past the token's exp). */
const VERIFIED_TTL_MS = 5 * 60 * 1000;

/** How long a REJECTED token is remembered, so a replayed forgery is not a request each time. */
const REJECTED_TTL_MS = 30 * 1000;

const CACHE_LIMIT = 5000;

/**
 * A plausible account id: short, identifier characters only. Deliberately not
 * pinned to an ObjectId shape - Bloxity documents that for ITEM ids, not users,
 * and a stricter pattern than the real ids would quietly demote every player.
 */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What asking Bloxity produced. THREE outcomes, because two would be a lie:
 *
 *  - verified    - a 2xx carrying a valid string `_id`. The only one that binds.
 *  - rejected    - Bloxity said no (401, 403, any other 4xx). Play as a guest.
 *  - unavailable - Bloxity could not be asked (timeout, network, 5xx, 429, or a
 *                  2xx that does not look like an answer). Play as a guest FOR
 *                  NOW and ask again on a backoff. Never a permanent demotion:
 *                  an outage must not quietly turn signed-in players into
 *                  guests for the rest of their session.
 */
export type IdentityResult =
  | { readonly status: 'verified'; readonly accountId: string }
  | { readonly status: 'rejected' }
  | { readonly status: 'unavailable' };

const REJECTED: IdentityResult = { status: 'rejected' };
const UNAVAILABLE: IdentityResult = { status: 'unavailable' };

/**
 * Turns a player's Bloxity TOKEN into their ACCOUNT ID - or refuses to.
 *
 * The room never believes a client about who it is: it sends its token, this
 * asks Bloxity whose it is, and only the id Bloxity answers with is bound. It
 * FAILS CLOSED - nothing but a well-formed 2xx counts - and it never verifies a
 * token locally: the `JWT_SECRET` Legion injects is this GAME's secret, not
 * Bloxity's signing key, so a local check would prove nothing.
 */
export class BloxityIdentity {
  /** Keyed by a SHA-256 of the token, so no token is held as a map key. */
  private readonly cache = new Map<string, { result: IdentityResult; until: number }>();
  private readonly inflight = new Map<string, Promise<IdentityResult>>();

  constructor(private readonly gameSlug: string = serverConfig.bloxityGameSlug) {}

  async verify(token: unknown): Promise<IdentityResult> {
    if (typeof token !== 'string') return REJECTED;
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return REJECTED;

    const key = hashToken(trimmed);
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.result;
    if (hit) this.cache.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = this.ask(trimmed, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private async ask(token: string, key: string): Promise<IdentityResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    let response: Response;
    try {
      // `fetch` looked up at CALL time, not captured at import.
      response = await globalThis.fetch(VERIFY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameSlug: this.gameSlug }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const why =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${VERIFY_TIMEOUT_MS}ms`
          : String(error);
      logger.warn(SCOPE, `Bloxity could not be asked (${why}); guest for now, will retry`);
      return UNAVAILABLE;
    }

    try {
      if (response.status >= 500 || response.status === 429 || response.status === 408) {
        logger.warn(SCOPE, `Bloxity answered HTTP ${response.status}; guest for now, will retry`);
        return UNAVAILABLE;
      }
      if (!response.ok) {
        logger.info(SCOPE, `a token was rejected (HTTP ${response.status}); playing as a guest`);
        this.remember(key, REJECTED, Date.now() + REJECTED_TTL_MS);
        return REJECTED;
      }

      // Parsed exactly as the SDK parses the same reply: `{ user }` or the user.
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        logger.warn(SCOPE, 'Bloxity answered 2xx with a body that is not JSON; will retry');
        return UNAVAILABLE;
      }
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
      const user =
        record && record['user'] && typeof record['user'] === 'object'
          ? (record['user'] as Record<string, unknown>)
          : record;
      const id = user?.['_id'];
      if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
        // A 2xx that is not an answer is not a "no" either: never verified,
        // but not a verdict against the player. Asked again later.
        logger.warn(SCOPE, 'Bloxity answered 2xx without a usable account id; will retry');
        return UNAVAILABLE;
      }

      const result: IdentityResult = { status: 'verified', accountId: id };
      // Trusted for a few minutes, and never past the token's own expiry.
      const exp = tokenExpiry(token);
      const until = Math.min(Date.now() + VERIFIED_TTL_MS, exp ?? Number.POSITIVE_INFINITY);
      if (until > Date.now()) this.remember(key, result, until);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(key: string, result: IdentityResult, until: number): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, until });
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * The token's `exp`, in ms, or null.
 *
 * READ, not verified - it only ever SHORTENS how long a verified answer is
 * trusted, which is safe to take from an unverified token. The SDK reads it
 * the same way (`isTokenExpired`), and treats a token with no `exp` as valid.
 */
const tokenExpiry = (token: string): number | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
};

/** Process-wide, so every room shares one cache and one set of requests. */
export const bloxityIdentity = new BloxityIdentity();
