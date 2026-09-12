import {
  COURSE,
  COURSE_END_Z,
  COURSE_SOLIDS,
  DECORATIONS,
  corridorHalfWidthAt,
  formatSpeed,
  QUICKSAND,
  STAGES,
  TRAINING,
  WIDE_AREAS,
  WorldCollision,
  type CourseSolid,
  type SolidKind,
} from '@broom/shared';
import {
  Group,
  Mesh,
  MeshLambertMaterial,
  Scene,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SCENERY } from '../config/worldVisuals.js';
import { BroomStands } from './BroomStands.js';
import { CanvasSign } from './CanvasSign.js';
import { ImageBillboard } from './ImageBillboard.js';
import { Scoreboard } from './Scoreboard.js';
import { Guardian } from './Guardian.js';
import { Hazards } from './Hazards.js';
import { SinkingPlatforms } from './SinkingPlatforms.js';
import { Sky } from './Sky.js';
import { StageSigns } from './StageSigns.js';
import { TrainingArea } from './TrainingArea.js';
import { WorldTextures } from './WorldTextures.js';
import { texturedBox } from './texturedBox.js';

/** World units one repeat of a tiling texture covers. */
const TILE = 6;

/**
 * The supplied trophy art, served from the repo-level `assets/` folder.
 *
 * Vite publishes that folder as the web root, so this path is what the file is
 * reachable at in dev and in the build alike.
 */
const TROPHY_URL = '/ui/trophy.png';

/**
 * The visible world.
 *
 * Every solid it draws comes from `COURSE_SOLIDS` - the SAME array the
 * collision model is built from - so a platform the player can see but not
 * stand on is structurally impossible. `CourseWorld` is the visuals and
 * `WorldCollision` is the gameplay shape, and they cannot drift apart because
 * neither owns a coordinate.
 *
 * Geometry is merged per material, so a three-thousand-unit world with eight
 * stages is a couple of dozen draw calls rather than a few hundred meshes.
 */
export class CourseWorld {
  readonly root = new Group();

  /** The gameplay shape of the same data. Shared with the local prediction. */
  readonly collision = new WorldCollision();

  readonly hazards: Hazards;
  readonly stands: BroomStands;
  readonly signs: StageSigns;
  readonly training: TrainingArea;
  readonly sinking: SinkingPlatforms;
  readonly guardian: Guardian;
  /** The three leaderboards on the back wall of the spawn arena. */
  readonly scoreboard: Scoreboard;
  readonly sky: Sky;

  private readonly textures = new WorldTextures();
  private readonly materials: Material[] = [];
  private readonly winSigns: CanvasSign[] = [];
  /** The trophy hanging over each win pad. Supplied art, used as it is. */
  private readonly trophies: ImageBillboard[] = [];

  constructor() {
    this.buildSolids();
    this.buildPitFloor();
    this.buildQuicksand();
    this.buildWalls();
    this.buildScenery();
    this.buildDecorations();
    this.buildWinPadSigns();

    this.hazards = new Hazards();
    this.root.add(this.hazards.root);

    this.sinking = new SinkingPlatforms(
      this.textures.stone(PALETTE.stone, PALETTE.stoneDark),
    );
    this.root.add(this.sinking.root);

    this.stands = new BroomStands();
    this.root.add(this.stands.root);

    this.signs = new StageSigns();
    this.root.add(this.signs.root);

    this.training = new TrainingArea(
      this.textures.belt(hex(PALETTE.treadmillBelt), '#b48bff'),
    );
    this.root.add(this.training.root);

    this.guardian = new Guardian();
    this.root.add(this.guardian.root);

    this.scoreboard = new Scoreboard();
    this.root.add(this.scoreboard.root);

    this.sky = new Sky();
    this.root.add(this.sky.root);
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  /**
   * @param elapsed the server's clock, replicated. The rolling balls and the
   *                sinking platforms are pure functions of it, so drawing them
   *                from it is what makes what is on screen the same thing the
   *                server will kill with.
   */
  update(delta: number, elapsed: number): void {
    this.hazards.update(elapsed);
    this.sinking.update(elapsed);
    this.stands.update(delta);
    this.training.update(delta);
    this.guardian.update(delta);
  }

  dispose(): void {
    this.textures.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.winSigns) sign.dispose();
    for (const trophy of this.trophies) trophy.dispose();
    this.hazards.dispose();
    this.sinking.dispose();
    this.stands.dispose();
    this.signs.dispose();
    this.training.dispose();
    this.guardian.dispose();
    this.scoreboard.dispose();
    this.sky.dispose();
    this.root.removeFromParent();
  }

  /** Draw every solid, grouped by kind so each group is one mesh. */
  private buildSolids(): void {
    const byKind = new Map<SolidKind, BufferGeometry[]>();

    for (const solid of COURSE_SOLIDS) {
      const list = byKind.get(solid.kind) ?? [];
      list.push(boxFor(solid, TILE));
      byKind.set(solid.kind, list);
    }

    for (const [kind, geometries] of byKind) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;

      const mesh = new Mesh(merged, this.materialFor(kind));
      mesh.receiveShadow = true;
      mesh.castShadow =
        kind === 'block' || kind === 'pillar' || kind === 'plank' || kind === 'ruin';
      this.root.add(mesh);
    }
  }

  /**
   * The bottom of the world.
   *
   * One slab under everything. Without it a fall shows the underside of the
   * course and an infinite void, which is exactly what makes a map look
   * unfinished - and it is not a cover-up, because the death plane sits well
   * ABOVE it: the player dies looking at a floor they were falling toward,
   * rather than into nothing.
   */
  private buildPitFloor(): void {
    const widest = Math.max(
      COURSE.lobbyHalfWidth,
      ...WIDE_AREAS.map((area) => area.halfWidth),
    );
    const width = widest * 2 + 120;
    const from = COURSE.lobbyStartZ - 60;
    const to = COURSE_END_Z + 60;

    const floor = texturedBox(width, 6, to - from, TILE * 2);
    floor.translate(0, COURSE.pitFloorY - 3, (from + to) / 2);
    const mesh = new Mesh(floor, this.solidMaterial(PALETTE.pitFloor));
    mesh.receiveShadow = true;
    this.root.add(mesh);

    // The sides of the plateau the world sits on, so the drop reads as a cliff
    // with a bottom rather than as a slab hanging in space.
    const skirts: BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const skirt = texturedBox(8, COURSE.pitFloorY * -1, to - from, TILE);
      skirt.translate(
        side * (widest + 30),
        COURSE.pitFloorY / 2,
        (from + to) / 2,
      );
      skirts.push(skirt);
    }
    this.addMerged(skirts, this.solidMaterial(PALETTE.pitFloor), true);
  }

  /**
   * The bottom of every pit, in whatever the pit is made of.
   *
   * Lava, void and water kill by exactly the same rule and are drawn by
   * exactly the same box - grouped by material so the three of them still cost
   * three meshes rather than one per pit. The mechanic is shared on purpose;
   * only the look is not, which is what lets a dozen stages use it without
   * reading as the same stage a dozen times.
   */
  private buildQuicksand(): void {
    if (QUICKSAND.length === 0) return;

    const byMaterial = new Map<string, BufferGeometry[]>();
    for (const pit of QUICKSAND) {
      const geometry = texturedBox(
        pit.maxX - pit.minX,
        1.5,
        pit.maxZ - pit.minZ,
        TILE,
      );
      geometry.translate(
        (pit.minX + pit.maxX) / 2,
        pit.surfaceY - 0.75,
        (pit.minZ + pit.maxZ) / 2,
      );
      const list = byMaterial.get(pit.surface);
      if (list) list.push(geometry);
      else byMaterial.set(pit.surface, [geometry]);
    }

    for (const [surface, parts] of byMaterial) {
      if (surface === 'lava') {
        // The one emissive material in the world. Lava that took the scene's
        // lighting like everything else would read as orange rock.
        const map = this.textures.sand(PALETTE.lava, PALETTE.lavaDark);
        const material = new MeshLambertMaterial({ map });
        material.emissive.setHex(0xff5a12);
        material.emissiveIntensity = 0.65;
        material.emissiveMap = map;
        this.materials.push(material);
        this.addMerged(parts, material, false);
        continue;
      }
      // The VOID is the default, which is right for this game: most of what
      // is under these platforms is nothing at all.
      const colours =
        surface === 'water'
          ? [PALETTE.water, PALETTE.waterDark]
          : [PALETTE.quicksand, PALETTE.quicksandDark];
      this.addMerged(
        parts,
        this.texturedMaterial(
          this.textures.sand(colours[0] as string, colours[1] as string),
        ),
        true,
      );
    }
  }

  /**
   * The pink walls that box the world in, capped with green hedge.
   *
   * These are SCENERY. What actually holds the player in is
   * `WorldCollision.clampToBounds`, which is applied after the substep has
   * already integrated and therefore cannot be tunnelled at any speed.
   */
  private buildWalls(): void {
    const thickness = 5;
    const walls: BufferGeometry[] = [];
    const hedges: BufferGeometry[] = [];

    const run = (halfWidth: number, fromZ: number, toZ: number): void => {
      const length = toZ - fromZ;
      if (length <= 0) return;
      const centreZ = (fromZ + toZ) / 2;

      for (const side of [-1, 1]) {
        const x = side * (halfWidth + thickness / 2);
        const wall = texturedBox(thickness, COURSE.wallHeight, length, TILE);
        wall.translate(x, COURSE.wallHeight / 2 - COURSE.floorThickness, centreZ);
        walls.push(wall);

        const cap = texturedBox(thickness + 1.4, 1.8, length, TILE);
        cap.translate(x, COURSE.wallHeight - COURSE.floorThickness + 0.9, centreZ);
        hedges.push(cap);

        // Drips down the inner face - the detail that makes a pink box read as
        // an overgrown garden wall. Deterministic, never random.
        const drips = Math.max(1, Math.floor(length / 8));
        for (let i = 0; i < drips; i += 1) {
          const t = (i + 0.5) / drips;
          const height = 2 + ((i * 37) % 5) * 1.1;
          const drip = texturedBox(1, height, 2.4, TILE);
          drip.translate(
            side * (halfWidth - 0.2),
            COURSE.wallHeight - COURSE.floorThickness - height / 2 + 0.8,
            fromZ + t * length,
          );
          hedges.push(drip);
        }
      }
    };

    /**
     * A shoulder wall where the world changes width.
     *
     * Without one, a wide area meets a narrow corridor with an open gap either
     * side and the player looks straight out of the map. Built from the SAME
     * two widths the boundary uses, so it always exactly closes the step.
     */
    const shoulder = (wideHalf: number, narrowHalf: number, atZ: number): void => {
      const span = wideHalf - narrowHalf;
      if (span <= 0.01) return;
      for (const side of [-1, 1]) {
        const piece = texturedBox(span, COURSE.wallHeight, thickness, TILE);
        piece.translate(
          side * (narrowHalf + span / 2),
          COURSE.wallHeight / 2 - COURSE.floorThickness,
          atZ,
        );
        walls.push(piece);
      }
    };

    // Walk the world from the arena's back wall to the end, splitting at every
    // change of width. The spans come from WIDE_AREAS - the same list the
    // movement clamp reads - so a wall can never end up somewhere the boundary
    // is not.
    const end = COURSE_END_Z + 10;
    const boundaries = [COURSE.lobbyStartZ, end];
    for (const area of WIDE_AREAS) {
      boundaries.push(area.minZ, area.maxZ);
    }
    const marks = [...new Set(boundaries)]
      .filter((z) => z >= COURSE.lobbyStartZ && z <= end)
      .sort((a, b) => a - b);

    for (let i = 0; i < marks.length - 1; i += 1) {
      const fromZ = marks[i] as number;
      const toZ = marks[i + 1] as number;
      if (toZ - fromZ < 0.01) continue;
      // Sampled at the MIDDLE of the span: a boundary value would land exactly
      // on the edge of a wide area and could resolve either way.
      const halfWidth = corridorHalfWidthAt((fromZ + toZ) / 2);
      run(halfWidth, fromZ, toZ);

      const nextZ = marks[i + 2];
      const nextHalf =
        nextZ === undefined ? halfWidth : corridorHalfWidthAt((toZ + nextZ) / 2);
      if (nextHalf > halfWidth) shoulder(nextHalf, halfWidth, toZ - thickness / 2);
      else shoulder(halfWidth, nextHalf, toZ + thickness / 2);
    }

    // The arena's back wall.
    const back = texturedBox(
      COURSE.lobbyHalfWidth * 2 + thickness * 2,
      COURSE.wallHeight,
      thickness,
      TILE,
    );
    back.translate(
      0,
      COURSE.wallHeight / 2 - COURSE.floorThickness,
      COURSE.lobbyStartZ - thickness / 2,
    );
    walls.push(back);

    this.addMerged(walls, this.brickMaterial(), true);
    this.addMerged(hedges, this.solidMaterial(PALETTE.hedge), true);
  }

  /**
   * Blocky trees behind the walls.
   *
   * A trunk and three stacked canopy plates - the reference art's trees are
   * flat slabs, not spheres, and getting that wrong is the single fastest way
   * to make a scene stop looking like this game.
   */
  private buildScenery(): void {
    const trunks: BufferGeometry[] = [];
    const canopies: BufferGeometry[] = [];
    let index = 0;

    for (let z = COURSE.lobbyStartZ; z < COURSE_END_Z; z += SCENERY.treeSpacingZ) {
      for (const side of [-1, 1]) {
        index += 1;
        // Deterministic variation: a hash of the index, never Math.random, so
        // every client sees the same treeline.
        const wobble = ((index * 2654435761) >>> 0) / 4294967296;
        const height = SCENERY.trunkMin + wobble * (SCENERY.trunkMax - SCENERY.trunkMin);
        const halfWidth = corridorHalfWidthAt(z);
        const x = side * (halfWidth + SCENERY.treeOffsetX + wobble * 7);
        const at = z + wobble * SCENERY.treeSpacingZ * 0.6;
        this.pushTree(trunks, canopies, x, COURSE.floorY, at, 1 + wobble * 0.4);
      }
    }

    // In-world trees from the stage data, on the same two meshes.
    for (const decoration of DECORATIONS) {
      if (decoration.kind !== 'tree') continue;
      this.pushTree(
        trunks,
        canopies,
        decoration.x,
        decoration.y,
        decoration.z,
        decoration.scale,
      );
    }

    this.addMerged(trunks, this.solidMaterial(PALETTE.trunk), false);
    this.addMerged(canopies, this.solidMaterial(PALETTE.canopyA), false);
  }

  private pushTree(
    trunks: BufferGeometry[],
    canopies: BufferGeometry[],
    x: number,
    baseY: number,
    z: number,
    scale: number,
  ): void {
    const height = 9 * scale;
    const trunk = texturedBox(1.7 * scale, height, 1.7 * scale, TILE);
    trunk.translate(x, baseY + height / 2 - COURSE.floorThickness, z);
    trunks.push(trunk);

    const plates = [
      { w: 11, h: 1.7, y: height },
      { w: 8.6, h: 1.6, y: height + 1.7 },
      { w: 5.8, h: 1.5, y: height + 3.3 },
    ];
    for (const plate of plates) {
      const canopy = texturedBox(plate.w * scale, plate.h * scale, plate.w * scale, TILE);
      canopy.translate(x, baseY + plate.y * scale - COURSE.floorThickness, z);
      canopies.push(canopy);
    }
  }

  /**
   * Stage-specific scenery: the false floors of stage 4.
   *
   * They are drawn as tree canopy - leaves rather than planks - and have NO
   * solid behind them. That material difference is the entire tell, which is
   * what makes the stage a reading test rather than a guessing game.
   */
  private buildDecorations(): void {
    const leaves: BufferGeometry[] = [];

    for (const decoration of DECORATIONS) {
      if (decoration.kind !== 'falseFloor') continue;
      const size = 7 * decoration.scale;
      // Two stacked plates, so it has the silhouette of something to land on
      // when glanced at from a distance.
      const top = texturedBox(size, 0.7, size, TILE);
      top.translate(decoration.x, decoration.y, decoration.z);
      leaves.push(top);
      const under = texturedBox(size * 0.7, 0.6, size * 0.7, TILE);
      under.translate(decoration.x, decoration.y - 0.65, decoration.z);
      leaves.push(under);
    }

    this.addMerged(leaves, this.solidMaterial(PALETTE.canopyB), false);
    this.buildProps();
  }

  /**
   * The scenery of the later stages: boulders, waterfalls and torches.
   *
   * All of it is boxes, and all of it merges into one mesh per material - a
   * forest of fourteen trees and seven boulders is two draw calls, the same as
   * a forest of one.
   */
  private buildProps(): void {
    const rocks: BufferGeometry[] = [];
    const water: BufferGeometry[] = [];
    const posts: BufferGeometry[] = [];
    const flames: BufferGeometry[] = [];
    const iron: BufferGeometry[] = [];
    const crystals: BufferGeometry[] = [];

    for (const decoration of DECORATIONS) {
      const { x, y, z, scale } = decoration;

      if (decoration.kind === 'rock') {
        // Three offset boxes, so a boulder has a silhouette rather than being
        // a cube with a rock-coloured texture on it.
        const lumps = [
          { w: 5.5, h: 4, d: 5, dx: 0, dy: 2, dz: 0 },
          { w: 3.6, h: 2.6, d: 3.4, dx: 1.8, dy: 1.3, dz: -1.4 },
          { w: 2.8, h: 3.4, d: 3, dx: -1.6, dy: 1.7, dz: 1.2 },
        ];
        for (const lump of lumps) {
          const box = texturedBox(lump.w * scale, lump.h * scale, lump.d * scale, TILE);
          box.translate(x + lump.dx * scale, y + lump.dy * scale, z + lump.dz * scale);
          rocks.push(box);
        }
        continue;
      }

      if (decoration.kind === 'waterfall') {
        // A flat sheet down the wall, stepped so it reads as falling water
        // rather than as a painted stripe.
        for (let i = 0; i < 4; i += 1) {
          const box = texturedBox(1.2, 6 * scale, (9 - i) * scale, TILE);
          box.translate(x, y - i * 5.6 * scale, z);
          water.push(box);
        }
        continue;
      }

      if (decoration.kind === 'torch') {
        // A WALL bracket rather than a free-standing post: these are bolted to
        // the corridor walls, which is why they are short and why the flame
        // sits at the end of the arm rather than on top of a pole.
        const bracket = texturedBox(1.6 * scale, 0.7 * scale, 0.7 * scale, TILE);
        bracket.translate(x, y, z);
        iron.push(bracket);
        const flame = texturedBox(1.5 * scale, 2.2 * scale, 1.5 * scale, TILE);
        flame.translate(x, y + 1.6 * scale, z);
        flames.push(flame);
        continue;
      }

      if (decoration.kind === 'brazier') {
        // Three legs, a bowl and a fire. The dungeon's floor-standing light,
        // and the thing that marks every win pad and every vault.
        for (let i = 0; i < 3; i += 1) {
          const angle = (i / 3) * Math.PI * 2;
          const leg = texturedBox(0.5 * scale, 3 * scale, 0.5 * scale, TILE);
          leg.translate(
            x + Math.cos(angle) * 1.1 * scale,
            y + 1.5 * scale,
            z + Math.sin(angle) * 1.1 * scale,
          );
          iron.push(leg);
        }
        const bowl = texturedBox(3.2 * scale, 1.1 * scale, 3.2 * scale, TILE);
        bowl.translate(x, y + 3.4 * scale, z);
        iron.push(bowl);
        const fire = texturedBox(2.4 * scale, 2.2 * scale, 2.4 * scale, TILE);
        fire.translate(x, y + 4.8 * scale, z);
        flames.push(fire);
        continue;
      }

      if (decoration.kind === 'chain') {
        // Links from the ceiling down into the dark. Purely a vertical line
        // through the frame, and that is the job: a cavern with nothing
        // hanging in it has no sense of how high its roof is.
        for (let i = 0; i < 9; i += 1) {
          const link = texturedBox(
            (i % 2 === 0 ? 0.55 : 0.35) * scale,
            1.5 * scale,
            (i % 2 === 0 ? 0.35 : 0.55) * scale,
            TILE,
          );
          link.translate(x, y - i * 1.7 * scale, z);
          iron.push(link);
        }
        continue;
      }

      if (decoration.kind === 'crystal') {
        // A floating shard, stacked so it tapers to a point at both ends.
        const bands = [
          { w: 1.0, h: 1.6, dy: 0 },
          { w: 1.4, h: 1.4, dy: 1.5 },
          { w: 0.9, h: 1.8, dy: 2.9 },
          { w: 0.4, h: 1.2, dy: 4.2 },
        ];
        for (const band of bands) {
          const shard = texturedBox(
            band.w * scale,
            band.h * scale,
            band.w * scale,
            TILE,
          );
          shard.translate(x, y + band.dy * scale, z);
          crystals.push(shard);
        }
      }
    }

    this.addMerged(rocks, this.solidMaterial(PALETTE.rock), false);
    this.addMerged(posts, this.solidMaterial(PALETTE.trunk), false);
    this.addMerged(iron, this.solidMaterial(PALETTE.metalDark), false);

    if (crystals.length > 0) {
      // Lit, and the same violet the rune slabs are: in this world a glow is
      // always the magic, and a crystal that glowed some other colour would be
      // the first thing to break that.
      const material = new MeshLambertMaterial({
        color: PALETTE.runeEdge,
        transparent: true,
        opacity: 0.85,
      });
      material.emissive.setHex(PALETTE.runeGlow);
      material.emissiveIntensity = 0.9;
      this.materials.push(material);
      this.addMerged(crystals, material, false);
    }

    if (water.length > 0) {
      const material = new MeshLambertMaterial({
        color: PALETTE.water,
        transparent: true,
        opacity: 0.78,
      });
      this.materials.push(material);
      this.addMerged(water, material, false);
    }
    if (flames.length > 0) {
      const material = new MeshLambertMaterial({ color: PALETTE.flame });
      material.emissive.setHex(PALETTE.flame);
      material.emissiveIntensity = 0.8;
      this.materials.push(material);
      this.addMerged(flames, material, false);
    }
  }

  /**
   * The floating label over each win pad, and the trophy above it.
   *
   * "+N WINS" on top and "RETURN" underneath. The order is the whole point:
   * the first line is what the player gets and the second is what happens
   * next, and the second is an honest promise rather than a surprise - banking
   * a stage sends the player straight back to the vault, which is also what
   * makes a second payment impossible.
   *
   * The trophy is the SUPPLIED ART from `assets/ui/trophy.png`, the same image
   * the Wins counter and the award flight use, so the thing a player chases
   * across a stage and the thing that then appears on their HUD are plainly
   * one object.
   */
  private buildWinPadSigns(): void {
    for (const stage of STAGES) {
      const sign = new CanvasSign(13, 6.2, [
        {
          // Formatted, like every other large figure the player reads. The
          // late stages pay millions, and "+5000000 WINS" is a number nobody
          // parses at three hundred units a second.
          text: `+${formatSpeed(stage.winReward)} WIN${stage.winReward === 1 ? '' : 'S'}`,
          size: 1,
          fill: '#ffffff',
          stroke: '#4a3208',
          strokeWidth: 0.19,
        },
        { text: 'RETURN', size: 0.6, fill: '#ffe9a8', stroke: '#3f3410' },
      ]);
      sign.mesh.position.set(stage.winPadX, COURSE.floorY + 5.6, stage.winPadZ);
      // Facing back down the course, at the player arriving.
      sign.mesh.rotation.y = Math.PI;
      this.root.add(sign.mesh);
      this.winSigns.push(sign);

      const trophy = new ImageBillboard(TROPHY_URL, 3.4);
      trophy.mesh.position.set(stage.winPadX, COURSE.floorY + 10.2, stage.winPadZ);
      trophy.mesh.rotation.y = Math.PI;
      this.root.add(trophy.mesh);
      this.trophies.push(trophy);
    }
  }

  private addMerged(
    geometries: BufferGeometry[],
    material: Material,
    receiveShadow: boolean,
  ): void {
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return;
    const mesh = new Mesh(merged, material);
    mesh.receiveShadow = receiveShadow;
    this.root.add(mesh);
  }

  /** One material per kind, built once and remembered for disposal. */
  private materialFor(kind: SolidKind): Material {
    switch (kind) {
      case 'floor':
        return this.texturedMaterial(
          this.textures.grassStuds(PALETTE.grass, PALETTE.grassStud),
        );
      case 'lobby':
        return this.texturedMaterial(
          this.textures.grassStuds(PALETTE.lobbyGrass, PALETTE.lobbyGrassStud),
        );
      case 'training':
        return this.texturedMaterial(
          this.textures.planks(PALETTE.deck, PALETTE.deckDark, PALETTE.woodSpeck),
        );
      case 'block':
      case 'plank':
        return this.texturedMaterial(
          this.textures.planks(PALETTE.wood, PALETTE.woodDark, PALETTE.woodSpeck),
        );
      case 'ruin':
        return this.texturedMaterial(
          this.textures.stone(hex(PALETTE.ruin), hex(PALETTE.ruinDark)),
        );
      case 'ice':
        return this.texturedMaterial(this.textures.ice(PALETTE.ice, PALETTE.iceStud));
      case 'stone':
        return this.texturedMaterial(this.textures.stone(PALETTE.stone, PALETTE.stoneDark));
      case 'log':
        return this.texturedMaterial(
          this.textures.planks(PALETTE.log, PALETTE.logDark, PALETTE.woodSpeck),
        );
      case 'metal':
        return this.texturedMaterial(
          this.textures.stone(hex(PALETTE.metal), hex(PALETTE.metalDark)),
        );
      case 'pillar':
        return this.brickMaterial();
      case 'ceiling':
        // The same masonry as the walls, so the room closes rather than being
        // capped with something that reads as a different building.
        return this.brickMaterial();
      case 'rune': {
        /*
         * THE conjured platform, and the one material in the world that emits
         * light.
         *
         * It has to: a rune slab hangs over a lava pit or a void with nothing
         * under it, and in a dungeon this dark an unlit slab is a silhouette
         * the player cannot judge the edge of. Lighting it also makes the
         * promise the whole course is built on legible at distance - violet
         * means "somewhere to land", so the route through a stage is readable
         * from the platform before it.
         */
        const material = new MeshLambertMaterial({
          map: this.textures.runeSlab(hex(PALETTE.rune), hex(PALETTE.runeEdge)),
        });
        material.emissive.setHex(PALETTE.runeGlow);
        material.emissiveIntensity = 0.5;
        this.materials.push(material);
        return material;
      }
      case 'winPad': {
        // The trophy pad. Lit, for the same reason a rune slab is: it is the
        // thing the player is looking for at the end of a stage.
        const material = new MeshLambertMaterial({
          map: this.textures.goldCheck(PALETTE.winPad, PALETTE.winPadAlt),
        });
        material.emissive.setHex(0xffb832);
        material.emissiveIntensity = 0.45;
        this.materials.push(material);
        return material;
      }
      case 'stand':
      default:
        return this.solidMaterial(PALETTE.standBase);
    }
  }

  private brickMaterial(): Material {
    return this.texturedMaterial(
      this.textures.brick(PALETTE.wall, PALETTE.wallDark, PALETTE.wallSpeck),
    );
  }

  private texturedMaterial(map: Texture): Material {
    const material = new MeshLambertMaterial({ map });
    this.materials.push(material);
    return material;
  }

  private solidMaterial(color: number): Material {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }
}

/** A solid's box, positioned in world space. */
const boxFor = (solid: CourseSolid, tile: number): BufferGeometry => {
  const geometry = texturedBox(
    solid.maxX - solid.minX,
    solid.maxY - solid.minY,
    solid.maxZ - solid.minZ,
    tile,
  );
  geometry.translate(
    (solid.minX + solid.maxX) / 2,
    (solid.minY + solid.maxY) / 2,
    (solid.minZ + solid.maxZ) / 2,
  );
  return geometry;
};

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

export { STAGES, TRAINING };
