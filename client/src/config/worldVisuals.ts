/**
 * The palette: a BRIGHT magical dungeon.
 *
 * COLOUR ONLY. Every world coordinate lives in `@broom/shared`'s course
 * config, so this file re-themes the entire game without moving a single
 * collider.
 *
 * The look is toy-brick - flat saturated colour, clean silhouettes, no PBR
 * and no image files - and the key is LIGHT: pale blue-violet stone, warm
 * timber, gold trim, and glowing crystals, runes and lava everywhere. It is
 * still a dungeon - masonry walls, a roof, torches, pits - but it is a
 * dungeon in a bright Roblox game, not a horror game. Dark values survive
 * only as ACCENTS (a belt, a scoreboard panel, a locked machine), never as
 * the colour of a surface the player has to read.
 *
 * The per-stage identity lives in `THEMES` / `STAGE_THEMES` below; this table
 * is what every stage shares.
 *
 * Every texture is drawn on a canvas at runtime, so the whole style costs
 * nothing against the 12 MB budget.
 */
export const PALETTE = {
  /** The flagstone floor - overridden per stage by its theme; the fallback. */
  grass: '#9aa7cf',
  grassStud: '#b4c0e6',
  /** The vault floor: pale lavender flagstone, the brightest floor in the game. */
  lobbyGrass: '#c6bdee',
  lobbyGrassStud: '#ddd6fa',

  /** Masonry - the fallback; every stage's walls come from its theme. */
  wall: '#7d88b8',
  wallDark: '#626c9a',
  wallSpeck: 'rgba(40,30,90,0.16)',

  /** The course capping every wall - the fallback; themed per stage. */
  hedge: 0xffc93c,
  hedgeDark: 0xd99a1c,

  /** Raised blocks and the timber walkways: warm, bright, polished wood. */
  wood: '#d49a5a',
  woodDark: '#a8703a',
  woodSpeck: 'rgba(110,60,20,0.22)',

  /** Full-height columns - themed per stage; the fallback. */
  pillar: 0x8f9ad0,
  pillarTop: 0xffc93c,

  /**
   * The hazards. LAVENDER, all of them, and that is a promise rather than a
   * preference: lavender means "this is moving and it will end your run". In
   * a bright world it also GLOWS (`hazardGlow`), so a bar sweeping over pale
   * stone is never lost against it.
   */
  hazard: 0xc4a8ff,
  hazardRim: 0x9b7bff,
  hazardGlow: 0x8a5cff,

  /**
   * Spikes: polished steel shafts with GLOWING gold tips.
   *
   * The tip is the bright part deliberately - it is the thing that has to be
   * seen from above, which in a game played on a broom is where it is always
   * seen from.
   */
  spike: 0x6f7fa6,
  spikeTip: 0xffe45c,

  /**
   * The conjured rune platforms, and everything else enchanted.
   *
   * The single most important colour in the game: this violet means "a thing
   * the magic made", and it is shared by the rune slabs, the flight meter, the
   * broom glows and the wall runes - so a player learns in the first stage
   * that violet is where they are meant to land.
   */
  rune: 0x8b5cf6,
  runeEdge: 0xe38bff,
  runeGlow: 0xb48bff,

  /** The golden trophy pad at the end of every stage. */
  winPad: '#ffb832',
  winPadAlt: '#ffe08a',

  /** Broom display stands in the shop: royal purple under gold. */
  standBase: 0x7a52e0,
  standTop: 0xffd54a,
  standLocked: 0xa79fd6,

  /** Enchanted trees: pale bark under teal crystal-leaf plates. */
  trunk: 0x9a7456,
  canopyA: 0x4fd6c4,
  /**
   * The false floors of the chain gallery are LEAVES, and must read as leaves:
   * a bright living green that no platform in the game shares.
   */
  canopyB: 0x6fd35a,

  /** Weathered stone: the ruined halls, pale and warm. */
  ruin: 0xbdb3e2,
  ruinDark: 0x998fc8,

  /**
   * The VOID: the bottom of the stages that open onto nothing at all. A deep
   * starry indigo with bright magic specks - still unmistakably "do not fall",
   * but a colour rather than a hole.
   */
  quicksand: '#2c2a86',
  quicksandDark: '#6f7bff',

  /** The pit floor under the whole world, so a fall has a bottom. */
  pitFloor: 0x4a4494,

  /** The training deck: bright cyan boards, the colour of the right side. */
  deck: '#4cc6e6',
  deckDark: '#2f9fc4',
  /**
   * ONE FRAME COLOUR PER TIER, and that is what makes six machines read as
   * three ranks: bronze for the open belts, silver for level 20, gold for
   * level 75. Indexed by tier, so a fourth tier is a fourth colour here and
   * nothing else in the renderer.
   */
  treadmillTier: [0xe0873a, 0xdfe6f2, 0xffc93c] as readonly number[],
  /** A machine the player has not unlocked: visibly dark and dead. */
  treadmillLocked: 0x55526e,
  treadmillFrameDark: 0x3b3a58,
  /*
   * The belt is DARK, and deliberately so - one of the few dark accents left.
   * Dark rubber under a bright frame, with glowing chevrons travelling over
   * it, is what makes it read as a machine rather than as a platform.
   */
  treadmillBelt: 0x2d3458,
  /** The console screen: dark, so its glow reads as a lit display. */
  treadmillScreen: 0x27323d,

  /** A platform about to sink flashes toward this. */
  sinkingWarn: 0xff6b4a,

  /** Frost: bright ice blue with white rime. */
  ice: '#9fe3ff',
  iceStud: '#e8f9ff',

  /** Granite - the fallback; every stage's stone comes from its theme. */
  stone: '#a9b3d6',
  stoneDark: '#8390bd',

  /** Hewn beams, a warmer brown than the walkways. */
  log: '#c07c42',
  logDark: '#94592a',

  /** Polished steel: crusher frames, chain hubs, gale-gallery posts. */
  metal: 0xa9b8d6,
  metalDark: 0x7584a8,

  /** Lava. Vivid, bright, and it glows. */
  lava: '#ff7a1a',
  lavaDark: '#ffcf3a',
  lavaGlow: 0xff5a0a,
  /** Water, at the bottom of the cliffs. */
  water: '#46c2ff',
  waterDark: '#8fe0ff',

  /** Boulders, and the rocks that fall out of the sky. */
  rock: 0xc2b39c,
  rockDark: 0x9d8f7a,

  /** A torch flame, and the tornado funnels. */
  flame: 0xff9a1f,
  /** The white-hot heart of every flame. */
  flameCore: 0xfff27a,
  /** Brazier bodies: gold, so a lamp in a bright hall reads as a lamp. */
  brazier: 0xf2b93b,
  tornado: 0xe6f4ff,

  /** The warning patch under something that is about to land on you. */
  impactWarn: 0x2a1f4a,

  /* ---- The scoreboards on the spawn wall --------------------------------
   * Gold-framed tablets with a deep navy face. The PANEL stays dark because
   * the figures on it are light and have to be read across the vault - it is
   * one of the dark accents this palette keeps on purpose. The frame is gold,
   * so the boards belong to the bright lobby around them.
   */
  boardFrame: 0xf2b93b,
  boardFrameDark: 0xc0851c,
  boardPanel: '#262a62',
  boardPanelEdge: '#5360c8',
  boardStripe: 'rgba(180, 200, 255, 0.10)',
  /** Dark ink, for the outline under every light glyph on the board. */
  boardInk: '#100d2c',
  boardHeading: '#c9d6ff',
  boardName: '#ffffff',
  boardValue: '#ffd53d',

  /**
   * The cavern sky: a luminous blue-to-lavender dome, and the fog matched to
   * its band just above the horizon so the world ends without a seam. Light,
   * so distance reads as AIR rather than as darkness.
   */
  skyTop: 0x6a95f5,
  sky: 0x9a8cf2,
  fog: 0xa6b2f2,
  /** Banks of magic mist. Two tones, so a bank has a lit top and a shaded base. */
  cloud: 0xfaf6ff,
  cloudShade: 0xd6ccf5,
} as const;

/**
 * One stage's look.
 *
 * Six of these, not thirty: a theme is a PLACE ("the lava chambers"), and a
 * place a player recognises on its second appearance is worth more than
 * thirty one-offs. Each carries its surfaces (floor, walls, stone, the wall
 * cap) and its MAGIC - the colour its crystals, runes, banners and motes
 * glow in - which is most of what makes a section feel like somewhere.
 */
export interface StageTheme {
  readonly name: string;
  readonly floor: string;
  readonly floorStud: string;
  readonly wall: string;
  readonly wallDark: string;
  /** The course along the top of each wall, and the trim on its banners. */
  readonly cap: number;
  readonly stone: string;
  readonly stoneDark: string;
  /** Banner cloth. */
  readonly banner: number;
  /** The glow: crystals, wall runes, halos and the drifting motes. */
  readonly glow: number;
  /** A second glow, so a crystal cluster is never one flat colour. */
  readonly glowAlt: number;
}

export const THEMES = {
  /** Pale blue-violet masonry, gold trim, cyan magic. The house style. */
  enchanted: {
    name: 'Enchanted Stone',
    floor: '#a4b4ee',
    floorStud: '#c3cefa',
    wall: '#8e9ee8',
    wallDark: '#7485d0',
    cap: 0xffc93c,
    stone: '#b6c2f0',
    stoneDark: '#8e9de0',
    banner: 0x3d6fff,
    glow: 0x5ef2ff,
    glowAlt: 0xb48bff,
  },
  /** Teal-blue cave rock hung with pink and cyan crystal. */
  crystal: {
    name: 'Crystal Cave',
    floor: '#86d3ea',
    floorStud: '#b0ecf8',
    wall: '#5aa6d6',
    wallDark: '#468cc0',
    cap: 0x5ff3ff,
    stone: '#9be0f0',
    stoneDark: '#6cbcd8',
    banner: 0xff5fcf,
    glow: 0xff7ae0,
    glowAlt: 0x5ff3ff,
  },
  /** Warm sandstone over the lava, red banners and orange light. */
  lava: {
    name: 'Lava Chamber',
    floor: '#f0b48a',
    floorStud: '#ffd0a6',
    wall: '#e08a66',
    wallDark: '#c06e4c',
    cap: 0xff8a1f,
    stone: '#f5c298',
    stoneDark: '#d8996c',
    banner: 0xe8322a,
    glow: 0xffa12e,
    glowAlt: 0xffe05a,
  },
  /** White marble and sky blue: the bridges between the halls. */
  bridge: {
    name: 'Sky Bridges',
    floor: '#e8e6fb',
    floorStud: '#f8f6ff',
    wall: '#aec2f6',
    wallDark: '#8fa6e8',
    cap: 0xffd54a,
    stone: '#dce3fb',
    stoneDark: '#b3c0ee',
    banner: 0x22c49c,
    glow: 0x7cf0ff,
    glowAlt: 0xffe066,
  },
  /**
   * Indigo walls around periwinkle floors, magenta runes and gold banners.
   * The floors lean BLUE on purpose: the rune slabs are violet, and a violet
   * floor would hide the one colour that says "land here".
   */
  tower: {
    name: 'Rune Tower',
    floor: '#97acf2',
    floorStud: '#b6c5fa',
    wall: '#6e63d8',
    wallDark: '#5a4fc0',
    cap: 0xff5fd2,
    stone: '#a9baf6',
    stoneDark: '#8196e4',
    banner: 0xffb81f,
    glow: 0xff66e0,
    glowAlt: 0x7cc8ff,
  },
  /** Mint stone and spring light: the isles floating over the void. */
  floating: {
    name: 'Floating Isles',
    floor: '#a6e8bd',
    floorStud: '#c8f5d6',
    wall: '#6fc4aa',
    wallDark: '#56a98f',
    cap: 0xffe066,
    stone: '#bdf0cc',
    stoneDark: '#8fd4a8',
    banner: 0x8b5cf6,
    glow: 0x9dff7a,
    glowAlt: 0xffe066,
  },
  /** The starting vault: pale lavender, gold, cyan and purple. */
  vault: {
    name: 'Vault',
    floor: PALETTE.lobbyGrass,
    floorStud: PALETTE.lobbyGrassStud,
    wall: '#a296ec',
    wallDark: '#8578d6',
    cap: 0xffc93c,
    stone: '#c9c2ec',
    stoneDark: '#a79fd6',
    banner: 0x7a3fe4,
    glow: 0x5ef2ff,
    glowAlt: 0xffd54a,
  },
} as const satisfies Record<string, StageTheme>;

export type ThemeName = keyof typeof THEMES;

/**
 * Which theme each stage wears, by 1-based stage index (entry 0 is stage 1).
 *
 * Chosen to fit what each stage is BUILT from rather than rotated blindly:
 * the stages over lava are lava chambers, the frost ledges are a crystal cave,
 * the spire and the rune maze are the tower. A stage past the end of the list
 * wraps, so a thirty-first stage is themed without anybody editing this.
 */
export const STAGE_THEMES: readonly ThemeName[] = [
  'enchanted', // 1  Escape
  'enchanted', // 2  Spike Vault
  'lava', //      3  Crypt Slabs
  'crystal', //   4  Chain Gallery
  'enchanted', // 5  Guardian Vault
  'floating', //  6  The Chasm
  'lava', //      7  Pillar Climb
  'bridge', //    8  Crusher Span
  'lava', //      9  Lava Steppers
  'crystal', //   10 Frost Ledges
  'floating', //  11 Gale Gallery
  'tower', //     12 Spire Ascent
  'tower', //     13 Rune Maze
  'bridge', //    14 Bone Bridge
  'enchanted', // 15 Catacombs
  'crystal', //   16 Drowned Halls
  'tower', //     17 Hex Storm
  'tower', //     18 Black Temple
  'lava', //      19 Ember Run
  'bridge', //    20 Warden Hall
  'floating', //  21 Shadow Span
  'lava', //      22 Bone Valley
  'floating', //  23 Floating Crypts
  'lava', //      24 Lava Fortress
  'floating', //  25 Thornwood Deep
  'crystal', //   26 Frozen Crypt
  'enchanted', // 27 Grand Sanctum
  'tower', //     28 Hex Tempest
  'lava', //      29 Final Descent
  'tower', //     30 Dark Summit
];

/** The theme a 1-based stage index wears; 0 (or less) is the vault. */
export const themeNameForStage = (index: number): ThemeName =>
  index <= 0 ? 'vault' : (STAGE_THEMES[(index - 1) % STAGE_THEMES.length] as ThemeName);

/**
 * Fog band.
 *
 * Far enough back that the stage in front of the player is clearly visible -
 * the whole point of the bright look is that a player can READ the course -
 * but still present, because a light haze is what gives a long dungeon its
 * depth. A late-game broom at three hundred units a second is never riding
 * into something it could not see.
 */
export const WORLD_FOG = {
  near: 220,
  far: 820,
} as const;

/** How far apart the scenery trees stand along the corridor. */
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
