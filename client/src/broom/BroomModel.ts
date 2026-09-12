import { BROOM_RIDE_HEIGHT, broomForSlot, type BroomDefinition } from '@broom/shared';
import { Group, Mesh, MeshLambertMaterial } from 'three';
import { broomParts, type BroomParts } from './BroomGeometry.js';

/**
 * TWO materials for every broom in the scene.
 *
 * Colour lives in the vertices, so a twig bundle and a void comet are the same
 * draw state - which is what lets the shop show ten brooms without ten
 * material uploads. Lambert rather than Standard: the art direction is flat
 * and unlit-looking, and a PBR shader would spend its whole cost on roughness
 * the style deliberately does not have.
 *
 * The second material is the GLOW, and it exists because an enchantment drawn
 * as a merely bright vertex colour reads as paint. Emissive on the whole model
 * would flatten the shaft into a slab of light, so the lit parts are their own
 * geometry with their own material and nothing else changes.
 */
let sharedMaterial: MeshLambertMaterial | null = null;
let sharedGlowMaterial: MeshLambertMaterial | null = null;

const material = (): MeshLambertMaterial => {
  sharedMaterial ??= new MeshLambertMaterial({ vertexColors: true });
  return sharedMaterial;
};

const glowMaterial = (): MeshLambertMaterial => {
  sharedGlowMaterial ??= new MeshLambertMaterial({
    vertexColors: true,
    emissive: 0xffffff,
    emissiveIntensity: 0.85,
  });
  return sharedGlowMaterial;
};

/**
 * A built, animatable broom.
 *
 * The node tree is the animation contract: `BroomAnimator` writes to these
 * nodes and to nothing else, and the simulation writes only to `root`. That
 * separation is why an animation can never move the player.
 *
 *   root           placed by gameplay: world position and facing
 *     scaled       the broom's uniform scale
 *       body       bob, PITCH (the nose-up climb) and bank. Everything hangs
 *                  off this.
 *         shaft, collar, pegs, enchantments
 *         bristles stream, flare and flutter
 *         rider    where the player model is parented, counter-scaled
 */
export class BroomModel {
  /** Attach this to the scene, or to a mount. Gameplay owns its transform. */
  readonly root = new Group();

  /**
   * Carries the broom's bob, pitch and bank.
   *
   * THE node the two flight animations are told apart on: a level `body` is
   * cruising and a nose-up one is climbing, and because the rider hangs off it
   * the whole silhouette tilts together rather than a stick rotating under a
   * person who stayed upright.
   */
  readonly body = new Group();

  /** The bristle bundle. Streams, flares and flutters. */
  readonly bristles = new Group();

  /**
   * Where the rider is parented.
   *
   * A child of `body`, so the rider inherits the bob, the pitch and the bank
   * for free and can never drift off the seat. Counter-scaled by the broom's
   * own scale, so a bigger broom does not also produce a bigger person.
   */
  readonly riderAnchor = new Group();

  readonly definition: BroomDefinition;
  readonly parts: BroomParts;

  /** The lit parts, kept so the animator can pulse them under thrust. */
  private readonly glowMesh: Mesh | null;

  private readonly scaled = new Group();

  constructor(definition: BroomDefinition) {
    this.definition = definition;
    this.parts = broomParts(definition);

    this.root.add(this.scaled);
    /*
     * THE HOVER, and it belongs here rather than in the animator.
     *
     * `root` is the simulation's transform and its `y` is the GROUND CONTACT
     * LINE - what a platform's top is compared against. A broom does not touch
     * the ground with it, so the whole model is lifted clear of it once, at
     * build time, and everything below inherits that: the shaft, the bristles
     * and the rider parented to the body.
     *
     * Written to `scaled` rather than to `root` for the same reason every
     * other visual is: `root` is gameplay's, and a renderer that moved it
     * would be a second physics system.
     */
    this.scaled.position.y = BROOM_RIDE_HEIGHT;
    this.scaled.scale.setScalar(definition.scale);
    this.scaled.add(this.body);

    this.body.add(mesh(this.parts.body));

    this.bristles.position.set(...this.parts.bristleBase);
    this.bristles.add(mesh(this.parts.bristles));
    this.body.add(this.bristles);

    if (this.parts.glow) {
      this.glowMesh = new Mesh(this.parts.glow, glowMaterial());
      this.body.add(this.glowMesh);
    } else {
      this.glowMesh = null;
    }

    // The seat, expressed from the broom's own origin in the roster and used
    // here unchanged - `body` sits at the seat, so `riderOffset` is already in
    // this node's space.
    const offset = definition.riderOffset;
    this.riderAnchor.position.set(offset.x, offset.y, offset.z);
    this.riderAnchor.scale.setScalar(1 / definition.scale);
    this.body.add(this.riderAnchor);
  }

  /** Height from the ground line to the top of the shaft, for labels. */
  get height(): number {
    return BROOM_RIDE_HEIGHT + this.parts.height * this.definition.scale;
  }

  /**
   * Brighten the enchantment, 0..1.
   *
   * The one visual the ANIMATOR drives that is not a transform, and it earns
   * the exception: thrust is otherwise only legible from the attitude, and a
   * broom seen head-on has no attitude to read. Silently does nothing on a
   * broom with no lit parts, so a starter twig bundle needs no special case.
   */
  setGlow(amount: number): void {
    if (!this.glowMesh) return;
    const clamped = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    // Written on the MESH's own material instance only if one exists - the
    // shared material is never mutated, or every broom in the room would
    // flare whenever anybody took off.
    const target = this.glowMesh.material as MeshLambertMaterial;
    if (target === sharedGlowMaterial) {
      this.glowMesh.material = target.clone();
    }
    (this.glowMesh.material as MeshLambertMaterial).emissiveIntensity =
      0.6 + clamped * 1.3;
  }

  /** Reset every animated node to its rest pose. */
  resetPose(): void {
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    this.bristles.position.set(...this.parts.bristleBase);
    this.bristles.rotation.set(0, 0, 0);
    this.setGlow(0);
  }

  /**
   * Meshes are cheap and geometry is shared, so disposal only unhooks the
   * scene graph. The cached per-broom geometry outlives every instance and is
   * released by `disposeBroomGeometry`.
   */
  dispose(): void {
    // The cloned glow material is this instance's own, so it is this
    // instance's to release.
    const glow = this.glowMesh?.material as MeshLambertMaterial | undefined;
    if (glow && glow !== sharedGlowMaterial) glow.dispose();
    this.root.removeFromParent();
  }
}

/** A fresh broom for a replicated slot. Never throws on an unknown slot. */
export const broomModelForSlot = (slot: number): BroomModel =>
  new BroomModel(broomForSlot(slot));

const mesh = (geometry: BroomParts['body']): Mesh => {
  const node = new Mesh(geometry, material());
  node.castShadow = true;
  node.receiveShadow = true;
  return node;
};
