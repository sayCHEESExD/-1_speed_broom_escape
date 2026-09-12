import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Scene } from 'three';
import { PALETTE, WORLD_FOG } from '../config/worldVisuals.js';

/**
 * Bounce colour off the ground.
 *
 * Cold stone with a hint of the lava below it, not the previous game's bright
 * green meadow: the hemisphere light fills every downward-facing surface with
 * this, so a stale value tints the underside of the entire dungeon.
 */
const GROUND_BOUNCE = 0x3a3346;

/**
 * The scene root and the base lighting rig.
 *
 * Soft and simple on purpose. The art direction is flat toy-brick, so the
 * lighting exists to separate one face of a box from another and to lay a
 * shadow under each mount - not to model anything. A hemisphere fill, a low
 * ambient and a single key light is the whole rig.
 *
 * It is a DUNGEON, so the key is dimmer and the fill is cold, and what carries
 * the room instead is emission: the lava, the braziers, the torches and the
 * rune slabs are all lit materials. That is why the ambient is not simply
 * turned down to match the theme - the dark would swallow every unlit box in
 * the world, and most of the world is unlit boxes.
 */
export class SceneManager {
  readonly scene = new Scene();

  /** The sun. Exposed so its shadow camera can follow the player. */
  readonly sun: DirectionalLight;

  constructor() {
    this.scene.fog = new Fog(PALETTE.fog, WORLD_FOG.near, WORLD_FOG.far);
    this.setBackground();

    const hemi = new HemisphereLight(PALETTE.sky, GROUND_BOUNCE, 1.15);
    hemi.position.set(0, 60, 0);
    this.scene.add(hemi);

    this.scene.add(new AmbientLight(0xffffff, 0.42));

    this.sun = new DirectionalLight(0xffffff, 1.75);
    this.sun.position.set(34, 62, -24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 60;
    this.sun.shadow.camera.bottom = -60;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /**
   * Keep the shadow frustum over the player.
   *
   * The course is fifteen hundred units long and the shadow map is one texture.
   * A frustum big enough to cover the whole run would put a handful of texels
   * under each mount; moving a small frustum with the player keeps the shadows
   * crisp everywhere and costs one vector copy a frame.
   */
  followShadow(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + 34, y + 62, z - 24);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * The flat colour behind everything.
   *
   * A fallback only: the blocky sky dome covers the whole view, so this is
   * what shows for the one frame before it is added and behind anything the
   * dome's triangles miss at an extreme aspect ratio. Matched to the fog, so
   * even then the seam is invisible.
   */
  setBackground(color: number = PALETTE.fog): void {
    this.scene.background = new Color(color);
  }
}
