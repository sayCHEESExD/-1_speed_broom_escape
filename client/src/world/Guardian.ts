import { GUARDIAN } from '@broom/shared';
import { Group, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { BoxSet } from '../broom/BoxSet.js';

/** How fast the rendered guardian eases toward its replicated transform. */
const FOLLOW_RATE = 12;

/** Distance past which it is placed rather than eased. */
const SNAP_DISTANCE = 30;

/**
 * Palette. Dark stone with lit eyes, so it belongs to the dungeon it guards.
 *
 * The glow is the important part: this thing lives in a hall lit by braziers,
 * and a creature the same colour as the masonry behind it is one a player
 * discovers by being hit. Two points of arcane light on the head are enough to
 * track it across the whole vault.
 */
const HIDE = 0x4a4658;
const HIDE_DARK = 0x35323f;
const TUSK = 0xd8d2c4;
const PAD = 0x24222c;
const EYE = 0xd46bff;

const shortestAngle = (from: number, to: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * The guardian of the vault.
 *
 * Built from the same `BoxSet` the rideable brooms use, so it is the same
 * material, the same blockiness and the same world. It is simply enormous -
 * the scale is the whole characterisation, and it is why it reads as a threat
 * without a single extra vertex of detail.
 *
 * It is also the reason that stage rewards a full meter: the guardian owns the
 * FLOOR, and the raised rubble around the hall is out of its reach. A player
 * who arrives with flight left crosses above it; one who does not is down
 * there with it.
 *
 * Its transform is REPLICATED, not derived: it chases, and that depends on
 * where the players are. The client eases toward whatever the server says and
 * animates a walk cycle from how far it actually moved, so the legs can never
 * be out of step with the travel.
 */
export class Guardian {
  readonly root = new Group();

  private readonly body = new Group();
  private readonly head = new Group();
  private readonly trunk = new Group();
  private readonly legs: Group[] = [];

  private readonly geometries: BufferGeometry[] = [];
  /*
   * One material, vertex-coloured, with a touch of emissive.
   *
   * The emissive is for the eyes and it costs the rest of the model almost
   * nothing: at this intensity the dark hide barely lifts while the violet
   * reads as lit, which is the cheapest possible way to get one glowing
   * feature without a second material and a second draw call for it.
   */
  private readonly material = new MeshLambertMaterial({
    vertexColors: true,
    emissive: 0x3a2a55,
    emissiveIntensity: 0.35,
  });

  private targetX = 0;
  private targetZ = 0;
  private targetYaw = 0;
  private placed = false;
  private phase = 0;
  private charging = false;

  constructor() {
    this.root.add(this.body);
    this.body.position.y = 9;

    // Barrel, head, ears, tusks and trunk. Five nodes total: the body, the
    // head, the trunk and four legs is all the articulation a blocky beast
    // this size needs.
    const barrel = new BoxSet();
    barrel.add([11, 9, 17], [0, 0, 0], HIDE);
    barrel.add([11.2, 3.2, 16], [0, -3.6, 0], HIDE_DARK);
    // A saddle-blanket of ruin colour, so it reads as belonging to the stage.
    barrel.add([9, 0.6, 7], [0, 4.6, -1], HIDE_DARK);
    barrel.add([2.2, 2.2, 5], [0, 2.5, -10], HIDE); // tail root
    this.body.add(this.mesh(barrel));

    const head = new BoxSet();
    head.add([8, 7.5, 6], [0, 0, 0], HIDE);
    // Ears: big flat plates, the fastest way to say "guardian" in boxes.
    head.addMirrored([1, 8, 7], [5, 0.5, -1], HIDE_DARK);
    /*
     * Eyes, and they are the one LIT thing on it.
     *
     * Arcane violet, the colour everything enchanted in this world glows -
     * which is what makes them readable across a hundred-unit hall lit only by
     * braziers. A dark creature in a dark room with no light on it is one the
     * player meets rather than sees coming, and a chaser the player cannot see
     * coming is a coin flip rather than a threat.
     */
    head.addMirrored([1.4, 1.4, 0.5], [2.2, 1.8, 3.1], EYE);
    head.addMirrored([0.6, 0.6, 0.4], [2.2, 1.8, 3.4], 0x1b1b22);
    // Tusks.
    head.addMirrored([0.9, 0.9, 4.5], [2.4, -2.6, 4], TUSK, [0.25, 0, 0]);
    this.head.position.set(0, 2.2, 9.5);
    this.head.add(this.mesh(head));
    this.body.add(this.head);

    const trunk = new BoxSet();
    trunk.add([3, 3, 3], [0, -1.5, 0.4], HIDE);
    trunk.add([2.5, 3, 2.5], [0, -4.2, 1], HIDE);
    trunk.add([2, 2.8, 2], [0, -6.6, 1.8], HIDE_DARK);
    trunk.add([1.7, 2.2, 1.7], [0, -8.6, 3], HIDE_DARK);
    this.trunk.position.set(0, -1.5, 3.2);
    this.trunk.add(this.mesh(trunk));
    this.head.add(this.trunk);

    const leg = new BoxSet();
    leg.add([3.6, 8, 3.6], [0, -4, 0], HIDE);
    leg.add([4, 1.2, 4], [0, -8.4, 0], PAD);
    const legGeometry = leg.build() as BufferGeometry;
    this.geometries.push(legGeometry);

    for (const [x, z] of [
      [4, 6],
      [-4, 6],
      [4, -6],
      [-4, -6],
    ] as const) {
      const hip = new Group();
      hip.position.set(x, -4.2, z);
      const mesh = new Mesh(legGeometry, this.material);
      mesh.castShadow = true;
      hip.add(mesh);
      this.body.add(hip);
      this.legs.push(hip);
    }

    this.root.position.set(0, GUARDIAN.shoulderY, (GUARDIAN.minZ + GUARDIAN.maxZ) / 2);
  }

  /** Copy the replicated transform in. Called on every patch. */
  apply(x: number, z: number, rotationY: number, charging: boolean): void {
    this.targetX = x;
    this.targetZ = z;
    this.targetYaw = rotationY;
    this.charging = charging;
  }

  update(delta: number): void {
    const dt = Math.max(0, delta);
    const position = this.root.position;

    const previousX = position.x;
    const previousZ = position.z;
    const gap = Math.hypot(this.targetX - previousX, this.targetZ - previousZ);

    if (!this.placed || gap > SNAP_DISTANCE) {
      position.x = this.targetX;
      position.z = this.targetZ;
      this.root.rotation.y = this.targetYaw;
      this.placed = true;
    } else {
      const alpha = 1 - Math.exp(-FOLLOW_RATE * dt);
      position.x += (this.targetX - position.x) * alpha;
      position.z += (this.targetZ - position.z) * alpha;
      this.root.rotation.y += shortestAngle(this.root.rotation.y, this.targetYaw) * alpha;
    }

    // The gait is driven by distance ACTUALLY covered, so the legs can never
    // be out of step with the travel however the interpolation lands.
    const travelled = Math.hypot(position.x - previousX, position.z - previousZ);
    this.phase = (this.phase + travelled / 5.5) % (Math.PI * 2);

    const swing = Math.sin(this.phase);
    const amplitude = this.charging ? 0.55 : 0.32;
    for (let i = 0; i < this.legs.length; i += 1) {
      const hip = this.legs[i];
      if (!hip) continue;
      // Diagonal pairs, as with the rideable brooms.
      const sign = i === 0 || i === 3 ? 1 : -1;
      hip.rotation.x = swing * amplitude * sign;
    }

    // The body rocks, the head bobs and the trunk swings - a charging guardian
    // should be doing something with all of itself.
    this.body.position.y = 9 + Math.cos(this.phase * 2) * (this.charging ? 0.5 : 0.25);
    this.body.rotation.z = swing * (this.charging ? 0.05 : 0.03);
    this.head.rotation.x = Math.cos(this.phase * 2) * 0.08;
    this.trunk.rotation.x = swing * (this.charging ? 0.45 : 0.2);
  }

  private mesh(set: BoxSet): Mesh {
    const geometry = set.build() as BufferGeometry;
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, this.material);
    mesh.castShadow = true;
    return mesh;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.material.dispose();
    this.root.removeFromParent();
  }
}
