import { storage } from '../persistence/index.js';
import { logger } from '../util/logger.js';

const SCOPE = 'bux';

/**
 * What a SKU is worth, in Wins.
 *
 * The PRICE is not here and must never be: Bloxity charges the Bux from its
 * own catalogue, keyed by the game slug, and this server is only ever told
 * which SKU was bought. What this table decides is the other half - what the
 * game hands over - and that half belongs to the game.
 *
 * AN UNKNOWN SKU IS REFUSED, so that Bloxity REFUNDS it.
 *
 * This used to be the other way round - accept it with a 200, grant nothing,
 * log a warning - on the reasoning that refusing would "turn a genuine
 * purchase into one the player made and lost". That had it backwards. A 2xx
 * tells Bloxity to KEEP the Bux, and nothing ever comes back to fulfil a SKU
 * this table does not list, so the player paid and received nothing. A
 * non-2xx is the only answer that gives them their Bux back. A catalogue that
 * moved ahead of a deploy is the likeliest cause, and a refund is exactly the
 * right outcome for it.
 *
 * Every SKU the in-game shop offers MUST be in this table. `verify:bloxity`
 * checks that the two lists agree.
 */
export const SKU_WINS: Readonly<Record<string, number>> = {
  wins_small: 250,
  wins_large: 1500,
};

/** How `record` resolved a webhook. The webhook's HTTP status follows from it. */
export type RecordOutcome =
  /** Durably recorded for its account. Answer 2xx. */
  | 'queued'
  /** Already recorded by an earlier delivery. Answer 2xx - a retry must not refund. */
  | 'duplicate'
  /** Nothing in this build can fulfil it. Answer non-2xx, so Bloxity refunds. */
  | 'unknown-sku'
  /** Missing an account or a transaction. Answer non-2xx. */
  | 'malformed'
  /** Storage could not record it. Answer non-2xx - unrecorded must be refunded, not lost. */
  | 'unavailable';

/**
 * Purchases that have been paid for and not yet handed over.
 *
 * The webhook only ever RECORDS - the room applies what is waiting, on join
 * and on a slow poll for a player already in when they bought something.
 * Crediting the stored profile directly from the webhook would be a credit
 * the live session's next autosave writes straight back over.
 *
 * RECORDED DURABLY, in the same database as the profiles (the JSON store
 * without `MONGODB_URI`). This used to be an in-memory map, which on Legion
 * meant a purchase lived only in the pod the webhook happened to land on - and
 * vanished with it at the next idle scale-to-zero. Now:
 *
 *  - the transaction id is a UNIQUE key, so a webhook retry is recognised on
 *    any pod, after any restart, and pays out once;
 *  - grants are drained only against an account Bloxity itself VERIFIED from
 *    the player's token, never against an id a browser supplied;
 *  - draining CLAIMS each grant atomically, so two pods holding sessions for
 *    one account cannot both apply it (see `GrantStorage`);
 *  - the webhook answers 2xx only once the grant is durably recorded. If
 *    storage is down it answers 503, and Bloxity refunds rather than the
 *    purchase silently evaporating.
 */
class BuxGrants {
  async record(accountId: string, transactionId: string, sku: string): Promise<RecordOutcome> {
    if (!accountId || !transactionId) return 'malformed';

    // Checked BEFORE anything is recorded, so a retry after a deploy that adds
    // the SKU is honoured rather than dismissed as a duplicate.
    const wins = SKU_WINS[sku];
    if (wins === undefined || wins <= 0) {
      logger.warn(SCOPE, `unknown sku "${sku}" [${transactionId}] - refusing so it is refunded`);
      return 'unknown-sku';
    }

    try {
      const outcome = await storage.recordGrant({ transactionId, accountId, sku, wins });
      if (outcome === 'duplicate') {
        logger.info(SCOPE, `duplicate webhook for ${transactionId}, already recorded`);
        return 'duplicate';
      }
      logger.info(SCOPE, `recorded ${sku} (+${wins} wins) for account ${accountId} [${transactionId}]`);
      return 'queued';
    } catch (error) {
      logger.error(SCOPE, `could not record ${transactionId}; answering non-2xx so it is refused, not lost`, error);
      return 'unavailable';
    }
  }
}

export const buxGrants = new BuxGrants();
