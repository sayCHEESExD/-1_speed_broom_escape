/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'broomobby';

/**
 * Default server port. Override with the PORT env var on the server.
 *
 * Deliberately NOT 2567: that is the Colyseus default and the previous game in
 * this series already answers on it, so sharing it would mean whichever server
 * started first silently served both clients.
 */
export const DEFAULT_SERVER_PORT = 2569;

/**
 * Most players in ONE room.
 *
 * The matchmaker locks a room at this figure and opens another, so a
 * sixteenth player gets a new room rather than a refusal - which is what
 * "routed, not rejected" means here.
 *
 * It lives in `shared/` because it is a fact about the world both halves have
 * to agree on: the server enforces it, and anything the client ever shows
 * about how full a room is has to be the same number or it is lying.
 */
export const MAX_PLAYERS_PER_ROOM = 15;

/**
 * The game's slug on the Bloxity PORTAL - `bloxity.io/v1/games` lists this
 * game as `slug: "speed-broom"`.
 *
 * NOT the Legion HOSTING id. That one is `speed-broom-escape` - the
 * `BLOXITY_GAME_ID` Legion injects, the deploy workflow's app id and the play
 * URL - and it is a different identifier. The portal issues each player's game
 * token for ITS slug (`POST /v1/auth/game-token { gameSlug: "speed-broom" }`)
 * and Bloxity's verify rejects a token checked against any other. Verifying
 * against the hosting id refused EVERY signed-in player, so every account was
 * saved per browser and progress never followed a player between devices.
 *
 * In `shared` because both halves need it and must agree: the client passes it
 * to `Legion.SDK.init` (the Bux catalogue, and a standalone login's token), the
 * server to Bloxity's token verify. Deliberately NOT overridable from the
 * hosting environment, which only knows the hosting id.
 */
export const BLOXITY_GAME_SLUG = 'speed-broom';

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/**
 * Client->server and server->client message identifiers.
 *
 * A const object rather than an enum so it survives `verbatimModuleSyntax` and
 * erases cleanly in both build pipelines.
 */
export const MessageType = {
  /** Client -> server: one frame of INPUT. Never a transform. */
  Move: 'move',
  /** Server -> client: authoritative respawn instruction. */
  Respawn: 'respawn',
  /** Client -> server: "I think I finished a stage." A request, never a grant. */
  ClaimStage: 'claimStage',
  /** Client -> server: "I am standing on this broom's stand, claim it." */
  ClaimBroom: 'claimBroom',
  /** Client -> server: "put me back at the starting arena". */
  RequestRespawn: 'requestRespawn',
  /** Server -> client: a stage reward was granted. Drives the celebration. */
  StageAwarded: 'stageAwarded',
  /**
   * Client -> server: "rebirth me".
   *
   * Carries nothing: the server already knows the player's level and rebirth
   * count, and it is the only thing allowed to decide whether the requirement
   * is met.
   */
  Rebirth: 'rebirth',
  /** Client -> server: buy the trail in this slot. */
  BuyTrail: 'buyTrail',
  /** Client -> server: wear an OWNED trail, or 0 to take it off. */
  EquipTrail: 'equipTrail',
  /**
   * Client -> server: "I am now signed in to Bloxity as the holder of THIS
   * token" - or, with an empty token, "I have signed out".
   *
   * Carries the portal's JWT and NEVER an account id. An id is not a secret -
   * the friends list hands them out - so a room that believed one would let
   * anybody collect somebody else's Bux purchases. The server verifies the
   * token with Bloxity itself and takes the account id from that answer.
   *
   * Sent on every login and logout mid-session. The join carries the same
   * token, so a player already signed in when they connect needs no message.
   */
  SetIdentity: 'setIdentity',
  /**
   * Server -> client: "from now on, this browser's guest id is THIS".
   *
   * Sent when the browser's old guest profile has been MIGRATED into an
   * account. That copy is kept as a recovery copy and never restored, so a new
   * guest session needs a new id - or its progress would be saved over the
   * recovery copy, and never loaded again either.
   */
  GuestId: 'guestId',
  /**
   * Client -> server: "this is what my Bloxity avatar looks like".
   *
   * The one message whose content the server stores rather than judges, and it
   * can be because it decides nothing: the portal owns a player's appearance
   * and the server has no way to ask it, so the client is the only source
   * there is. It is sanitised on arrival and it never touches progression.
   */
  SetAvatar: 'setAvatar',
  /**
   * Client -> server: "while I am signed OUT, Bloxity calls me THIS".
   *
   * The guest identity Bloxity's SDK mints in the browser - a name like
   * "Comet42" and a picture of the guest's avatar - which is the only place a
   * guest's name exists. Ignored for a signed-in player, whose name and
   * picture the server takes from Bloxity's own verify reply instead. Checked
   * on arrival: the name must be guest-shaped and the picture must be on
   * Bloxity's thumbnail CDN (see `shared/src/config/playerNames.ts`).
   */
  SetGuestProfile: 'setGuestProfile',
  /**
   * Client -> server: "the Bloxity SDK says the signed-in account `accountId`
   * is called THIS" - the SDK's own user record (`displayName`, else
   * `username`, and `pfp`), which is what the portal shows the player.
   * Shown ONLY while the session is VERIFIED as that same account: the id here
   * is a matching key for a cosmetic name, never trusted to identify anyone.
   */
  SetAccountProfile: 'setAccountProfile',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
