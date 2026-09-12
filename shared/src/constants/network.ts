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
   * Client -> server: "this is what my Bloxity avatar looks like".
   *
   * The one message whose content the server stores rather than judges, and it
   * can be because it decides nothing: the portal owns a player's appearance
   * and the server has no way to ask it, so the client is the only source
   * there is. It is sanitised on arrival and it never touches progression.
   */
  SetAvatar: 'setAvatar',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
