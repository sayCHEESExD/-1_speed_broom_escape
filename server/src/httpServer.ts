import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME } from '@broom/shared';
import { serverConfig } from './config/serverConfig.js';
import { buxGrants } from './progression/BuxGrants.js';
import { logger } from './util/logger.js';

const SCOPE = 'webhook';

/** Bloxity's fulfilment payload. Only the fields this game acts on. */
interface BuxWebhook {
  transactionId?: string;
  userId?: string;
  username?: string;
  gameSlug?: string;
  sku?: string;
  productName?: string;
  productPrice?: number;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

/** Read a JSON body, with a ceiling so a stuck socket cannot grow for ever. */
const readJson = async (request: IncomingMessage): Promise<BuxWebhook | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 64 * 1024) return null;
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BuxWebhook;
  } catch {
    return null;
  }
};

/**
 * A plain HTTP server for Colyseus to attach to.
 *
 * Owning it rather than letting Colyseus make its own means the same port
 * answers both the WebSocket upgrade and a `/health` probe - which is what a
 * managed host polls to decide the service is up.
 */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    if (request.url === '/health') {
      void handleHealth(response);
      return;
    }

    if (request.url === BUX_WEBHOOK_PATH && request.method === 'POST') {
      void handleBuxWebhook(request, response);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });

/** Where Bloxity delivers a paid purchase. */
export const BUX_WEBHOOK_PATH = '/bloxity/bux';

/**
 * The health probe, and the ONE place a room count is observable from outside.
 *
 * A managed host polls this to decide the service is up, so the useful thing
 * to report beside "ok" is what the process is actually holding: how many
 * rooms are live and how many players are in them. That makes two facts about
 * this game checkable from outside the process rather than only by reading its
 * logs - that a room holds at most fifteen, and that an empty room CLOSES
 * ITSELF rather than lingering with a simulation loop nobody is in.
 *
 * `verify:capacity` asserts exactly that against a running server.
 *
 * The query is asked of the matchmaker rather than counted here: the
 * matchmaker is the thing that knows, and a second tally kept alongside it
 * would be a second thing to get wrong.
 */
const handleHealth = async (response: ServerResponse): Promise<void> => {
  let rooms = 0;
  let players = 0;
  try {
    const live = await matchMaker.query({ name: ROOM_NAME });
    rooms = live.length;
    for (const room of live) players += room.clients;
  } catch (error) {
    // A health endpoint that can fail is not a health endpoint. An unavailable
    // matchmaker is reported as zero rooms rather than as a 500.
    logger.warn(SCOPE, `could not count rooms: ${String(error)}`);
  }

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ ok: true, room: ROOM_NAME, rooms, players }));
};

/**
 * Fulfilment, server to server.
 *
 * The ONLY way a Bux purchase becomes something a player owns. The client's
 * `requestPurchase` result is a receipt it can show; it is not a grant, and
 * nothing in the client is trusted to say a payment happened.
 *
 * ANSWERING 2xx IS THE CONTRACT, in both directions. A 2xx tells Bloxity the
 * purchase is fulfilled and it KEEPS the Bux; anything else and it refunds.
 * So the status is chosen by one question - can this build actually deliver
 * what was bought?
 *
 *  - 200 once it is DURABLY recorded for its account, and 200 for a duplicate
 *    delivery of something already recorded: a retry must never refund a
 *    purchase that was recorded the first time.
 *  - 503 when storage cannot record it - unacknowledged, so refunded, never
 *    silently lost.
 *  - 422 for a SKU this build cannot fulfil. It used to answer 200 here, which
 *    kept the player's Bux and gave them nothing - see `BuxGrants`.
 *  - 401 for a bad secret and 400 for a body that cannot be recorded at all.
 */
const handleBuxWebhook = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const reply = (status: number, body: Record<string, unknown>): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  // The secret is optional so a local server needs no configuration, but if
  // one IS configured it is enforced - a webhook that accepted anything would
  // be an endpoint that grants Wins to whoever finds it.
  const expected = serverConfig.buxWebhookSecret;
  if (expected) {
    const supplied = request.headers['x-legion-webhook-secret'];
    if (supplied !== expected) {
      logger.warn(SCOPE, 'rejected a webhook with a bad secret');
      reply(401, { ok: false, error: 'bad secret' });
      return;
    }
  }

  const body = await readJson(request);
  if (!body?.transactionId || !body.userId || !body.sku) {
    logger.warn(SCOPE, 'rejected a webhook with no transaction, user or sku');
    reply(400, { ok: false, error: 'malformed payload' });
    return;
  }

  const outcome = await buxGrants.record(body.userId, body.transactionId, body.sku);
  switch (outcome) {
    case 'queued':
    case 'duplicate':
      logger.info(
        SCOPE,
        `accepted ${body.sku} for ${body.username ?? body.userId} [${body.transactionId}] (${outcome})`,
      );
      reply(200, { ok: true, transactionId: body.transactionId });
      return;
    case 'unknown-sku':
      // Non-2xx on purpose: this is how the player gets their Bux back.
      reply(422, { ok: false, error: `unknown sku "${body.sku}"` });
      return;
    case 'unavailable':
      // Not durably recorded, so NOT acknowledged. Bloxity refunds instead of
      // the purchase evaporating with a pod.
      reply(503, { ok: false, error: 'storage unavailable' });
      return;
    default:
      reply(400, { ok: false, error: 'malformed payload' });
  }
};
