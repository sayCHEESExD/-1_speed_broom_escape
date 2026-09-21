import { Client, Room, ServerError } from '@colyseus/core';
import {
  BroomAnimationState,
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  createMotion,
  type BuyTrailMessage,
  type ClaimBroomMessage,
  type ClaimStageMessage,
  type EquipTrailMessage,
  type MoveMessage,
  type PlayerMotion,
  type RespawnMessage,
  type RespawnReason,
  type StageAwardedMessage,
  sanitizeAppearance,
  sanitizeProportions,
  type SetAvatarMessage,
  type SetIdentityMessage,
  type GuestIdMessage,
} from '@broom/shared';
import { bloxityIdentity, type IdentityResult } from '../bloxity/BloxityIdentity.js';
import { StorageUnavailableError, storage } from '../persistence/index.js';
import {
  applyProfile,
  guestKeyFrom,
  accountKey,
  resolveAccount,
  resolveGuest,
  snapshotOf,
  type Resolution,
} from '../progression/Profiles.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { BroomService } from '../progression/BroomService.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { profileStore } from '../progression/ProfileStore.js';
import { RebirthService } from '../progression/RebirthService.js';
import { SpeedService } from '../progression/SpeedService.js';
import { StageService } from '../progression/StageService.js';
import { wallet } from '../progression/Wallet.js';
import { TrailService } from '../progression/TrailService.js';
import { GuardianService } from '../world/GuardianService.js';
import { logger } from '../util/logger.js';
import { CourseState } from './state/CourseState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'CourseRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;

/**
 * Least time between two identity changes being PROCESSED for one session.
 *
 * Each costs a call to Bloxity and possibly a storage round trip, so a client
 * that streamed tokens would be using this server to hammer both. A request
 * inside the window is DELAYED, never dropped - dropping a logout that came
 * two seconds after a login would leave the player signed in to an account
 * they had just left.
 */
const IDENTITY_COOLDOWN_MS = 2000;

/** How often a signed-in session checks for purchases made while it plays. */
const GRANT_POLL_SECONDS = 5;

/** Re-verify backoff while Bloxity is unavailable: from here... */
const REVERIFY_MIN_MS = 5000;
/** ...doubling up to here, for as long as the session lasts. */
const REVERIFY_MAX_MS = 60_000;

/**
 * Everything the room knows about one session's identity and progress.
 *
 * ONE record rather than a handful of parallel maps, because the rules that
 * matter here are about these fields changing TOGETHER: a session switching
 * profiles must never be half on one and half on the other.
 */
interface Session {
  /** This browser's guest id. Rotated if its guest copy gets migrated. */
  guestKey: string | null;
  /** Where this session's progress is saved RIGHT NOW. */
  profileKey: string;
  /** The Bloxity account Bloxity VERIFIED for this session, or null. */
  accountId: string | null;
  /** Purchases already paid into this profile. See `StoredProfile.appliedGrants`. */
  appliedGrants: Set<string>;
  /** True while switching profiles: autosaves are blocked. */
  switching: boolean;
  /** True while the identity pipeline is running for this session. */
  busy: boolean;
  /** The newest identity change asked for and not yet processed ('' = sign out). */
  wanted: string | undefined;
  /** When an identity change was last processed, for the cooldown. */
  identityAt: number;
  /** The token Bloxity could not be asked about, re-tried on a backoff. */
  retryToken: string | null;
  retryDelay: number;
  timer: NodeJS.Timeout | null;
  /** True while purchases are being applied. */
  granting: boolean;
}

/** Options a client may pass on join. Both are cosmetic or identity only. */
/**
 * What `onAuth` resolved, handed to `onJoin` by Colyseus.
 *
 * The WHOLE decision is made in `onAuth` - who this is and which profile they
 * play on - because it is the one hook that may be asynchronous before the
 * player is admitted. `onJoin` only applies it.
 */
interface JoinAuth {
  guestKey: string | null;
  identity: IdentityResult | null;
  token: string | null;
  resolution: Resolution;
}

interface JoinOptions {
  playerId?: string;
  name?: string;
  /**
   * The player's Bloxity TOKEN, when they are signed in to the portal.
   *
   * Never an account id. The server verifies this with Bloxity in `onAuth` and
   * binds only the id Bloxity returns - see `BloxityIdentity` for why a
   * client-supplied id was a way to collect somebody else's purchases.
   */
  bloxityToken?: string;
  /**
   * The player's Bloxity appearance, so they are drawn correctly by everyone
   * already in the room from their very first patch rather than after a
   * follow-up message has made the round trip.
   */
  avatar?: SetAvatarMessage;
}

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. What it owns outright is the CLOCK - `state.elapsed` is what
 * the moving hazards are a pure function of, so a hazard death is decided
 * against the server's own time and never against a client's.
 *
 * The one hard rule: nothing a client sends is ever copied into state. A Move
 * is simulated, a claim is validated, and both produce a result the server
 * writes itself.
 */
export class CourseRoom extends Room<CourseState> {
  /**
   * Capacity, and the matchmaker's cue to open another room.
   *
   * Colyseus locks a room the moment this is reached and `joinOrCreate` sends
   * the next player to a fresh one, so a full server routes rather than
   * refuses. The figure is shared with the client so the two can never hold
   * different ideas of how big a room is.
   */
  override maxClients = MAX_PLAYERS_PER_ROOM;

  /**
   * AN EMPTY ROOM CLOSES ITSELF.
   *
   * Colyseus already defaults this to true, and it is written out anyway
   * because it is a requirement of this game rather than an accident of the
   * framework's defaults: the moment the last client leaves, the room is
   * disposed, its simulation interval is cleared and its state is freed. A
   * long-lived server that kept an empty room per stage anybody had ever
   * played would leak a tick loop apiece.
   *
   * `onDispose` is what makes that safe: every remaining player's progression
   * is written out before the room dies, so a player disconnecting alone loses
   * nothing.
   */
  override autoDispose = true;

  private readonly movement = new MovementService();
  private readonly speeds = new SpeedService();
  private readonly stages = new StageService();
  private readonly brooms = new BroomService();
  private readonly rebirths = new RebirthService();
  private readonly trails = new TrailService();
  private readonly guardian = new GuardianService();

  /** Identity and progress, per session. See `Session`. */
  private readonly sessions = new Map<string, Session>();

  /**
   * Profile key per session, for the leaderboard - which ranks by the key a
   * player's progress is SAVED under, so a live player and their stored copy
   * are recognised as one person.
   */
  private readonly profileKeys = new Map<string, string>();

  private grantPollTimer = 0;

  /** Scratch motion, so the per-tick death check allocates nothing. */
  private readonly scratch: PlayerMotion = createMotion();

  private autosaveTimer = 0;

  override onCreate(): void {
    this.state = new CourseState();
    this.setPatchRate(serverConfig.patchRateMs);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) =>
      this.onMove(client, message),
    );
    this.onMessage(MessageType.ClaimStage, (client, message: ClaimStageMessage) =>
      this.onClaimStage(client, message),
    );
    this.onMessage(MessageType.ClaimBroom, (client, message: ClaimBroomMessage) =>
      this.onClaimBroom(client, message),
    );
    this.onMessage(MessageType.RequestRespawn, (client) =>
      this.respawn(client, 'manual'),
    );
    this.onMessage(MessageType.Rebirth, (client) => this.onRebirth(client));
    this.onMessage(MessageType.BuyTrail, (client, message: BuyTrailMessage) =>
      this.onBuyTrail(client, message),
    );
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) =>
      void this.onSetIdentity(client, message),
    );
    this.onMessage(MessageType.SetAvatar, (client, message: SetAvatarMessage) =>
      this.onSetAvatar(client, message),
    );
    this.onMessage(MessageType.EquipTrail, (client, message: EquipTrailMessage) =>
      this.onEquipTrail(client, message),
    );

    this.guardian.reset(this.state.guardian);

    this.setSimulationInterval(
      (deltaMs) => this.tick(deltaMs / 1000),
      serverConfig.patchRateMs,
    );

    logger.info(
      SCOPE,
      `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`,
    );
  }

  /**
   * The capacity check that does not depend on the matchmaker.
   *
   * `maxClients` is enforced when a seat is RESERVED, which is the right place
   * and covers every normal join. This is the second line: a seat reservation
   * that is consumed late, a direct `joinById` into a room that filled while
   * the request was in flight, or any future path that reaches a room without
   * going through matchmaking would all arrive here. Refusing at the door
   * costs one comparison and makes the limit a property of the ROOM rather
   * than of the route taken to it.
   *
   * Nothing about this is client-side: a client cannot decline to call it and
   * cannot see the number it is compared against.
   */
  override async onAuth(_client: Client, options: JoinOptions = {}): Promise<JoinAuth> {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      logger.warn(
        SCOPE,
        `refused a join: room ${this.roomId} is full ` +
          `(${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
      );
      throw new ServerError(4103, 'room is full');
    }

    /*
     * The browser's guest id. One that tries to name an ACCOUNT is refused
     * outright: the `bloxity:` prefix is reserved, and a guest who could
     * simply call themselves `bloxity:<someone>` would be handed that
     * account's progress without ever proving who they are.
     */
    const guest = guestKeyFrom(options.playerId);
    if (guest === 'reserved') {
      logger.warn(SCOPE, 'refused a join whose player id claims the reserved account prefix');
      throw new ServerError(4003, 'invalid player id');
    }

    /*
     * WHO this is, asked of Bloxity - never of the client. A token that does
     * not verify, or a Bloxity that cannot be reached, admits a GUEST: the
     * game is fully playable signed out, and an outage of Bloxity must not be
     * an outage of this game. "Unavailable" is retried in the background.
     */
    const token =
      typeof options.bloxityToken === 'string' && options.bloxityToken ? options.bloxityToken : null;
    const identity = token ? await bloxityIdentity.verify(token) : null;
    const accountId = identity?.status === 'verified' ? identity.accountId : null;

    /*
     * The same player live in THIS room already (a reconnect whose old socket
     * has not timed out) has progress newer than its last autosave. Queue it
     * first, so the read below sees it rather than the older stored copy.
     */
    const candidates = new Set<string>();
    if (accountId) candidates.add(accountKey(accountId));
    if (guest) candidates.add(guest);
    for (const [sessionId, session] of this.sessions) {
      const live = this.state.players.get(sessionId);
      if (live && candidates.has(session.profileKey)) {
        storage.put(session.profileKey, snapshotOf(live, session.appliedGrants));
      }
    }

    /*
     * The profile, READ FROM STORAGE NOW - never from a cache filled at boot,
     * because another pod may have saved this player since.
     *
     * If storage cannot answer, the join is REFUSED. Letting the player in on
     * an empty profile would be letting the first autosave write that
     * emptiness over their real progress. The client retries on a backoff and
     * gets in once storage is back.
     */
    let resolution: Resolution;
    try {
      resolution = accountId ? await resolveAccount(accountId, guest) : await resolveGuest(guest);
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        logger.error(SCOPE, `refused a join: ${error.message}`);
        throw new ServerError(4503, 'progress storage is unavailable; please try again shortly');
      }
      throw error;
    }

    return { guestKey: guest, identity, token, resolution };
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: JoinAuth): void {
    if (!auth) throw new ServerError(4500, 'join was not authorised');
    const { resolution } = auth;

    const player = new PlayerState();
    player.sessionId = client.sessionId;

    // Restore BEFORE any service initialises: level, movement speed and the
    // equipped broom are all derived from the restored figures.
    applyProfile(player, resolution.profile);

    const session: Session = {
      guestKey: resolution.newGuestKey ?? auth.guestKey,
      profileKey: resolution.key,
      accountId: auth.identity?.status === 'verified' ? auth.identity.accountId : null,
      appliedGrants: new Set(resolution.profile?.appliedGrants ?? []),
      switching: false,
      busy: false,
      wanted: undefined,
      identityAt: 0,
      retryToken: null,
      retryDelay: REVERIFY_MIN_MS,
      timer: null,
      granting: false,
    };
    this.sessions.set(client.sessionId, session);
    this.profileKeys.set(client.sessionId, session.profileKey);

    this.state.players.set(client.sessionId, player);
    this.initialiseProgress(client.sessionId, player);
    if (options.avatar) this.writeAvatar(player, options.avatar);

    // A browser whose guest copy was migrated gets a fresh id to keep.
    if (resolution.newGuestKey) this.sendGuestId(client, resolution.newGuestKey);

    // Put the player at spawn through the SAME path a respawn takes.
    this.placeAt(client, player, 'join');

    // Anything bought while they were away - by webhook, on any pod.
    if (session.accountId) void this.applyGrants(client.sessionId);

    // Bloxity could not be asked: guest for now, and keep asking.
    if (auth.identity?.status === 'unavailable' && auth.token) {
      this.scheduleReverify(client.sessionId, auth.token);
    }

    const how = resolution.migratedFrom
      ? 'migrated from guest'
      : resolution.profile
        ? 'restored'
        : 'new';
    logger.info(
      SCOPE,
      `join ${client.sessionId} as ${session.accountId ? `ACCOUNT ${session.profileKey}` : 'guest'} ` +
        `(${how}) level=${player.level} wins=${player.wins} broom=${player.broomSlot}`,
    );
  }

  /**
   * The services that derive everything from a profile, in ONE order.
   *
   * Used by `onJoin` and again by every mid-session profile switch, so a
   * switched session is initialised exactly as a fresh join would be.
   */
  private initialiseProgress(sessionId: string, player: PlayerState): void {
    this.movement.initialise(player);
    this.brooms.initialise(player);
    this.trails.initialise(player);
    this.speeds.initialise(player);
    this.stages.initialise(sessionId);
    this.rebirths.sync(player);
    // `initialise` reset the level to 1; the profile's Speed decides it.
    this.speeds.syncDerived(player);
  }

  private sendGuestId(client: Client, playerId: string): void {
    const message: GuestIdMessage = { playerId };
    client.send(MessageType.GuestId, message);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    // Saved even mid-switch: the profile key and the player state it describes
    // are only ever changed together, in one synchronous step, so whatever key
    // the session holds right now matches the state being written.
    if (player && session) this.save(session, player);
    if (session?.timer) clearTimeout(session.timer);

    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.speeds.forget(client.sessionId);
    this.stages.forget(client.sessionId);
    this.brooms.forget(client.sessionId);
    this.trails.forget(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.profileKeys.delete(client.sessionId);

    logger.info(SCOPE, `leave ${client.sessionId}`);
  }

  override onDispose(): void {
    // Every remaining player's progression, queued before the room dies. The
    // shutdown path then waits for the store to flush it.
    for (const [sessionId, player] of this.state.players) {
      const session = this.sessions.get(sessionId);
      if (session) this.save(session, player);
      if (session?.timer) clearTimeout(session.timer);
    }
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

  /**
   * One input: simulate it, then pay for the movement it actually produced.
   *
   * The ORDER is the whole point. `applyInput` writes the authoritative
   * transform, and only then does `credit` measure the distance between the
   * previous authoritative position and this one. Crediting from the message
   * would be paying a client for a number it chose.
   */
  private onMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (
      !this.movement.applyInput(client.sessionId, player, message, this.state.elapsed)
    ) {
      return;
    }

    this.speeds.credit(client.sessionId, player, this.movement.lastStep);
    player.animation = resolveAnimation(player);
  }

  /** A stage claim. The server validates it against its own transform. */
  private onClaimStage(client: Client, message: ClaimStageMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const index = Number(message?.stageIndex);
    if (!Number.isFinite(index)) return;

    const award = this.stages.claim(client.sessionId, player, index);
    if (!award.granted || !award.stage) return;

    const payload: StageAwardedMessage = {
      stageIndex: award.stage.index,
      wins: award.wins,
      total: player.wins,
    };
    client.send(MessageType.StageAwarded, payload);

    // Banking a stage RETURNS the player to the starting arena. That is the
    // loop the win pad's "Return" label promises, and it is also what makes a
    // second payment impossible: the pad is hundreds of units behind them
    // before another request could arrive.
    this.placeAt(client, player, 'stage');

    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `stage ${award.stage.index} banked by ${client.sessionId} (+${award.wins} wins, total ${player.wins})`,
    );
  }

  /** An broom claim. The server takes the payment and grants the broom. */
  private onClaimBroom(client: Client, message: ClaimBroomMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const slot = Number(message?.slot);
    if (!Number.isFinite(slot)) return;

    const claim = this.brooms.claim(player, slot, this.speeds);
    if (!claim.granted || !claim.broom) return;

    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${client.sessionId} claimed ${claim.broom.name} (wins left ${player.wins})`,
    );
  }

  /** A rebirth request. The server alone decides whether it is allowed. */
  private onRebirth(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.rebirths.rebirth(player, this.speeds);
    if (!result.ok) return;

    // A rebirth resets the RUN as well as the curve: the player's level - and
    // therefore their speed - is no longer what carried them to wherever they
    // were standing, so they start again from the arena.
    this.placeAt(client, player, 'rebirth');
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${client.sessionId} rebirthed to ${result.rebirths} (x${result.multiplier})`,
    );
  }

  /** A trail purchase. The server takes the payment and grants the trail. */
  private onBuyTrail(client: Client, message: BuyTrailMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.trails.buy(player, message?.slot, this.speeds);
    if (!result.ok) return;

    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${client.sessionId} bought ${result.tier.name} (wins left ${result.winsAfter})`,
    );
  }

  /** Equip an owned trail, or 0 to take it off. */
  private onEquipTrail(client: Client, message: EquipTrailMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.trails.equip(player, message?.slot, this.speeds).ok) return;
    this.persist(client.sessionId, player);
  }

  /**
   * "This is what I look like."
   *
   * Accepted rather than adjudicated, which is the opposite of every other
   * client message here and is safe for one reason: the payload decides
   * nothing. The portal owns a player's appearance and this server has no way
   * to ask it, so the client is the only source of the truth - and the worst a
   * forged one achieves is wearing a hat it did not buy, on its own screen and
   * everyone else's. It is NOT persisted: the appearance lives in the player's
   * Bloxity account, and a copy in the profile would be a second one to keep
   * in step with the first.
   */
  private onSetAvatar(client: Client, message: SetAvatarMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.writeAvatar(player, message);
  }

  /**
   * The player signed in, signed out or switched account MID-SESSION.
   *
   * Handled on the live session rather than by reconnecting: a reconnect can
   * land on another pod before this session's last write has reached the
   * database, and would load a profile older than the one being played.
   *
   * Only the NEWEST request counts. It is recorded here and processed by
   * `processIdentity`, which runs one at a time per session; a request that
   * arrives mid-switch simply replaces whatever was waiting.
   */
  private onSetIdentity(client: Client, message: SetIdentityMessage): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.wanted = typeof message?.token === 'string' ? message.token : '';
    // A new request supersedes any background re-verify of an older token.
    session.retryToken = null;
    session.retryDelay = REVERIFY_MIN_MS;
    void this.processIdentity(client.sessionId);
  }

  /** Work through the newest identity request, one at a time. */
  private async processIdentity(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.busy || session.wanted === undefined) return;

    const wait = IDENTITY_COOLDOWN_MS - (Date.now() - session.identityAt);
    if (wait > 0) {
      if (!session.timer) {
        session.timer = setTimeout(() => {
          session.timer = null;
          void this.processIdentity(sessionId);
        }, wait);
      }
      return;
    }

    const token = session.wanted;
    session.wanted = undefined;
    session.identityAt = Date.now();
    session.busy = true;
    try {
      if (!token) {
        if (session.accountId) await this.switchProfile(sessionId, null);
        return;
      }
      const result = await bloxityIdentity.verify(token);
      // Superseded while Bloxity was answering: only the newest counts.
      if (session.wanted !== undefined || !this.sessions.has(sessionId)) return;

      if (result.status === 'verified') {
        if (session.accountId !== result.accountId) {
          await this.switchProfile(sessionId, result.accountId);
        }
      } else if (result.status === 'rejected') {
        // A token Bloxity refuses is a sign-out, as far as this session goes.
        if (session.accountId) await this.switchProfile(sessionId, null);
      } else {
        // Unavailable: stay exactly where we are, and ask again later.
        this.scheduleReverify(sessionId, token);
      }
    } finally {
      session.busy = false;
      if (session.wanted !== undefined) void this.processIdentity(sessionId);
    }
  }

  /**
   * Bloxity could not be asked: keep asking, on a backoff, for as long as the
   * session lasts. Never a permanent demotion to guest.
   */
  private scheduleReverify(sessionId: string, token: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.retryToken = token;
    const delay = session.retryDelay;
    session.retryDelay = Math.min(session.retryDelay * 2, REVERIFY_MAX_MS);
    const timer = setTimeout(() => {
      // Only if nothing newer was asked for in the meantime.
      if (session.retryToken !== token || session.wanted !== undefined) return;
      session.retryToken = null;
      session.wanted = token;
      void this.processIdentity(sessionId);
    }, delay);
    timer.unref();
    logger.info(SCOPE, `${sessionId}: Bloxity unavailable, re-verifying in ${delay}ms (guest meanwhile)`);
  }

  /**
   * Move a live session onto another profile - an account, or (null) back to
   * this browser's guest profile.
   *
   *  1. Autosaves for this session are BLOCKED for the duration.
   *  2. The profile being LEFT is saved from live state and the save awaited.
   *  3. The new profile is resolved - migrating guest progress into a new
   *     account from the LIVE state, which is newer than any autosave.
   *  4. It is applied, and the same service initialisation `onJoin` runs is
   *     run again; pending purchases are applied; the player is placed at
   *     spawn; the new profile is saved.
   *
   * If storage fails at any point before step 4, the session STAYS on the
   * profile it was on - nothing is applied halfway.
   */
  private async switchProfile(sessionId: string, accountId: string | null): Promise<void> {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!session || !player || !client) return;

    session.switching = true;
    try {
      const live = snapshotOf(player, session.appliedGrants);
      const leaving = session.profileKey;
      let resolution: Resolution;
      try {
        await storage.write(leaving, live);
        resolution = accountId
          ? await resolveAccount(
              accountId,
              session.guestKey,
              // Only a GUEST session's live state is guest progress.
              session.accountId === null && leaving === session.guestKey ? live : undefined,
            )
          : await resolveGuest(session.guestKey);
      } catch (error) {
        if (error instanceof StorageUnavailableError) {
          logger.error(SCOPE, `${sessionId}: identity change NOT applied, storage unavailable; staying on the current profile`);
          return;
        }
        throw error;
      }
      // The player may have gone while storage answered.
      if (!this.state.players.has(sessionId)) return;

      // Applied in ONE synchronous step: the key and the state it describes
      // change together, so no save can ever write one with the other.
      applyProfile(player, resolution.profile);
      session.profileKey = resolution.key;
      session.accountId = accountId;
      session.appliedGrants = new Set(resolution.profile?.appliedGrants ?? []);
      this.profileKeys.set(sessionId, resolution.key);
      if (resolution.newGuestKey) {
        session.guestKey = resolution.newGuestKey;
        this.sendGuestId(client, resolution.newGuestKey);
      }
      this.initialiseProgress(sessionId, player);
      this.placeAt(client, player, 'identity');

      logger.info(
        SCOPE,
        `${sessionId} is now ${accountId ? `ACCOUNT ${resolution.key}` : 'a guest'} ` +
          `(${resolution.migratedFrom ? 'migrated from guest' : resolution.profile ? 'restored' : 'new'}) ` +
          `level=${player.level} wins=${player.wins}`,
      );
    } finally {
      session.switching = false;
    }

    if (session.accountId) await this.applyGrants(sessionId);
    this.save(session, player);
  }

  /** Sanitise, then write in place. The one path an appearance is set by. */
  private writeAvatar(player: PlayerState, message: SetAvatarMessage): void {
    player.avatar.apply(
      sanitizeAppearance(message?.appearance),
      sanitizeProportions(message?.proportions),
    );
  }

  /**
   * The per-tick pass the client cannot influence.
   *
   * Deaths are decided HERE, from the position the server simulated and the
   * clock the server owns, rather than from a client saying it was hit. There
   * is no hazard message in this game for exactly that reason.
   */
  private tick(delta: number): void {
    this.state.elapsed += delta;
    const time = this.state.elapsed;

    // The guardian CHASES, so it cannot be a pure function of time. The server
    // moves it from the authoritative positions it already has, and the kill
    // below is decided against that same position.
    this.guardian.update(this.state.guardian, delta, this.state.players.values());

    // The boards on the spawn wall. Rebuilt on their own slow timer inside the
    // service - a leaderboard is not a thing anyone reads twenty times a
    // second, and sorting every profile at tick rate to feed a sign would be
    // the most expensive thing in this room.
    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.profileKeys);

    /*
     * Bux bought by someone already in the room - recorded by the webhook on
     * whichever pod it landed on, so the only way to know is to ask storage.
     * Signed-in sessions only, on a slow poll.
     */
    this.grantPollTimer += delta;
    if (this.grantPollTimer >= GRANT_POLL_SECONDS) {
      this.grantPollTimer = 0;
      for (const [sessionId, session] of this.sessions) {
        if (session.accountId && !session.switching) void this.applyGrants(sessionId);
      }
    }

    for (const [sessionId, player] of this.state.players) {
      if (!player.ready) continue;

      const triggers = this.movement.collision.sampleTriggers(
        player.x,
        player.y,
        player.z,
        time,
      );
      const trampled = this.guardian.hits(this.state.guardian, player);

      if (triggers.fell || triggers.hazard || trampled) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.respawn(client, triggers.fell ? 'fell' : 'hazard');
      }
    }

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      // Speed accrues continuously between the discrete events that otherwise
      // trigger a save, so a crash without this would cost a whole session.
      for (const [sessionId, player] of this.state.players) {
        const session = this.sessions.get(sessionId);
        // Blocked while switching: that session is mid-way between profiles.
        if (session && !session.switching) this.save(session, player);
      }
    }
  }

  /**
   * Hand over anything this ACCOUNT has paid for and not yet received.
   *
   * Only ever for the account Bloxity VERIFIED for this session - never for an
   * id a browser supplied. Each grant is:
   *
   *  1. CLAIMED atomically in storage, so no other pod or session pays it;
   *  2. paid through `wallet.add`, the one place Wins move - unless the
   *     profile's `appliedGrants` shows it was already paid (a claim abandoned
   *     by a pod that died between paying and closing it);
   *  3. saved DURABLY into the profile, and only then
   *  4. marked applied.
   */
  private async applyGrants(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.accountId || session.switching || session.granting) return;
    session.granting = true;
    try {
      const accountId = session.accountId;
      const profileKey = session.profileKey;
      const claimed = await storage.claimGrants(accountId, serverConfig.podName);
      if (claimed.length === 0) return;

      const player = this.state.players.get(sessionId);
      // Gone, or switched away mid-claim: leave the claims. They time out and
      // are claimed again by whichever session holds the account next.
      if (!player || session.accountId !== accountId || session.profileKey !== profileKey) return;

      for (const grant of claimed) {
        if (session.appliedGrants.has(grant.transactionId)) continue;
        wallet.add(player, grant.wins);
        session.appliedGrants.add(grant.transactionId);
        logger.info(
          SCOPE,
          `granted ${grant.sku} to ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`,
        );
      }

      await storage.write(profileKey, snapshotOf(player, session.appliedGrants));
      for (const grant of claimed) await storage.markApplied(grant.transactionId, profileKey);
    } catch (error) {
      // The Wins are in the live session and the save stays queued; unclosed
      // claims time out, and `appliedGrants` stops them paying twice.
      logger.warn(SCOPE, `${sessionId}: applying purchases did not finish (${String(error)})`);
    } finally {
      session.granting = false;
    }
  }

  /** Put a player back at the starting arena and tell them so. */
  private respawn(client: Client, reason: RespawnReason): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.placeAt(client, player, reason);
  }

  /**
   * THE one way a player is placed, and there is exactly ONE destination.
   *
   * `SPAWN_POSITION` - the starting arena - whatever the cause and whatever
   * stage the player was on. There are no checkpoints in this game and no
   * second place a player can arrive at, which is why this takes no position:
   * a placement that could land somewhere else is the bug the parameter used
   * to allow.
   *
   * Teleports the simulation, drops the Speed baseline (or the teleport itself
   * would be credited as distance travelled), and sends the authoritative
   * transform.
   */
  private placeAt(client: Client, player: PlayerState, reason: RespawnReason): void {
    this.movement.teleport(
      client.sessionId,
      player,
      SPAWN_POSITION.x,
      SPAWN_POSITION.y,
      SPAWN_POSITION.z,
      SPAWN_ROTATION_Y,
    );
    this.speeds.reset(client.sessionId, player);
    player.animation = BroomAnimationState.Idle;
    // A death plays the fall-over. Arriving, banking a stage and being reborn are
    // all PLACEMENTS rather than deaths, so none of them bumps the counter.
    if (reason === 'fell' || reason === 'hazard') player.deathCount += 1;

    const message: RespawnMessage = {
      x: SPAWN_POSITION.x,
      y: SPAWN_POSITION.y,
      z: SPAWN_POSITION.z,
      rotationY: SPAWN_ROTATION_Y,
      reason,
    };
    client.send(MessageType.Respawn, message);

    // Every placement is logged with its cause. A player who finds themselves
    // back at the arena and cannot say why is the hardest bug in this game to
    // diagnose from the outside, and one line here answers it.
    if (reason !== 'join') {
      logger.info(SCOPE, `place ${client.sessionId} -> spawn (${reason})`);
    }
  }

  /** Save a session now - queued, retried until it lands, never dropped. */
  private persist(sessionId: string, player: PlayerState): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.switching) this.save(session, player);
  }

  private save(session: Session, player: PlayerState): void {
    const snapshot = snapshotOf(player, session.appliedGrants);
    storage.put(session.profileKey, snapshot);
    profileStore.noteSaved(session.profileKey, snapshot);
  }
}

/**
 * The animation state a replicated player is in.
 *
 * Derived from motion the server already owns rather than reported by the
 * client, so a remote character can never be made to play an animation its
 * actual movement does not justify. Presentation, but presentation the server
 * is the source of.
 */
const resolveAnimation = (player: PlayerState): BroomAnimationState => {
  /*
   * THRUST WINS, and it wins first.
   *
   * A broom under thrust is the ascending pose whatever else is true of it -
   * grounded, hovering, already climbing - because that pose is the only
   * on-screen statement that the meter is being spent. Deciding it after the
   * grounded test is what would leave a broom lifting off the floor drawn flat
   * for the first frames of every takeoff, which is exactly the moment the
   * player is looking for confirmation that the key did something.
   */
  if (player.flying) return BroomAnimationState.Ascending;
  // A player on a belt is travelling nowhere but is very much flying, so the
  // replicated state has to say so - reporting `idle` would be the one field
  // on the wire that disagrees with what everybody can see.
  if (player.treadmill > 0) return BroomAnimationState.Cruise;
  if (!player.grounded) return BroomAnimationState.Airborne;
  const hoverThreshold = 0.6;
  if (player.speed < hoverThreshold) return BroomAnimationState.Idle;
  // The cruise threshold scales with the player's own authoritative speed, so
  // a level-80 mount is not permanently "hovering" at eighty units a second.
  return player.speed > player.moveMultiplier * 16
    ? BroomAnimationState.Cruise
    : BroomAnimationState.Hover;
};
