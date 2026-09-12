/**
 * The palette: a dark magical dungeon.
 *
 * COLOUR ONLY. Every world coordinate lives in `@broom/shared`'s course
 * config, so this file re-themes the entire game without moving a single
 * collider - which is exactly what it did: the geometry vocabulary carried
 * over from the previous game and only these numbers changed.
 *
 * The look is still toy-brick - flat saturated colour, clean silhouettes, no
 * PBR and no image files - but the key is dark: cold stone, black iron, and
 * ARCANE VIOLET as the one accent, used for everything enchanted. Light comes
 * from three sources and only three, so the dungeon reads as lit rather than
 * merely tinted: lava below, torches and braziers on the walls, and the
 * conjured rune platforms the player lands on.
 *
 * Every texture is drawn on a canvas at runtime, so the whole style costs
 * nothing against the 12 MB budget.
 */
export const PALETTE = {
  /** The flagstone dungeon floor - the single most-seen colour. */
  grass: '#3d4354',
  grassStud: '#4a5164',
  /** The vault floor: the same stone, a shade deeper so the run reads apart. */
  lobbyGrass: '#343a4a',
  lobbyGrassStud: '#414859',

  /** Cold dungeon masonry, boxing the whole course in. */
  wall: '#2a2e3c',
  wallDark: '#22262f',
  wallSpeck: 'rgba(10,8,20,0.35)',

  /** A violet rune course capping every wall - the dungeon's one accent. */
  hedge: 0x5b3d9e,
  hedgeDark: 0x3d2870,

  /** Raised stone blocks and the old timber walkways. */
  wood: '#4c3626',
  woodDark: '#3a281c',
  woodSpeck: 'rgba(12,8,4,0.45)',

  /** Full-height columns: the same masonry as the walls, a shade darker. */
  pillar: 0x343949,
  pillarTop: 0x5b3d9e,

  /**
   * The hazards. LAVENDER, all of them, and that is a promise rather than a
   * preference: in a dungeon this dark, a hazard the colour of the stone it
   * swings over is invisible until it has already hit.
   */
  hazard: 0xb3a4e6,
  hazardRim: 0x8f7ecb,

  /**
   * Spikes: iron shafts with pale tips.
   *
   * The tip is the bright part deliberately - it is the thing that has to be
   * seen from above, which in a game played on a broom is where it is always
   * seen from.
   */
  spike: 0x6b7280,
  spikeTip: 0xe2e8f0,

  /**
   * The conjured rune platforms, and everything else enchanted.
   *
   * The single most important colour in the game: this violet means "a thing
   * the magic made", and it is shared by the rune slabs, the flight meter, the
   * broom glows and the wall runes - so a player learns in the first stage
   * that violet is where they are meant to land.
   */
  rune: 0x8b5cf6,
  runeEdge: 0xd46bff,
  runeGlow: 0xb48bff,

  /** The golden trophy pad at the end of every stage. */
  winPad: '#ffb832',
  winPadAlt: '#ffe08a',

  /** Broom display stands in the shop. */
  standBase: 0x4a4463,
  standTop: 0xffd54a,
  standLocked: 0x54506b,

  /** Dead trees: a grey trunk under sparse, near-black canopy plates. */
  trunk: 0x4a3f36,
  canopyA: 0x2e3a2c,
  canopyB: 0x24301f,

  /** Weathered stone: the ruined halls, and the guardian's own grey. */
  ruin: 0x6a6480,
  ruinDark: 0x4e4a60,

  /** The VOID: the bottom of the stages that open onto nothing at all. */
  quicksand: '#1a1430',
  quicksandDark: '#0c0820',

  /** The pit floor under the whole world, so a fall has a bottom. */
  pitFloor: 0x1c1a24,

  /** The training deck, its belts and its frames. */
  deck: '#3a3142',
  deckDark: '#2c2533',
  /**
   * ONE FRAME COLOUR PER TIER, and that is what makes six machines read as
   * three ranks: bronze for the open belts, silver for level 20, gold for
   * level 75. Indexed by tier, so a fourth tier is a fourth colour here and
   * nothing else in the renderer.
   */
  treadmillTier: [0xb87333, 0xc8ccd4, 0xf6c343] as readonly number[],
  /** A machine the player has not unlocked: dark, dead, obviously not theirs. */
  treadmillLocked: 0x3a3644,
  treadmillFrameDark: 0x25212e,
  /*
   * The belt is DARK, and deliberately so. A belt the same green as the lobby
   * floor reads as a hole in the frame from the front, which is half of why
   * the first machines looked like platforms. Dark rubber under a gold frame,
   * with bright chevrons travelling over it, is what makes it a treadmill.
   */
  treadmillBelt: 0x2b3a33,
  /** The console screen: dark, so the gold frame reads as machinery. */
  treadmillScreen: 0x27323d,

  /** A platform about to sink flashes toward this. */
  sinkingWarn: 0xff6b4a,

  /* ---- The later stages -------------------------------------------------
   * Each stage past the ruins gets its own material rather than a recolour of
   * the corridor, because a twenty-stage run through one green tunnel would
   * read as one very long stage. They are all the same toy-brick treatment:
   * flat colour, a drawn texture, no PBR anywhere.
   */

  /** Frost: pale blue over dark stone, with a brighter rime. */
  ice: '#7fb4cf',
  iceStud: '#c8e8f5',

  /** Dark granite: vaults, temple masonry, the steppers over the lava. */
  stone: '#5a6070',
  stoneDark: '#434857',

  /** Hewn beams, a warmer brown than the walkways. */
  log: '#5a3d24',
  logDark: '#422c19',

  /** Black iron: crusher frames, chain hubs, gale-gallery posts. */
  metal: 0x5c626e,
  metalDark: 0x3a3f49,

  /** Lava. Bright, and the one thing in the world that emits light. */
  lava: '#ff6a1e',
  lavaDark: '#c02f08',
  /** Water, at the bottom of the cliffs. */
  water: '#3f9fe0',
  waterDark: '#2b78b4',

  /** Boulders, and the rocks that fall out of the sky. */
  rock: 0x8d8577,
  rockDark: 0x6f6a5f,

  /** A torch flame, and the tornado funnels. */
  flame: 0xffb32e,
  tornado: 0xcfd8e4,

  /** The warning patch under something that is about to land on you. */
  impactWarn: 0x2a2f36,

  /* ---- The scoreboards on the spawn wall --------------------------------
   * Lit stone tablets, not screens. The previous game's boards were a pale
   * panel in a lavender frame, which in a room this dark came out as three
   * slabs of near-white filling the whole back wall and the brightest thing in
   * the game by a distance. Dark slate with light text says the same figures
   * and belongs to the dungeon around it.
   *
   * The panel is DARK, so the text on it has to be light and its outline dark
   * - which is the opposite way round from every other sign in this game, and
   * the reason `boardInk` is used as the header's stroke rather than white.
   */
  boardFrame: 0x4a4463,
  boardFrameDark: 0x332e47,
  boardPanel: '#232036',
  boardPanelEdge: '#3d3757',
  boardStripe: 'rgba(180, 139, 255, 0.10)',
  /** Dark ink, for the outline under every light glyph on the board. */
  boardInk: '#100d1c',
  boardHeading: '#c9b6ff',
  boardName: '#ffffff',
  boardValue: '#ffd53d',

  /**
   * The cavern "sky", and the fog matched to its band just above the horizon.
   *
   * Not a sky at all any more - it is the far dark of a dungeon - but it is
   * still a gradient dome and the fog still has to match its lower band, or
   * the world ends in a visible seam. Dark violet rather than black: a pure
   * black distance makes everything in front of it read as a cut-out.
   */
  sky: 0x1a1430,
  fog: 0x2a2247,
  /** Banks of cave mist. Two tones, so a bank has a lit top and a dark base. */
  cloud: 0x3a3358,
  cloudShade: 0x241f3d,
} as const;

/**
 * Fog band.
 *
 * Pulled CLOSER than the previous game's, and deliberately: a dungeon that
 * could be seen to the end of would not be a dungeon, and the near band is
 * what makes the next platform emerging out of the dark the thing the player
 * is looking for. Still far enough back that a late-game broom at three
 * hundred units a second is never riding into a wall it could not see.
 */
export const WORLD_FOG = {
  near: 150,
  far: 620,
} as const;

/** How far apart the dead trees stand along the corridor. */
export const SCENERY = {
  /** Distance between clusters along Z. */
  treeSpacingZ: 44,
  /** How far outside the corridor they sit. */
  treeOffsetX: 19,
  /** Trunk height range. */
  trunkMin: 7,
  trunkMax: 12,
} as const;

/**
 * Yaw correction for the supplied player FBX.
 *
 * player.fbx already faces +Z; the offset exists so a re-authored model can be
 * corrected without touching gameplay code.
 */
export const PLAYER_MODEL_YAW_OFFSET = 0;
