import { MOUNT_HEIGHT, broomForSlot, type BroomAnimationState } from '@broom/shared';
import { Group, Mesh, Object3D } from 'three';
import { BroomModel } from '../broom/BroomModel.js';
import { BroomAnimator } from '../animation/BroomAnimator.js';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { RiderAnimator } from '../animation/RiderAnimator.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { PLAYER_MODEL_YAW_OFFSET } from '../config/worldVisuals.js';
import { playerModelLoader } from './PlayerModelLoader.js';
import { NameTag } from './NameTag.js';
import { TrailEffect } from './TrailEffect.js';

/** Gap between the top of the rider's head and their name tag, in world units. */
const NAME_TAG_CLEARANCE = 0.85;

/**
 * One player: an broom, and the person riding it.
 *
 * The node hierarchy is what makes riding correct, and it is deliberately the
 * only mechanism - there is no per-frame "copy the broom's transform onto the
 * rider" step, because a copy is always a frame late and always slides.
 *
 *   root                    the SIMULATION's transform: position and yaw
 *     broom.root
 *       scaled              the species' scale
 *         body              bob, pitch, roll (the animator writes this)
 *           legs, head, tail
 *           riderAnchor     counter-scaled, so the person stays person-sized
 *             riderVisual   the rider's own posting bob
 *               model       the cloned player FBX
 *
 * Because the rider hangs off the broom's BODY node, it inherits every bit of
 * the gait for free: it cannot clip through the saddle, cannot float above it
 * and cannot slide during movement, whatever the broom does.
 */
export class Mount {
  /** Attach this to the scene. Its transform is the mount's transform. */
  readonly root = new Group();

  /**
   * World-space effects that must NOT follow the mount.
   *
   * A trail is where the player has ALREADY been, so it cannot be parented to
   * a moving root. Whoever adds `root` to the scene adds this too.
   */
  readonly worldRoot = new Group();

  /** The ribbon the equipped trail leaves behind. */
  readonly trail = new TrailEffect();

  /**
   * The player's Bloxity display name, floating over the rider. Created on the
   * first non-empty name, so a mount nobody has named carries no sprite.
   */
  private nameTag: NameTag | null = null;

  broom: BroomModel;
  broomAnimator: BroomAnimator;
  /**
   * Rebuilt when the RIDER is swapped, which is why neither is readonly.
   *
   * A Bloxity avatar is a different model with a different skeleton object, and
   * `PlayerRig` binds to the bones it was handed at construction - so a swap
   * has to rebuild both rather than repoint them.
   */
  riderAnimator: RiderAnimator;
  rig: PlayerRig;

  /** Carries the rider's posting bob. Never the physics transform. */
  private readonly riderVisual = new Group();
  private riderModel: Object3D;

  /**
   * The rider's own nodes, for the Bloxity cosmetics layer.
   *
   * Read-only handles rather than a `dressWith(...)` method: this class owns
   * the mount, not the player's account, and a cosmetics system that had to be
   * taught about here would be one more thing to keep in step. The avatar
   * module hangs items off the BONES inside the model and scales the visual
   * group; nothing it does changes what this class believes.
   */
  get rider(): { visual: Group; model: Object3D } {
    return { visual: this.riderVisual, model: this.riderModel };
  }

  /** Slot currently built, so a re-equip only rebuilds when it must. */
  private slot: number;

  constructor(slot: number) {
    this.slot = Math.floor(slot);
    this.broom = new BroomModel(broomForSlot(this.slot));
    this.root.add(this.broom.root);

    this.riderModel = playerModelLoader.createInstance();
    // player.fbx already faces +Z; the offset exists so a re-authored model
    // can be corrected without touching gameplay code.
    this.riderModel.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.riderVisual.add(this.riderModel);
    this.broom.riderAnchor.add(this.riderVisual);

    // Bind against the model's own space, so the rig is independent of where
    // the mount stands or which way it faces.
    this.rig = new PlayerRig(this.riderModel, this.riderModel);
    this.broomAnimator = new BroomAnimator(this.broom);
    this.riderAnimator = new RiderAnimator(this.rig, this.riderVisual);
    this.worldRoot.add(this.trail.root);
  }

  /**
   * Swap the rider, keeping the same mount.
   *
   * The mirror of `setBroomSlot`, and for the same reason: the two halves are
   * independent, so dressing a player as their Bloxity avatar must not disturb
   * the broom they are sitting on, its gait, or where it is standing.
   *
   * Passing null restores the bundled default character, which is what a sign
   * out and every failed asset load resolve to.
   *
   * The rig and the rider animator are REBUILT rather than repointed: both are
   * bound to specific `Bone` objects, and the incoming model has its own. The
   * bind is by NAME and the rest pose is read off whichever model arrives, so
   * the Bloxity skeleton and `player.fbx` are equally valid inputs.
   */
  setRider(model: Object3D | null): void {
    const next = model ?? playerModelLoader.createInstance();
    if (next === this.riderModel) return;

    const previous = this.riderModel;
    previous.removeFromParent();
    releaseRider(previous);

    this.riderModel = next;
    next.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    this.riderVisual.add(next);

    this.rig = new PlayerRig(next, next);
    this.riderAnimator = new RiderAnimator(this.rig, this.riderVisual);
  }

  /** Show the trail the server says this player is wearing. Cosmetic only. */
  setTrailSlot(slot: number): void {
    this.trail.setSlot(slot);
  }

  /**
   * Advance the world-space effects.
   *
   * Separate from `update` because the trail needs the mount's world position
   * and speed, which the animation input does not carry.
   */
  updateEffects(delta: number, x: number, y: number, z: number, speed: number): void {
    this.trail.update(delta, x, y, z, speed);
  }

  /** The broom the server says this player is riding. */
  get broomSlot(): number {
    return this.slot;
  }

  /**
   * Swap the broom, keeping the same rider.
   *
   * Rebuilds only the broom half: the FBX clone, its rig and its animator are
   * expensive and completely independent of which species is underneath, so
   * they are re-parented rather than recreated. Claiming a new broom is
   * therefore instant and cannot drop the rider's pose.
   */
  setBroomSlot(slot: number): void {
    const next = Math.floor(slot);
    if (next === this.slot) return;
    this.slot = next;

    this.riderVisual.removeFromParent();
    this.broom.dispose();

    this.broom = new BroomModel(broomForSlot(next));
    this.root.add(this.broom.root);
    this.broom.riderAnchor.add(this.riderVisual);

    this.broomAnimator = new BroomAnimator(this.broom);
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /**
   * Scale the whole mount, for the death squash and the arrival pop.
   *
   * Written to `broom.root` rather than to `root`, which is the physics
   * transform gameplay owns - the same rule that stops the animators moving
   * the player.
   */
  setVisualScale(x: number, y: number, z: number): void {
    this.broom.root.scale.set(x, y, z);
  }

  /**
   * Advance both animators.
   *
   * The broom runs first and hands the rider its sway phase AND its climb
   * blend, so the two move to one cycle rather than to two clocks that drift
   * apart.
   */
  update(delta: number, input: AnimationInput): void {
    this.broomAnimator.update(delta, input);
    // The broom's own climb blend goes to the rider rather than the rider
    // re-deriving one: two eases from one boolean would drift by a frame, and
    // the frame they drift on is the takeoff everybody is looking at.
    this.riderAnimator.update(
      delta,
      input,
      this.broomAnimator.gaitPhase,
      this.broomAnimator.climbBlend,
    );
  }

  /**
   * Show this player's name over the rider - the Bloxity display name the
   * server replicated, and nothing else. '' hides it.
   */
  setName(name: string): void {
    if (!this.nameTag) {
      if (!name) return;
      this.nameTag = new NameTag();
      // On the ROOT, not the broom's body: a name that bobbed and pitched
      // with the broom would be hard to read and would swim on screen.
      this.nameTag.sprite.position.y = MOUNT_HEIGHT + NAME_TAG_CLEARANCE;
      this.root.add(this.nameTag.sprite);
    }
    this.nameTag.setName(name);
  }

  get animationState(): BroomAnimationState {
    return this.broomAnimator.currentState;
  }

  /** Height of the whole silhouette, for floating labels. */
  get height(): number {
    return this.broom.height;
  }

  /** Clear animation state, e.g. after a server-issued respawn. */
  resetAnimation(): void {
    this.broomAnimator.reset();
    this.riderAnimator.reset();
    this.broom.root.scale.set(1, 1, 1);
    // The ribbon describes a run that no longer exists; keeping it would draw
    // a line from wherever the player died to wherever they came back.
    this.trail.clear();
  }

  dispose(): void {
    this.broom.dispose();
    this.trail.dispose();
    this.nameTag?.dispose();
    this.root.removeFromParent();
    this.worldRoot.removeFromParent();
  }
}

/**
 * Let go of a rider that has been swapped out.
 *
 * ONLY its material, and only when the rider was one this game built for a
 * Bloxity avatar. Geometry is deliberately left alone: part meshes are cached
 * and shared between every player wearing the same item, so disposing one
 * here would empty the arms of everybody else in the room. A default rider
 * shares even its material with every other default rider, which is why the
 * flag is checked rather than assumed.
 */
const releaseRider = (model: Object3D): void => {
  if (model.userData['bloxityRider'] !== true) return;
  model.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};
