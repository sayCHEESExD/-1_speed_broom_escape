import { BROOMS, COURSE, STAND_ROW, formatSpeed, standZ } from '@broom/shared';
import { Group, Mesh, MeshLambertMaterial } from 'three';
import { BroomModel } from '../broom/BroomModel.js';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast a display broom turns on its plinth, in radians per second. */
const TURN_RATE = 0.5;

/** How far a display broom hovers above its plinth. */
const HOVER_HEIGHT = 1.7;

/** One stand: a plinth, the broom hovering over it, and its stat sign. */
interface Stand {
  readonly slot: number;
  readonly model: BroomModel;
  readonly sign: CanvasSign;
  readonly top: Mesh;
}

/**
 * The broom shop, down the LEFT wall of the starting vault.
 *
 * This is the shop, and it is a PLACE rather than a menu: the player rides
 * their current broom onto a plinth and the server decides whether they can
 * afford what is hovering over it. Reaching the Wins total alone does nothing,
 * which is what gives the vault a reason to exist.
 *
 * Every broom in the roster gets a stand automatically, so adding an eleventh
 * puts an eleventh stand here with no change to this file.
 *
 * The display brooms HOVER and turn rather than sitting on the plinth. A
 * flying vehicle parked on the floor would be the first thing in the shop to
 * contradict what the game is about.
 */
export class BroomStands {
  readonly root = new Group();

  private readonly stands: Stand[] = [];
  private readonly baseMaterial: MeshLambertMaterial;
  private readonly ownedMaterial: MeshLambertMaterial;
  private readonly lockedMaterial: MeshLambertMaterial;

  private time = 0;

  constructor() {
    this.baseMaterial = new MeshLambertMaterial({ color: PALETTE.standBase });
    this.ownedMaterial = new MeshLambertMaterial({
      color: PALETTE.standTop,
      emissive: PALETTE.standTop,
      emissiveIntensity: 0.35,
    });
    this.lockedMaterial = new MeshLambertMaterial({ color: PALETTE.standLocked });

    const plinth = texturedBox(STAND_ROW.width, STAND_ROW.height, STAND_ROW.length, 4);
    const cap = texturedBox(STAND_ROW.width * 0.86, 0.16, STAND_ROW.length * 0.86, 4);

    for (const broom of BROOMS) {
      const group = new Group();
      // A COLUMN down the left wall: the vault is far deeper than it is wide,
      // and a row across it would have cut through the open middle the room
      // exists to provide.
      group.position.set(STAND_ROW.x, COURSE.floorY, standZ(broom.slot));

      const base = new Mesh(plinth, this.baseMaterial);
      base.position.y = STAND_ROW.height / 2;
      base.receiveShadow = true;
      group.add(base);

      // The lit cap. Gold once owned, grey while it is not - the one piece of
      // per-player state in the whole shop, and it is only ever a colour.
      const top = new Mesh(cap, this.lockedMaterial);
      top.position.y = STAND_ROW.height + 0.08;
      group.add(top);

      const model = new BroomModel(broom);
      model.root.position.y = STAND_ROW.height + HOVER_HEIGHT;
      // Pointing -X, out into the vault: the shop is against the +X wall, so
      // the brooms face the room rather than along it.
      model.root.rotation.y = -Math.PI / 2;
      group.add(model.root);

      /*
       * THREE lines, because a broom is sold on three numbers.
       *
       * Speed is the income and Fly is the reach, and the second is the one
       * this game turns on - a player looking at the wall has to be able to
       * see that the next broom does not merely farm faster, it crosses gaps
       * the current one cannot. Putting them on one sign is what makes that a
       * comparison rather than a memory test.
       */
      const sign = new CanvasSign(10, 4.2, [
        {
          text: `+${formatSpeed(broom.speedPerStep)} Speed`,
          size: 1,
          fill: '#ffffff',
          stroke: '#1c1630',
        },
        {
          text: `${broom.flyCapacity}s FLY`,
          size: 0.78,
          fill: '#b48bff',
          stroke: '#1c1030',
        },
        {
          text:
            broom.winsRequired === 0
              ? 'FREE'
              : `${formatSpeed(broom.winsRequired)} Wins Required`,
          size: 0.58,
          fill: '#ffd54a',
          stroke: '#40320c',
        },
      ]);
      sign.mesh.position.set(0, STAND_ROW.height + HOVER_HEIGHT + 3.4, 0);
      sign.mesh.rotation.y = -Math.PI / 2;
      group.add(sign.mesh);

      this.root.add(group);
      this.stands.push({ slot: broom.slot, model, sign, top });
    }
  }

  /**
   * Light the stands the player already owns.
   *
   * Reads the REPLICATED mask and nothing else - the client never decides what
   * a player owns, it only shows what the server says.
   */
  setOwned(ownedMask: number): void {
    for (const stand of this.stands) {
      const owned = (ownedMask & (1 << (stand.slot - 1))) !== 0;
      stand.top.material = owned ? this.ownedMaterial : this.lockedMaterial;
    }
  }

  /** Bob and turn the display brooms, so the shop is not ten statues. */
  update(delta: number): void {
    this.time += delta;
    for (let i = 0; i < this.stands.length; i += 1) {
      const stand = this.stands[i];
      if (!stand) continue;
      // Each broom turns and bobs from its own offset, so the row is a line-up
      // rather than a chorus line.
      const offset = this.time + i * 0.7;
      stand.model.root.rotation.y = -Math.PI / 2 + Math.sin(offset * TURN_RATE) * 0.55;
      stand.model.root.rotation.z = Math.sin(offset * 0.8) * 0.09;
      stand.model.root.position.y =
        STAND_ROW.height + HOVER_HEIGHT + Math.sin(offset * 1.1) * 0.22;
    }
  }

  dispose(): void {
    for (const stand of this.stands) {
      stand.model.dispose();
      stand.sign.dispose();
    }
    this.stands.length = 0;
    this.baseMaterial.dispose();
    this.ownedMaterial.dispose();
    this.lockedMaterial.dispose();
    this.root.removeFromParent();
  }
}
