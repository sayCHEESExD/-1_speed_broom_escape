import {
  COURSE,
  COURSE_END_Z,
  COURSE_SOLIDS,
  DECORATIONS,
  QUICKSAND,
  SPAWN_POSITION,
  STAGES,
  STAND_ROW,
  TRAINING,
  WIDE_AREAS,
  corridorHalfWidthAt,
} from '@broom/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector2,
  type Material,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, THEMES, WORLD_FOG, type StageTheme } from '../config/worldVisuals.js';
import { themeAt } from './themeAt.js';

/**
 * The magic hung on the dungeon: banners, glowing wall runes, crystal clusters
 * along the wall tops, the halo round every light, the motes drifting through
 * the air, and the vault's carpets, spawn ring and entrance.
 *
 * PURE SCENERY, and deliberately placed where scenery cannot lie about the
 * course: on the FACE of a wall (never more than a finger's depth into the
 * corridor), on TOP of a wall (outside the corridor entirely), or flat on the
 * floor. Nothing here is in `COURSE_SOLIDS`, and nothing here stands in the
 * air a broom flies through looking like something it could land on or hit.
 * The one exception - the motes - is too small and too obviously light to be
 * mistaken for anything solid.
 *
 * Cheap on purpose. Everything is merged: one mesh for the lit cloth and
 * trim, one for the unlit glow, one for the crystals, one POINTS draw for
 * every halo in the world and one for every mote - so the entire layer is a
 * handful of draw calls however long the course grows. Colour lives in the
 * vertices, and nothing here is a real light: a light is a per-pixel cost on
 * every material in the world, and a halo sprite reads the same.
 */

/** Top of every corridor wall. */
const WALL_TOP = COURSE.wallHeight - COURSE.floorThickness;

/** How far along a stage between one pair of banners and the next. */
const BANNER_SPACING = 52;

/** How far along a stage between one wall-top crystal cluster and the next. */
const CRYSTAL_SPACING = 38;

/** Motes across the whole world. Only the ones near the camera are ever seen. */
const MOTE_COUNT = 6500;

/** Halo spacing across a lava pool's surface. */
const LAVA_HALO_STEP = 17;

/** Keep wall dressing this far from a change in corridor width. */
const WIDTH_STEP_CLEARANCE = 8;

export class DungeonDressing {
  readonly root = new Group();

  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly pointMaterials: ShaderMaterial[] = [];

  /** Lit cloth, rods and trim. */
  private readonly lit: BufferGeometry[] = [];
  /** Unlit glow: runes, emblems, edge lights. */
  private readonly glow: BufferGeometry[] = [];
  /** Faceted crystals. Octahedra, so they merge separately from the boxes. */
  private readonly crystals: BufferGeometry[] = [];

  private readonly halos = new PointSet();
  private readonly motes = new PointSet();

  /** Every wall-width change, so wall dressing keeps clear of the steps. */
  private readonly widthSteps: number[] = WIDE_AREAS.flatMap((area) => [area.minZ, area.maxZ]);

  constructor() {
    for (const stage of STAGES) this.dressStage(stage.startZ, stage.endZ, themeAt(stage.startZ + 1));
    this.dressVault();
    this.haloDecorations();
    this.haloLava();
    this.scatterMotes();

    this.addMerged(this.lit, new MeshLambertMaterial({ vertexColors: true }));
    this.addMerged(this.glow, new MeshBasicMaterial({ vertexColors: true }));
    this.addMerged(this.crystals, new MeshBasicMaterial({ vertexColors: true }));

    this.addPoints(this.halos, 0);
    this.addPoints(this.motes, 1);
  }

  /** @param elapsed the replicated clock, so every client's motes drift alike. */
  update(elapsed: number): void {
    for (const material of this.pointMaterials) {
      (material.uniforms['time'] as { value: number }).value = elapsed;
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const material of this.pointMaterials) material.dispose();
    this.root.removeFromParent();
  }

  /* ------------------------------------------------------------ stages -- */

  private dressStage(startZ: number, endZ: number, theme: StageTheme): void {
    // Banners, in pairs across the corridor, with a violet wall rune halfway
    // between each pair and the next.
    for (let z = startZ + BANNER_SPACING / 2; z < endZ - 16; z += BANNER_SPACING) {
      if (this.nearWidthStep(z, 5)) continue;
      const half = corridorHalfWidthAt(z);
      for (const side of [-1, 1] as const) this.banner(side, half, z, theme);

      const runeZ = z + BANNER_SPACING / 2;
      if (runeZ < endZ - 16 && !this.nearWidthStep(runeZ, 3)) {
        const runeHalf = corridorHalfWidthAt(runeZ);
        for (const side of [-1, 1] as const) this.wallRune(side, runeHalf, runeZ);
      }
    }

    // Crystal clusters along the wall tops, staggered side to side.
    let flip = 0;
    for (let z = startZ + 12; z < endZ - 6; z += CRYSTAL_SPACING) {
      flip += 1;
      if (this.nearWidthStep(z, 6)) continue;
      const side = flip % 2 === 0 ? 1 : -1;
      this.crystalCluster(side * (corridorHalfWidthAt(z) + 2.5), WALL_TOP + 1.8, z, theme, flip);
    }
  }

  /**
   * A hanging banner on a wall's inner face: rod, cloth, swallowtail, a trim
   * band and a glowing diamond emblem. Nothing sits deeper than 0.35 into the
   * corridor.
   */
  private banner(side: -1 | 1, half: number, z: number, theme: StageTheme, top = 23.4): void {
    const face = side * half;
    const inset = (depth: number): number => face - side * depth;
    const clothH = 9.6;
    const clothY = top - 0.6 - clothH / 2;

    this.lit.push(box(0.5, 0.5, 5.4, inset(0.25), top, z, theme.cap));
    this.lit.push(box(0.2, clothH, 4.4, inset(0.14), clothY, z, theme.banner));
    // The swallowtail: two tongues under the cloth.
    for (const dz of [-1.45, 1.45]) {
      this.lit.push(box(0.2, 1.5, 1.5, inset(0.14), clothY - clothH / 2 - 0.75, z + dz, theme.banner));
    }
    // A gold band near the top and the emblem, which glows.
    this.lit.push(box(0.24, 0.55, 4.44, inset(0.16), top - 2.1, z, theme.cap));
    this.glow.push(box(0.26, 1.9, 1.9, inset(0.18), clothY - 0.4, z, theme.glow, Math.PI / 4));
  }

  /**
   * A glowing rune carved into the masonry: a square frame, a stroke through
   * it and a diamond - VIOLET everywhere, because violet is what the magic
   * made, and a player learns that on the rune slabs.
   */
  private wallRune(side: -1 | 1, half: number, z: number): void {
    const x = side * (half - 0.1);
    const y = 16.5;
    const s = 3.4;
    const t = 0.32;
    const colour = PALETTE.runeEdge;
    this.glow.push(box(0.14, t, s, x, y + s / 2, z, colour));
    this.glow.push(box(0.14, t, s, x, y - s / 2, z, colour));
    this.glow.push(box(0.14, s, t, x, y, z - s / 2, colour));
    this.glow.push(box(0.14, s, t, x, y, z + s / 2, colour));
    this.glow.push(box(0.16, s * 0.72, t, x, y, z, colour));
    this.glow.push(box(0.18, 1.1, 1.1, x, y, z, PALETTE.runeGlow, Math.PI / 4));
    this.halos.add(x - side * 0.8, y, z, PALETTE.runeGlow, 9, 0.55);
  }

  /** A cluster of faceted crystals, and the halo that says they are lit. */
  private crystalCluster(x: number, y: number, z: number, theme: StageTheme, seed: number): void {
    const shards = [
      { dx: 0, dz: 0, h: 4.4, r: 0.95, tilt: 0 },
      { dx: 0.9, dz: 0.8, h: 2.8, r: 0.7, tilt: 0.35 },
      { dx: -0.8, dz: -0.7, h: 3.2, r: 0.75, tilt: -0.3 },
      { dx: -0.6, dz: 1.0, h: 2.0, r: 0.55, tilt: 0.5 },
    ];
    shards.forEach((shard, index) => {
      const colour = (index + seed) % 2 === 0 ? theme.glow : theme.glowAlt;
      this.crystals.push(
        crystal(shard.r, shard.h, x + shard.dx, y + shard.h / 2 - 0.3, z + shard.dz, colour, shard.tilt, seed + index),
      );
    });
    this.halos.add(x, y + 2.4, z, theme.glow, 16, 0.6);
  }

  /* ------------------------------------------------------------- vault -- */

  /**
   * The starting vault: a lobby, not a dungeon room.
   *
   * The two halves are told apart by colour before anything else: PURPLE and
   * gold down the broom shop on the player's left (+X), CYAN down the training
   * hall on the right (-X), and a royal-blue runner between them from the
   * spawn to the way out.
   */
  private dressVault(): void {
    const vault = THEMES.vault;
    const lobbyHalf = COURSE.lobbyHalfWidth;
    const backZ = COURSE.lobbyStartZ;
    const exitZ = COURSE.lobbyEndZ;
    const gold = 0xffc93c;
    const cyan = 0x4fe3ff;
    const purple = 0x7a3fe4;

    // Carpets, a whisker proud of the floor - nothing stands or trips on them.
    const carpet = (minX: number, maxX: number, minZ: number, maxZ: number, cloth: number, trim: number): void => {
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const w = maxX - minX;
      const d = maxZ - minZ;
      this.lit.push(box(w, 0.05, d, cx, 0.025, cz, trim));
      this.lit.push(box(w - 1.4, 0.07, d - 1.4, cx, 0.035, cz, cloth));
    };
    // The shop runner, under the stands.
    const standMinZ = STAND_ROW.firstZ - STAND_ROW.length / 2 - 4;
    carpet(STAND_ROW.x - 8, STAND_ROW.x + 8, standMinZ, exitZ - 3, purple, gold);
    // The centre aisle, spawn to exit.
    carpet(-5.5, 5.5, backZ + 16, exitZ - 3, 0x2f5fe0, gold);

    // The spawn: two glowing rings on the floor.
    this.spawnRing(SPAWN_POSITION.x, SPAWN_POSITION.z, cyan, gold);

    // Glowing cyan edge-light round the training deck.
    const deckTop = TRAINING.deckY + 0.03;
    const dx = TRAINING.maxX - TRAINING.minX;
    const dz = TRAINING.maxZ - TRAINING.minZ;
    const mx = (TRAINING.minX + TRAINING.maxX) / 2;
    const mz = (TRAINING.minZ + TRAINING.maxZ) / 2;
    this.glow.push(box(dx, 0.06, 0.4, mx, deckTop, TRAINING.minZ + 0.2, cyan));
    this.glow.push(box(dx, 0.06, 0.4, mx, deckTop, TRAINING.maxZ - 0.2, cyan));
    this.glow.push(box(0.4, 0.06, dz, TRAINING.minX + 0.2, deckTop, mz, cyan));
    this.glow.push(box(0.4, 0.06, dz, TRAINING.maxX - 0.2, deckTop, mz, cyan));

    // Banners down both side walls: the shop's purple on the left (+X), the
    // training hall's cyan on the right (-X). The back wall is left for the
    // scoreboards, as it always has been.
    const shopSide: StageTheme = { ...vault, banner: purple, cap: gold, glow: 0xffd54a };
    const trainSide: StageTheme = { ...vault, banner: 0x1fb6e0, cap: 0xe8f1ff, glow: 0xffffff };
    for (let z = backZ + 14; z < exitZ - 8; z += 16) {
      this.banner(1, lobbyHalf, z, shopSide, 24);
      this.banner(-1, lobbyHalf, z, trainSide, 24);
    }

    // Crystals along the vault's wall tops, gold on the shop side, cyan on
    // the training side.
    let seed = 0;
    for (let z = backZ + 8; z < exitZ - 4; z += 20) {
      seed += 1;
      this.crystalCluster(lobbyHalf + 2.5, WALL_TOP + 1.8, z, { ...vault, glow: 0xffd54a, glowAlt: 0xff9ae8 }, seed);
      this.crystalCluster(-lobbyHalf - 2.5, WALL_TOP + 1.8, z, { ...vault, glow: cyan, glowAlt: 0xb48bff }, seed);
    }

    this.entrance(exitZ, gold, cyan);
  }

  /** Two concentric rings of light on the floor where every player appears. */
  private spawnRing(x: number, z: number, outer: number, inner: number): void {
    const rings: [number, number, number][] = [
      [3.4, 4.1, outer],
      [2.3, 2.6, inner],
    ];
    for (const [from, to, colour] of rings) {
      const geometry = new RingGeometry(from, to, 48);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(x, 0.08, z);
      const material = new MeshBasicMaterial({ color: colour, side: DoubleSide });
      this.materials.push(material);
      this.geometries.push(geometry);
      this.root.add(new Mesh(geometry, material));
    }
    this.halos.add(x, 0.8, z, outer, 14, 0.45);
  }

  /**
   * The way out of the vault into stage one: gold pilasters on the shoulder
   * wall either side of the corridor mouth, each with a cyan light strip and
   * a crystal crown standing on the wall top. On the wall's face only - the
   * mouth itself is left completely open.
   */
  private entrance(exitZ: number, gold: number, cyan: number): void {
    const corridorHalf = COURSE.halfWidth;
    // The shoulder wall occupies exitZ-5..exitZ; its vault face is exitZ-5.
    const faceZ = exitZ - 5;
    for (const side of [-1, 1] as const) {
      const x = side * (corridorHalf + 2.2);
      this.lit.push(box(4.2, WALL_TOP, 0.9, x, WALL_TOP / 2, faceZ - 0.45, gold));
      this.lit.push(box(5.2, 1.4, 1.3, x, WALL_TOP - 0.7, faceZ - 0.65, gold));
      this.lit.push(box(5.2, 1.4, 1.3, x, 0.7, faceZ - 0.65, gold));
      this.glow.push(box(0.8, WALL_TOP - 4, 0.2, x, WALL_TOP / 2, faceZ - 1, cyan));
      this.crystalCluster(x, WALL_TOP + 1.8, faceZ + 2.5, { ...THEMES.vault, glow: cyan, glowAlt: 0xffd54a }, side + 3);
      for (let y = 6; y < WALL_TOP; y += 8) this.halos.add(x, y, faceZ - 1.6, cyan, 8, 0.4);
    }
  }

  /* ------------------------------------------------------------- light -- */

  /** A halo round every torch, brazier and floating crystal the course has. */
  private haloDecorations(): void {
    for (const decoration of DECORATIONS) {
      const { x, y, z, scale } = decoration;
      if (decoration.kind === 'torch') {
        this.halos.add(x, y + 1.6 * scale, z, PALETTE.flame, 9 * scale, 0.7);
      } else if (decoration.kind === 'brazier') {
        this.halos.add(x, y + 4.9 * scale, z, PALETTE.flame, 12 * scale, 0.75);
      } else if (decoration.kind === 'crystal') {
        this.halos.add(x, y + 2 * scale, z, PALETTE.runeGlow, 11 * scale, 0.6);
      }
    }
    // The win pads: gold light, so the end of a stage is visible from its start.
    for (const stage of STAGES) {
      this.halos.add(stage.winPadX, COURSE.floorY + 1.4, stage.winPadZ, 0xffc93c, 14, 0.5);
    }
  }

  /** Lava throws light: a field of warm halos just over every lava pool. */
  private haloLava(): void {
    for (const pool of QUICKSAND) {
      if (pool.surface !== 'lava') continue;
      const width = pool.maxX - pool.minX;
      const depth = pool.maxZ - pool.minZ;
      const nx = Math.max(1, Math.round(width / LAVA_HALO_STEP));
      const nz = Math.max(1, Math.round(depth / LAVA_HALO_STEP));
      for (let ix = 0; ix < nx; ix += 1) {
        for (let iz = 0; iz < nz; iz += 1) {
          const jitter = hash(ix * 31 + iz * 17 + Math.round(pool.minZ));
          const x = pool.minX + ((ix + 0.5) / nx) * width;
          const z = pool.minZ + ((iz + 0.5 + (jitter - 0.5) * 0.4) / nz) * depth;
          this.halos.add(x, pool.surfaceY + 1.2, z, jitter > 0.5 ? 0xff8a1f : 0xffc23a, 22, 0.42);
        }
      }
    }
  }

  /**
   * Motes of magic drifting through every stage, in its theme's glow.
   *
   * Deterministic, so every client's air is the same; kept inside the
   * corridor's walls and under its roof.
   */
  private scatterMotes(): void {
    const roofAt = ceilingLookup();
    const from = COURSE.lobbyStartZ + 4;
    const to = COURSE_END_Z;
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const z = from + hash(i * 3 + 1) * (to - from);
      const half = corridorHalfWidthAt(z) - 2;
      const x = (hash(i * 3 + 2) * 2 - 1) * half;
      const top = Math.min(roofAt(z) - 3, 42);
      const y = 2 + hash(i * 3 + 3) * Math.max(4, top - 2);
      const theme = themeAt(z);
      const colour = hash(i * 7 + 5) > 0.35 ? theme.glow : theme.glowAlt;
      this.motes.add(x, y, z, colour, 0.9 + hash(i * 11 + 9) * 0.9, 0.9, hash(i * 13 + 4) * 6.283);
    }
  }

  /* ----------------------------------------------------------- helpers -- */

  private nearWidthStep(z: number, extra: number): boolean {
    return this.widthSteps.some((step) => Math.abs(step - z) < WIDTH_STEP_CLEARANCE + extra);
  }

  private addMerged(parts: BufferGeometry[], material: Material): void {
    this.materials.push(material);
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    parts.length = 0;
    if (!merged) return;
    this.geometries.push(merged);
    const mesh = new Mesh(merged, material);
    mesh.receiveShadow = material instanceof MeshLambertMaterial;
    this.root.add(mesh);
  }

  /**
   * One POINTS draw for a whole set of soft glows.
   *
   * A custom shader rather than `PointsMaterial` for three reasons: each point
   * needs its own SIZE and BRIGHTNESS, the motes need to drift on the shared
   * clock, and additive sprites must FADE into the fog rather than being
   * tinted by it - an additive point tinted toward the fog colour brightens
   * the distance instead of disappearing into it.
   */
  private addPoints(set: PointSet, drift: number): void {
    if (set.count === 0) return;
    const geometry = set.build();
    this.geometries.push(geometry);

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        drift: { value: drift },
        viewportHeight: { value: 800 },
        fogNear: { value: WORLD_FOG.near },
        fogFar: { value: WORLD_FOG.far },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float size;
        attribute float strength;
        attribute float phase;
        uniform float time;
        uniform float drift;
        uniform float viewportHeight;
        varying vec3 vColor;
        varying float vStrength;
        varying float vDepth;
        void main() {
          vec3 p = position;
          p += drift * vec3(
            sin(time * 0.45 + phase) * 1.6,
            sin(time * 0.7 + phase * 1.7) * 1.1,
            cos(time * 0.38 + phase * 0.6) * 1.6
          );
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 0.5);
          gl_PointSize = size * projectionMatrix[1][1] * viewportHeight * 0.5 / depth;
          // Motes twinkle; halos breathe.
          float pulse = drift > 0.5
            ? 0.6 + 0.4 * sin(time * 2.1 + phase * 3.0)
            : 0.9 + 0.1 * sin(time * 1.3 + phase);
          vColor = color;
          vStrength = strength * pulse;
          vDepth = depth;
        }
      `,
      fragmentShader: `
        uniform float fogNear;
        uniform float fogFar;
        varying vec3 vColor;
        varying float vStrength;
        varying float vDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          // A bright core and a long soft falloff: the core is the light, the
          // falloff is what it lights.
          float glow = pow(1.0 - d, 2.2) + 0.55 * pow(1.0 - d, 8.0);
          float fade = 1.0 - smoothstep(fogNear, fogFar, vDepth);
          gl_FragColor = vec4(vColor * glow * vStrength * fade, 1.0);
        }
      `,
    });
    this.pointMaterials.push(material);

    const points = new Points(geometry, material);
    points.frustumCulled = false;
    const size = new Vector2();
    points.onBeforeRender = (renderer: WebGLRenderer) => {
      renderer.getDrawingBufferSize(size);
      (material.uniforms['viewportHeight'] as { value: number }).value = size.y;
    };
    this.root.add(points);
  }
}

/** A growable list of glow points, flattened into one geometry at the end. */
class PointSet {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly sizes: number[] = [];
  private readonly strengths: number[] = [];
  private readonly phases: number[] = [];
  private readonly scratch = new Color();

  get count(): number {
    return this.sizes.length;
  }

  add(x: number, y: number, z: number, colour: number, size: number, strength: number, phase?: number): void {
    this.positions.push(x, y, z);
    this.scratch.setHex(colour);
    this.colours.push(this.scratch.r, this.scratch.g, this.scratch.b);
    this.sizes.push(size);
    this.strengths.push(strength);
    this.phases.push(phase ?? hash(this.sizes.length * 19 + 7) * 6.283);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute('size', new Float32BufferAttribute(this.sizes, 1));
    geometry.setAttribute('strength', new Float32BufferAttribute(this.strengths, 1));
    geometry.setAttribute('phase', new Float32BufferAttribute(this.phases, 1));
    return geometry;
  }
}

/** A box of one colour, positioned in world space, optionally rolled about X. */
const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
  rollX = 0,
): BufferGeometry => {
  const geometry = new BoxGeometry(w, h, d);
  if (rollX !== 0) geometry.rotateX(rollX);
  geometry.translate(x, y, z);
  paint(geometry, colour, false);
  return geometry;
};

/**
 * A faceted crystal: an octahedron drawn out into a shard.
 *
 * Its facets are shaded in the vertex colour - upward faces brighter, side
 * faces a touch deeper - so an UNLIT crystal still reads as cut stone rather
 * than a flat sticker.
 */
const crystal = (
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  colour: number,
  tilt: number,
  seed: number,
): BufferGeometry => {
  const geometry = new OctahedronGeometry(1, 0);
  geometry.scale(radius, height / 2, radius);
  geometry.rotateY(hash(seed) * Math.PI);
  geometry.rotateZ(tilt);
  geometry.translate(x, y, z);
  paint(geometry, colour, true);
  return geometry;
};

/** Write a colour into every vertex; `facet` shades each face by its normal. */
const paint = (geometry: BufferGeometry, colour: number, facet: boolean): void => {
  const base = new Color(colour);
  const normals = geometry.getAttribute('normal');
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  const shaded = new Color();
  for (let i = 0; i < count; i += 1) {
    shaded.copy(base);
    if (facet && normals) {
      const ny = normals.getY(i);
      const nx = normals.getX(i);
      const k = 0.78 + 0.22 * ny + 0.08 * nx;
      shaded.multiplyScalar(k).lerp(new Color(0xffffff), ny > 0.3 ? 0.18 : 0);
    }
    data[i * 3] = shaded.r;
    data[i * 3 + 1] = shaded.g;
    data[i * 3 + 2] = shaded.b;
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
};

/** The roof height over a Z, from the ceilings the stages actually built. */
const ceilingLookup = (): ((z: number) => number) => {
  const roofs = COURSE_SOLIDS.filter((solid) => solid.kind === 'ceiling');
  return (z: number): number => {
    for (const roof of roofs) {
      if (z >= roof.minZ && z <= roof.maxZ) return roof.minY;
    }
    return 50;
  };
};

/** Deterministic 0..1 hash, so every client dresses the dungeon identically. */
const hash = (n: number): number => {
  let t = (n + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
