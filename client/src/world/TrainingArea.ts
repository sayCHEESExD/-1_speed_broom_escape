import {
  COURSE,
  TRAINING,
  TREADMILL_BELT_Y,
  TREADMILL_COUNT,
  treadmillTier,
  treadmillX,
  treadmillZ,
} from '@broom/shared';
import {
  Group,
  Mesh,
  MeshLambertMaterial,
  type BufferGeometry,
  type Texture,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast the belt texture scrolls, in texture repeats per second. */
const BELT_SCROLL = 0.9;

/** One built machine, so a tier can be lit or greyed as the player levels. */
interface Machine {
  readonly index: number;
  readonly tier: number;
  readonly minLevel: number;
  readonly belt: Mesh;
  readonly screen: Mesh;
  readonly frames: Mesh[];
}

/**
 * The training hall on the RIGHT of the starting vault.
 *
 * SIX treadmills in three tiers of two, and unlike the previous game's
 * identical belts this IS a ladder: tier 1 pays at x1 from level 0, tier 2 at
 * x1.5 from level 20, tier 3 at x2 from level 75. Two machines per tier is the
 * deliberate part - a tier a player has unlocked should never be something to
 * queue for, and one belt per tier in a fifteen-player room would be exactly
 * that.
 *
 * The three tiers have to be TELLABLE APART at a glance, and they are, three
 * ways over: each tier has its own frame colour, its own console sign, and a
 * locked machine is visibly dark. A player should be able to walk into this
 * hall and see which row is theirs without reading anything.
 *
 * ORIENTATION: a treadmill faces the way its runner does, and the runner is
 * meant to be looking back at the spawn point in the middle of the vault -
 * which from this deck against the right wall is +X. So the belt runs along X
 * with the console at its +X end, and the tiers step along Z.
 *
 * The belts themselves are real solids in the shared course data; everything
 * here is the machine around them. Whether a belt PAYS is decided entirely by
 * the server against the level it owns - this only says which belt is which.
 */
export class TrainingArea {
  readonly root = new Group();

  private readonly machines: Machine[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];

  /** Per-tier frame materials, lit and locked. */
  private readonly tierMaterial: MeshLambertMaterial[] = [];
  private readonly lockedMaterial: MeshLambertMaterial;
  private readonly screenLit: MeshLambertMaterial;
  private readonly screenDark: MeshLambertMaterial;

  private time = 0;
  private level = -1;

  constructor(beltTexture: Texture) {
    const frameDark = this.material(PALETTE.treadmillFrameDark);
    this.lockedMaterial = this.material(PALETTE.treadmillLocked);
    this.screenLit = this.material(PALETTE.treadmillScreen);
    this.screenLit.emissive.setHex(0x4dd4ff);
    this.screenLit.emissiveIntensity = 0.7;
    this.screenDark = this.material(PALETTE.treadmillScreen);

    for (const colour of PALETTE.treadmillTier) {
      const material = this.material(colour);
      material.emissive.setHex(colour);
      material.emissiveIntensity = 0.2;
      this.tierMaterial.push(material);
    }

    // The belt carries a scrolling chevron texture, which is what makes an
    // empty machine still read as running.
    //
    // WHITE, not the belt colour: a lit material MULTIPLIES its colour by its
    // map, so tinting an already-dark texture by its own dark colour crushes
    // the chevrons to black. The colours live in the texture; the material
    // just carries it, with a little emissive so the chevrons stay legible in
    // the deck's own shadow.
    const beltMaterial = this.material(0xffffff);
    beltMaterial.map = beltTexture;
    beltMaterial.emissive.setHex(PALETTE.treadmillBelt);
    beltMaterial.emissiveIntensity = 0.55;
    beltMaterial.emissiveMap = beltTexture;

    // Shared geometry: six machines are six transforms of the same eight
    // boxes, not six sets of geometry.
    const L = TRAINING.beltLength;
    const W = TRAINING.beltWidth;

    const deck = this.geometry(L + 1.6, 1.1, W + 1.4);
    const belt = this.geometry(L - 1.6, 0.3, W - 2.6);
    const rail = this.geometry(L + 1.6, 0.9, 1.2);
    const cowl = this.geometry(1.6, 1.3, W + 1.4);
    const post = this.geometry(1.0, 3.8, 1.0);
    const panel = this.geometry(1.2, 2.6, W - 1.4);
    const face = this.geometry(0.4, 1.5, W - 3.4);
    const handle = this.geometry(3.6, 0.8, 0.8);

    for (let index = 1; index <= TREADMILL_COUNT; index += 1) {
      const tier = treadmillTier(index);
      const frame = this.tierMaterial[tier.tier - 1] ?? frameDark;
      const machine = new Group();
      // No rotation: the belt geometry is authored running along X, which is
      // already the direction the runner faces.
      machine.position.set(treadmillX(index), TREADMILL_BELT_Y, treadmillZ(index));

      const frames: Mesh[] = [];
      const framed = (
        geometry: BufferGeometry,
        x: number,
        y: number,
        z: number,
      ): Mesh => {
        const node = this.mesh(geometry, frame, x, y, z);
        frames.push(node);
        machine.add(node);
        return node;
      };

      // The deck the belt sits in.
      framed(deck, 0, -0.7, 0);

      // The running belt: dark, lit, and scrolling.
      const surface = this.mesh(belt, beltMaterial, 0, -0.05, 0);
      machine.add(surface);

      // Raised side edges either side of the belt.
      for (const side of [-1, 1]) {
        machine.add(this.mesh(rail, frameDark, 0, 0.25, side * (W / 2 - 0.1)));
      }

      // The roller cowl at the BACK - the end the runner steps on from.
      machine.add(this.mesh(cowl, frameDark, -(L / 2 + 0.3), 0.05, 0));

      // The console at the FRONT: two uprights, a panel, a screen and the two
      // handles that reach back toward the runner.
      for (const side of [-1, 1]) {
        framed(post, L / 2 - 0.5, 1.7, side * (W / 2 - 1.1));
        machine.add(this.mesh(handle, frameDark, L / 2 - 2.4, 3.2, side * (W / 2 - 1.1)));
      }
      framed(panel, L / 2 + 0.2, 3.7, 0);
      const screen = this.mesh(face, this.screenDark, L / 2 + 0.75, 3.8, 0);
      machine.add(screen);

      /*
       * The console sign: the multiplier AND the requirement, together.
       *
       * Both, always, and on every machine including the free one. A tier
       * whose gate was only discoverable by standing on it and earning nothing
       * would be a ladder the player cannot see - and "why is this one not
       * paying me" is the single worst question a farming area can provoke.
       */
      const sign = new CanvasSign(9.5, 3.2, [
        {
          text: `x${tier.multiplier} Speed`,
          size: 1,
          fill: '#ffe14d',
          stroke: '#3a2a06',
        },
        {
          text: tier.minLevel === 0 ? 'OPEN TO ALL' : `LEVEL ${tier.minLevel}+`,
          size: 0.62,
          fill: '#ffffff',
          stroke: '#1c1630',
        },
      ]);
      sign.mesh.position.set(L / 2 + 1, 6.4, 0);
      // Facing +X, back toward the vault the player rides in from. Signs are
      // single-sided, so one left facing +Z is invisible from the only
      // direction anybody approaches from.
      sign.mesh.rotation.y = Math.PI / 2;
      machine.add(sign.mesh);
      this.signs.push(sign);

      this.root.add(machine);
      this.machines.push({
        index,
        tier: tier.tier,
        minLevel: tier.minLevel,
        belt: surface,
        screen,
        frames,
      });
    }

    // The hall's own title, on the wall behind the machines and facing the
    // open ground the players gather on.
    const title = new CanvasSign(38, 9, [
      { text: 'TRAINING', size: 1, fill: '#ffffff', stroke: '#3a2a6a', strokeWidth: 0.2 },
    ]);
    title.mesh.position.set(
      TRAINING.minX - 0.5,
      COURSE.floorY + 17,
      (TRAINING.minZ + TRAINING.maxZ) / 2,
    );
    title.mesh.rotation.y = Math.PI / 2;
    this.root.add(title.mesh);
    this.signs.push(title);

    // Nothing is unlocked until the server says otherwise.
    this.setLevel(0);
  }

  /**
   * Light the tiers this player has reached.
   *
   * Takes the REPLICATED level and decides nothing: the same figure the server
   * checks before it pays a belt is the one that colours the frame, so a lit
   * machine and a paying machine are the same machine by construction.
   */
  setLevel(level: number): void {
    if (level === this.level) return;
    this.level = level;
    for (const machine of this.machines) {
      const unlocked = level >= machine.minLevel;
      const frame = unlocked
        ? (this.tierMaterial[machine.tier - 1] ?? this.lockedMaterial)
        : this.lockedMaterial;
      for (const mesh of machine.frames) mesh.material = frame;
      machine.screen.material = unlocked ? this.screenLit : this.screenDark;
    }
  }

  /** Scroll the belts, so a machine standing empty still looks like it runs. */
  update(delta: number): void {
    this.time += delta;
    for (const machine of this.machines) {
      const material = machine.belt.material as MeshLambertMaterial;
      if (!material.map) continue;
      // Along U, which is the belt's own length - the surface travels BACKWARD
      // under a runner who is facing +X.
      material.map.offset.x = (this.time * BELT_SCROLL) % 1;
    }
  }

  private mesh(
    geometry: BufferGeometry,
    material: MeshLambertMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const node = new Mesh(geometry, material);
    node.position.set(x, y, z);
    node.castShadow = true;
    node.receiveShadow = true;
    return node;
  }

  private geometry(w: number, h: number, d: number): BufferGeometry {
    const geometry = texturedBox(w, h, d, 3);
    this.geometries.push(geometry);
    return geometry;
  }

  private material(color: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.signs) sign.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.signs.length = 0;
    this.machines.length = 0;
    this.root.removeFromParent();
  }
}
