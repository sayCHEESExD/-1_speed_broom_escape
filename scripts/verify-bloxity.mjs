/**
 * The Bloxity integration's server-side authority, checked offline.
 *
 * Three things a Bux purchase depends on, and each one is a place real money
 * can go wrong:
 *
 *   - IDENTITY. The room binds a Bloxity account only from a token Bloxity
 *     itself verified, with three outcomes - verified, rejected, unavailable.
 *     Exercised against a stubbed `fetch` so every answer Bloxity can give is
 *     covered without touching the real API, and without a test switch in
 *     the server.
 *   - FULFILMENT. The webhook answers 2xx only once a grant this build can
 *     deliver is DURABLY recorded; an unknown SKU is refunded; each grant is
 *     claimed exactly once. Over real HTTP, into a throwaway JSON store.
 *   - THE SHOP. Every SKU the in-game shop sells must be one the server can
 *     grant. The shop once sold one it could not.
 *
 * `npm run verify:identity` covers the same identity rule against a RUNNING
 * server and the real Bloxity API; `npm run verify:persistence` covers
 * accounts, migration and storage end to end.
 *
 * Run with `npm run verify:bloxity` (builds the server first).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

// Configure the environment BEFORE the server modules load: they read it once,
// at import. A throwaway JSON store, never the developer's real one.
const SECRET = 'verify-bloxity-secret';
const DATA_DIR = mkdtempSync(joinPath(tmpdir(), 'verify-bloxity-'));
process.env.BLOXITY_WEBHOOK_SECRET = SECRET;
process.env.BROOM_DATA_DIR = DATA_DIR;
delete process.env.MONGODB_URI;

const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';

/*
 * The ONE outbound call, stubbed at `globalThis.fetch` - which is exactly what
 * the verifier looks up at call time. There is no test switch in the server:
 * this replaces the network, not the code. Everything else passes through.
 */
const realFetch = globalThis.fetch;
let respond = null;
const calls = [];
globalThis.fetch = async (url, init) => {
  if (String(url) === VERIFY_URL) {
    calls.push({ url: String(url), init });
    return respond(init);
  }
  return realFetch(url, init);
};

const { BloxityIdentity } = await import('../server/dist/bloxity/BloxityIdentity.js');
const { SKU_WINS, buxGrants } = await import('../server/dist/progression/BuxGrants.js');
const { storage } = await import('../server/dist/persistence/index.js');
const { createHttpServer, BUX_WEBHOOK_PATH } = await import('../server/dist/httpServer.js');
await storage.open();

let failures = 0;
const check = (label, actual, expected) => {
  if (Object.is(actual, expected)) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A JWT-shaped token whose payload carries `exp` - read, never verified. */
const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

// ---------------------------------------------------------------- identity
console.log('identity');
{
  respond = () => json(200, { user: { _id: 'acct_victim_01' } });
  calls.length = 0;
  const identity = new BloxityIdentity('speed-broom-escape');

  const result = await identity.verify('good-token');
  check('a verified token yields its account id', result.status === 'verified' && result.accountId, 'acct_victim_01');

  const call = calls[0];
  check('  asked the documented verify URL (a constant)', call?.url, VERIFY_URL);
  check('  as a POST', call?.init?.method, 'POST');
  check('  with the token as a bearer', call?.init?.headers?.Authorization, 'Bearer good-token');
  check('  scoped to this game slug', JSON.parse(call?.init?.body ?? '{}').gameSlug, 'speed-broom-escape');

  await identity.verify('good-token');
  check('a verified answer is cached', calls.length, 1);
}
{
  // A token that expires in 10 seconds is not trusted for five minutes.
  respond = () => json(200, { _id: 'acct_exp' });
  calls.length = 0;
  const identity = new BloxityIdentity('slug');
  const shortLived = jwt({ exp: Math.floor(Date.now() / 1000) + 1 });
  await identity.verify(shortLived);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await identity.verify(shortLived);
  check("the cache never outlives the token's own exp", calls.length, 2);
}
{
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  respond = async () => {
    await gate;
    return json(200, { _id: 'acct_racer' });
  };
  calls.length = 0;
  const identity = new BloxityIdentity('slug');
  const both = Promise.all([identity.verify('same'), identity.verify('same')]);
  release();
  const [a, b] = await both;
  check('concurrent checks of one token share one request', calls.length, 1);
  check('  and both are verified', a.status === 'verified' && b.status === 'verified', true);
}
{
  respond = () => json(200, { _id: 'acct_bare', username: 'bare' });
  const identity = new BloxityIdentity('slug');
  const result = await identity.verify('t');
  check('an unwrapped user body is understood', result.status === 'verified' && result.accountId, 'acct_bare');
}

/*
 * THREE outcomes. "Rejected" is Bloxity saying no; "unavailable" is Bloxity
 * not being askable - a guest for now, asked again later, never a verdict.
 */
const outcomes = [
  ['a rejected token (401)', () => json(401, { code: 'GAME_TOKEN_INVALID' }), 'rejected'],
  ['a forbidden token (403)', () => json(403, {}), 'rejected'],
  ['a Bloxity outage (503)', () => json(503, { error: 'down' }), 'unavailable'],
  ['rate limiting (429)', () => json(429, {}), 'unavailable'],
  ['a 2xx with no account id', () => json(200, { user: { username: 'nobody' } }), 'unavailable'],
  ['a 2xx with a hostile "id"', () => json(200, { user: { _id: '../../etc/passwd' } }), 'unavailable'],
  ['a 2xx that is not JSON', () => new Response('<html>oops</html>', { status: 200 }), 'unavailable'],
  ['a network failure', () => Promise.reject(new TypeError('fetch failed')), 'unavailable'],
];
for (const [label, reply, expected] of outcomes) {
  respond = reply;
  const identity = new BloxityIdentity('slug');
  let result;
  try {
    result = await identity.verify('some-token');
  } catch {
    result = { status: 'THREW' };
  }
  check(`${label} -> ${expected}`, result.status, expected);
}
{
  // Rejected answers are cached briefly; unavailable ones never are.
  respond = () => json(401, {});
  calls.length = 0;
  const rejecting = new BloxityIdentity('slug');
  await rejecting.verify('forged');
  await rejecting.verify('forged');
  check('a rejection is cached (a replayed forgery is not a request each time)', calls.length, 1);

  respond = () => json(503, {});
  calls.length = 0;
  const flaky = new BloxityIdentity('slug');
  await flaky.verify('t');
  await flaky.verify('t');
  check('"unavailable" is never cached', calls.length, 2);
}
{
  // A Bloxity that never answers: the join must not hang on it.
  respond = (init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
    });
  const identity = new BloxityIdentity('slug');
  const started = Date.now();
  const result = await identity.verify('slow-token');
  check('a Bloxity that never answers times out as "unavailable"', result.status, 'unavailable');
  check('  within the 5 s budget', Date.now() - started < 6500, true);
}
{
  respond = () => json(200, { _id: 'acct' });
  calls.length = 0;
  const identity = new BloxityIdentity('slug');
  for (const bad of [undefined, null, 42, {}, '', '   ', 'x'.repeat(5000)]) {
    const result = await identity.verify(bad);
    if (result.status !== 'rejected') check(`non-token ${String(bad).slice(0, 10)} rejected`, result.status, 'rejected');
  }
  check('non-tokens and oversize tokens never reach Bloxity', calls.length, 0);
}

// -------------------------------------------------------------- fulfilment
console.log('fulfilment');
{
  const known = Object.keys(SKU_WINS)[0];
  check('a known SKU is recorded', await buxGrants.record('acct_a', 'txn-a1', known), 'queued');
  check('its redelivery is a duplicate', await buxGrants.record('acct_a', 'txn-a1', known), 'duplicate');
  check('an unknown SKU is refused', await buxGrants.record('acct_a', 'txn-a2', 'speed_boost_1h'), 'unknown-sku');
  check('  and is not remembered as recorded', await buxGrants.record('acct_a', 'txn-a2', 'speed_boost_1h'), 'unknown-sku');
  check('a grant with no account is malformed', await buxGrants.record('', 'txn-a3', known), 'malformed');

  const first = await storage.claimGrants('acct_a', 'pod-1');
  const second = await storage.claimGrants('acct_a', 'pod-2');
  check('exactly the one real purchase is claimable', first.length, 1);
  check('  worth its table value', first[0]?.wins, SKU_WINS[known]);
  check('  and a second claimant gets nothing', second.length, 0);
  check('another account sees none of it', (await storage.claimGrants('acct_b', 'pod-1')).length, 0);
}
{
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const post = async (payload, secret = SECRET) =>
    (
      await realFetch(`http://127.0.0.1:${port}${BUX_WEBHOOK_PATH}`, {
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

  const queued = await storage.claimGrants('acct_http', 'pod-1');
  check('webhook: only the one paid, known purchase was recorded', queued.length, 1);
  await new Promise((resolve) => server.close(resolve));
}
{
  // Recorded DURABLY: the grant file is on disk before the webhook answered.
  await storage.flush();
  const onDisk = JSON.parse(readFileSync(joinPath(DATA_DIR, 'grants.json'), 'utf8'));
  check('grants are written to disk, not held in memory', Object.keys(onDisk).includes('h1'), true);
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

await storage.close();
rmSync(DATA_DIR, { recursive: true, force: true });

console.log('');
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('bloxity OK');
