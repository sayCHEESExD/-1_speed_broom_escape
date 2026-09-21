/**
 * The Bux-theft attack, replayed against a RUNNING server.
 *
 * The offline suite (`verify:bloxity`) proves the verifier refuses bad tokens
 * against a stub. This proves the ROOM is wired to it - that nothing on the
 * path from a join to a grant still believes a client - and it does so the way
 * an attacker would, with the real Bloxity API answering behind the server.
 *
 *   1. A purchase is queued for a victim account, through the real webhook.
 *   2. An attacker joins claiming the victim's id in the join options - the
 *      thing the room used to believe.
 *   3. Another joins with a forged token, and then re-sends one mid-session.
 *
 * None of them may receive the victim's Wins.
 *
 * Usage: start the server, then `npm run verify:identity`. The webhook secret,
 * if the server has one, is read from BLOXITY_WEBHOOK_SECRET.
 */
import { Client } from 'colyseus.js';
import { MessageType, ROOM_NAME } from '../shared/dist/index.js';

const ENDPOINT = process.env.ENDPOINT ?? 'ws://localhost:2569';
const HTTP = ENDPOINT.replace(/^ws/, 'http');
const VICTIM = `victimprobe${Date.now().toString(36)}`;

let failures = 0;
const check = (label, actual, expected) => {
  if (Object.is(actual, expected)) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Join, wait for our own player to be replicated, and hand back the room. */
const join = async (options) => {
  const room = await new Client(ENDPOINT).joinOrCreate(ROOM_NAME, options);
  // Every server message is expected by a real client; a probe has no use for
  // them, and registering nothing makes colyseus.js warn once per message.
  room.onMessage('*', () => {});
  for (let i = 0; i < 50 && !room.state?.players?.get(room.sessionId); i += 1) {
    await sleep(100);
  }
  return room;
};
const winsOf = (room) => room.state.players.get(room.sessionId)?.wins ?? -1;

console.log(`identity (${ENDPOINT})`);

// 1. Queue a real purchase for the victim.
const secret = process.env.BLOXITY_WEBHOOK_SECRET ?? '';
const webhook = await fetch(`${HTTP}/bloxity/bux`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(secret ? { 'x-legion-webhook-secret': secret } : {}),
  },
  body: JSON.stringify({
    transactionId: `txn-${VICTIM}`,
    userId: VICTIM,
    username: 'victim',
    gameSlug: 'speed-broom-escape',
    sku: 'wins_large',
    productName: 'Chest of Wins',
    productPrice: 0,
    timestamp: new Date().toISOString(),
  }),
});
check("the victim's purchase is accepted by the webhook", webhook.status, 200);

// 2. The old attack: claim the victim's id outright.
const byId = await join({ playerId: `idprobe-a-${VICTIM}`, bloxityId: VICTIM });
await sleep(800);
check("claiming the victim's account id grants nothing", winsOf(byId), 0);

// 3. A forged token, verified by the REAL Bloxity API, which rejects it.
const byToken = await join({ playerId: `idprobe-b-${VICTIM}`, bloxityToken: 'forged.jwt.token' });
await sleep(800);
check('joining with a forged token grants nothing', winsOf(byToken), 0);

// ...and the same forged token sent mid-session, as a login would be.
byToken.send(MessageType.SetIdentity, { token: 'forged.jwt.token' });
await sleep(2500);
check('a forged mid-session login grants nothing', winsOf(byToken), 0);

// The room stays perfectly playable for all of them: a failed identity is a
// GUEST, never a refused join.
check('both attackers were admitted as guests', !!byId.sessionId && !!byToken.sessionId, true);

await byId.leave(true);
await byToken.leave(true);

console.log('');
console.log(
  failures === 0
    ? `identity OK  (the probe's purchase stays queued for "${VICTIM}", an account that does not exist; a restart clears it)`
    : `${failures} problem(s) found`,
);
process.exit(failures === 0 ? 0 : 1);
