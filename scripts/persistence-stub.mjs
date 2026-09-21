/**
 * A stand-in for ONE Bloxity endpoint, preloaded into the test server with
 * `node --import ./scripts/persistence-stub.mjs server/dist/index.js`.
 *
 * TEST-ONLY, and it touches nothing in the server's code: it replaces
 * `globalThis.fetch` for exactly one URL - Bloxity's token verify - which is
 * what the server's verifier looks up at call time. Every other request goes
 * to the real network untouched. There is no test switch in production code.
 *
 * Tokens it understands (anything else is a forgery):
 *   ok.<accountId>   -> 200 { user: { _id: accountId } }   (as Bloxity answers)
 *   anything else    -> 401 GAME_TOKEN_INVALID
 * A request with the wrong gameSlug is refused (401), as the real one does.
 *
 * `STUB_CONTROL` names a JSON file the test rewrites at runtime:
 *   { "unavailable": true }  -> every verify answers 503, as during an outage
 */
import { readFileSync } from 'node:fs';

const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';
const EXPECTED_SLUG = process.env.STUB_EXPECTED_SLUG ?? 'speed-broom-escape';
const CONTROL = process.env.STUB_CONTROL ?? '';

const control = () => {
  if (!CONTROL) return {};
  try {
    return JSON.parse(readFileSync(CONTROL, 'utf8'));
  } catch {
    return {};
  }
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url !== VERIFY_URL) return realFetch(input, init);

  if (control().unavailable) return json(503, { error: 'stubbed outage' });

  const auth = new Headers(init.headers).get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { code: 'GAME_TOKEN_REQUIRED', error: 'A game capability is required' });

  let slug = '';
  try {
    slug = JSON.parse(String(init.body ?? '{}')).gameSlug ?? '';
  } catch {
    /* no body */
  }
  if (slug !== EXPECTED_SLUG) {
    return json(401, { code: 'GAME_TOKEN_INVALID', error: `wrong gameSlug "${slug}"` });
  }

  const match = /^ok\.([A-Za-z0-9_-]{1,64})$/.exec(token);
  if (!match) return json(401, { code: 'GAME_TOKEN_INVALID', error: 'The game capability is invalid or expired' });
  return json(200, { user: { _id: match[1], username: `user_${match[1]}` } });
};
