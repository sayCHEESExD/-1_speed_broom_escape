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
  /** Queued for its player. Answer 2xx. */
  | 'queued'
  /** Already fulfilled by an earlier delivery. Answer 2xx - a retry must not refund. */
  | 'duplicate'
  /** Nothing in this build can fulfil it. Answer non-2xx, so Bloxity refunds. */
  | 'unknown-sku'
  /** Missing an account or a transaction. Answer non-2xx. */
  | 'malformed';

/** One purchase, waiting for its player to be somewhere it can be applied. */
export interface PendingGrant {
  readonly transactionId: string;
  readonly sku: string;
  readonly wins: number;
}

/**
 * Purchases that have been paid for and not yet handed over.
 *
 * A QUEUE rather than a direct write, and that is the whole design. The
 * webhook arrives on the HTTP thread at a moment of Bloxity's choosing; the
 * player may be live in a room with their Wins held in replicated state that
 * the autosave will write over the stored profile a few seconds later.
 * Crediting the stored profile directly would therefore be a credit that
 * vanishes on the next save. So the webhook only ever RECORDS, and the room
 * applies what is waiting - on join, and on a slow timer for a player who was
 * already in when they bought something.
 *
 * Transaction ids are remembered so a webhook Bloxity retries - which it will,
 * if this server was slow to answer - pays out once.
 */
class BuxGrants {
  /** Queued grants, by Bloxity user id. */
  private readonly pending = new Map<string, PendingGrant[]>();
  /** Every transaction already accepted, so a retry is not a second payout. */
  private readonly seen = new Set<string>();

  /**
   * Record a paid purchase.
   *
   * The ORDER of the checks is load-bearing. A duplicate is recognised first,
   * so a retry of something already fulfilled is acknowledged rather than
   * refunded. An unknown SKU is refused BEFORE the transaction is marked seen,
   * so nothing about it is remembered as fulfilled - if Bloxity retries after a
   * deploy that added the SKU, that retry is honoured.
   */
  record(bloxityId: string, transactionId: string, sku: string): RecordOutcome {
    if (!bloxityId || !transactionId) return 'malformed';
    if (this.seen.has(transactionId)) {
      logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
      return 'duplicate';
    }

    const wins = SKU_WINS[sku];
    if (wins === undefined || wins <= 0) {
      logger.warn(SCOPE, `unknown sku "${sku}" [${transactionId}] - refusing so it is refunded`);
      return 'unknown-sku';
    }

    this.seen.add(transactionId);

    const queue = this.pending.get(bloxityId) ?? [];
    queue.push({ transactionId, sku, wins });
    this.pending.set(bloxityId, queue);
    logger.info(
      SCOPE,
      `queued ${sku} (+${wins} wins) for ${bloxityId} [${transactionId}]`,
    );
    return 'queued';
  }

  /** Take everything waiting for a player. Empties the queue. */
  drain(bloxityId: string): PendingGrant[] {
    if (!bloxityId) return [];
    const queue = this.pending.get(bloxityId);
    if (!queue || queue.length === 0) return [];
    this.pending.delete(bloxityId);
    return queue;
  }

  /** True if anyone at all is owed something, so the tick can skip the work. */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }
}

export const buxGrants = new BuxGrants();
