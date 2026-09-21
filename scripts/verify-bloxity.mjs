/**
 * The Bloxity integration's server-side authority, checked offline.
 *
 * Three things a Bux purchase depends on, and each one is a place real money
 * can go wrong:
 *
 *   - IDENTITY. The room binds a Bloxity account only from a token Bloxity
 *     itself verified. Exercised against a stubbed Bloxity so every answer it
 *     can give - valid, rejected, broken, slow, absent - is covered without
 *     touching the real API.
 *   - FULFILMENT. The webhook answers 2xx only for what this build can
 *     actually deliver, so an unknown SKU is REFUNDED rather than kept.
 *     Exercised over real HTTP against the real handler.
 *   - THE SHOP. Every SKU the in-game shop sells must be one the server can
 *     grant. The shop once sold one it could not.
 *
 * `npm run verify:identity` covers the same identity rule against a RUNNING
 * server and the real Bloxity API.
 *
 * Run with `npm run verify:bloxity` (builds the server first).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Configure the webhook secret BEFORE the server config module is loaded,
// because it reads the environment once, at import.
const SECRET = 'verify-bloxity-secret';
process.env.BLOXITY_WEBHOOK_SECRET = SECRET;

const { BloxityIdentity } = await import('../server/dist/bloxity/BloxityIdentity.js');
const { SKU_WINS, buxGrants } = await import('../server/dist/progression/BuxGrants.js');
const { createHttpServer, BUX_WEBHOOK_PATH } = await import('../server/dist/httpServer.js');

let failures = 0;
const check = (label, actual, expected) => {
  if (Object.is(actual, expected)) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
};

/** A stub Bloxity that answers with whatever `respond` says, and counts calls. */
const stub = (respond) => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetcher, calls };
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ---------------------------------------------------------------- identity
console.log('identity');
{
  const { fetcher, calls } = stub(() => json(200, { user: { _id: 'acct_victim_01' } }));
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'speed-broom-escape', 200);

  check('a verified token yields its account id', await identity.verify('good-token'), 'acct_victim_01');

  const call = calls[0];
  check('  asked the game-token verify endpoint', call?.url, 'https://bloxity.test/v1/auth/game-token/verify');
  check('  as a POST', call?.init?.method, 'POST');
  check('  with the token as a bearer', call?.init?.headers?.Authorization, 'Bearer good-token');
  check(
    '  scoped to this game slug',
    JSON.parse(call?.init?.body ?? '{}').gameSlug,
    'speed-broom-escape',
  );

  // Cached: the same token again costs nothing.
  await identity.verify('good-token');
  check('a second check of the same token is served from cache', calls.length, 1);
}
{
  // Two joins racing with one token make ONE request between them.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { fetcher, calls } = stub(async () => {
    await gate;
    return json(200, { _id: 'acct_racer' });
  });
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'slug', 500);
  const both = Promise.all([identity.verify('same'), identity.verify('same')]);
  release();
  const [a, b] = await both;
  check('concurrent checks of one token share one request', calls.length, 1);
  check('  and both get the id', a === 'acct_racer' && b === 'acct_racer', true);
}
{
  // The body may be the user itself rather than `{ user }` - the SDK accepts
  // both, so the server must too.
  const { fetcher } = stub(() => json(200, { _id: 'acct_bare', username: 'bare' }));
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'slug', 200);
  check('an unwrapped user body is understood', await identity.verify('t'), 'acct_bare');
}

/*
 * THE REJECTION PATHS, which are the whole point. Every one of these must be a
 * guest - null - and none of them may throw into the room.
 */
const refusals = [
  ['a rejected token (401)', () => json(401, { error: 'Unauthorized: Invalid token' })],
  ['a Bloxity outage (503)', () => json(503, { error: 'down' })],
  ['a 2xx with no account id', () => json(200, { user: { username: 'nobody' } })],
  ['a 2xx with a hostile "id"', () => json(200, { user: { _id: '../../etc/passwd' } })],
  ['a 2xx that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
  ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
];
for (const [label, respond] of refusals) {
  const { fetcher } = stub(respond);
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'slug', 200);
  let result;
  let threw = false;
  try {
    result = await identity.verify('some-token');
  } catch {
    threw = true;
  }
  check(`${label} admits a guest`, threw ? 'threw' : result, null);
}
{
  // Slow Bloxity: the join must not hang on it. Honours the abort signal, as
  // a real fetch does.
  const { fetcher } = stub(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'slug', 150);
  const started = Date.now();
  const result = await identity.verify('slow-token');
  check('a Bloxity that never answers times out to a guest', result, null);
  check('  within the timeout', Date.now() - started < 1500, true);
}
{
  // Nothing that is not a plausible token is ever sent anywhere.
  const { fetcher, calls } = stub(() => json(200, { _id: 'acct' }));
  const identity = new BloxityIdentity(fetcher, 'https://bloxity.test', 'slug', 200);
  for (const bad of [undefined, null, 42, {}, '', '   ', 'x'.repeat(5000)]) {
    await identity.verify(bad);
  }
  check('non-tokens and oversize tokens never reach Bloxity', calls.length, 0);
}

// -------------------------------------------------------------- fulfilment
console.log('fulfilment');
{
  // The grant table, directly.
  const known = Object.keys(SKU_WINS)[0];
  check('a known SKU is queued', buxGrants.record('acct_a', 'txn-a1', known), 'queued');
  check('its redelivery is a duplicate', buxGrants.record('acct_a', 'txn-a1', known), 'duplicate');
  check('an unknown SKU is refused', buxGrants.record('acct_a', 'txn-a2', 'speed_boost_1h'), 'unknown-sku');
  // Refused BEFORE being marked seen: a retry after a deploy that added the
  // SKU must be honoured, not dismissed as a duplicate.
  check('  and is not remembered as fulfilled', buxGrants.record('acct_a', 'txn-a2', 'speed_boost_1h'), 'unknown-sku');
  check('a grant with no account is malformed', buxGrants.record('', 'txn-a3', known), 'malformed');
  const drained = buxGrants.drain('acct_a');
  check('exactly the one real purchase is waiting', drained.length, 1);
  check('  worth its table value', drained[0]?.wins, SKU_WINS[known]);
}
{
  // The same rules, over real HTTP, through the real handler.
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const post = async (payload, secret = SECRET) =>
    (
      await fetch(`http://127.0.0.1:${port}${BUX_WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-legion-webhook-secret': secret } : {}),
        },
        body: JSON.stringify(payload),
      })
    ).status;

  const known = Object.keys(SKU_WINS)[0];
  const base = { userId: 'acct_http', username: 'http', gameSlug: 'speed-broom-escape' };

  check('webhook: a known SKU answers 200', await post({ ...base, transactionId: 'h1', sku: known }), 200);
  check('webhook: its retry answers 200, never a refund', await post({ ...base, transactionId: 'h1', sku: known }), 200);
  check(
    'webhook: an unknown SKU answers 422 so it is REFUNDED',
    await post({ ...base, transactionId: 'h2', sku: 'speed_boost_1h' }),
    422,
  );
  check('webhook: a bad secret answers 401', await post({ ...base, transactionId: 'h3', sku: known }, 'wrong'), 401);
  check('webhook: no secret at all answers 401', await post({ ...base, transactionId: 'h4', sku: known }, ''), 401);
  check('webhook: a malformed body answers 400', await post({ ...base, sku: known }), 400);

  const queued = buxGrants.drain('acct_http');
  check('webhook: only the one paid, known purchase was queued', queued.length, 1);

  await new Promise((resolve) => server.close(resolve));
}

// --------------------------------------------------------------------- shop
console.log('shop');
{
  const panel = readFileSync(
    fileURLToPath(new URL('../client/src/ui/BloxityPanel.ts', import.meta.url)),
    'utf8',
  );
  const table = panel.match(/BUX_PRODUCTS[^=]*=\s*\[([\s\S]*?)\n\];/);
  const skus = table ? [...table[1].matchAll(/sku:\s*'([^']+)'/g)].map((m) => m[1]) : [];

  check('the shop lists something', skus.length > 0, true);
  const unfulfillable = skus.filter((sku) => !(SKU_WINS[sku] > 0));
  check(
    `every SKU the shop sells can be fulfilled (${skus.join(', ')})`,
    unfulfillable.length === 0 ? 'all fulfillable' : unfulfillable.join(', '),
    'all fulfillable',
  );
  // And no price anywhere in the shop's table: prices are the catalogue's.
  check('the shop table carries no prices', /price\s*:/i.test(table?.[1] ?? ''), false);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('bloxity OK');
