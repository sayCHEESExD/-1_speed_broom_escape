import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Scene } from 'three';
import { PALETTE, WORLD_FOG } from '../config/worldVisuals.js';

/**
 * Bounce colour off the ground.
 *
 * A warm pale lavender - the colour the vault's flagstones and the lit
 * masonry would throw back. The hemisphere light fills every downward-facing
 * surface with this, so it is what the undersides of the rune slabs, the
 * bars and the broom are painted in: a dark value here is exactly what made
 * the old dungeon read as a pit.
 */
const GROUND_BOUNCE = 0xc8b8f0;

/** The sky half of the hemisphere fill: a cool, bright blue-white. */
const SKY_FILL = 0xe4ecff;

/** The key light: a warm white, so lit faces read as sunny rather than grey. */
const KEY_COLOUR = 0xfff3e0;

/**
 * The scene root and the base lighting rig.
 *
 * Soft and simple on purpose. The art direction is flat toy-brick, so the
 * lighting exists to separate one face of a box from another and to lay a
 * shadow under each mount - not to model anything. A hemisphere fill, an
 * ambient and a single key light is the whole rig.
 *
 * It is BRIGHT: the fill is strong enough that no face in the world goes
 * near black, which keeps every shadow soft - a shadow is a darker shade of
 * the colour it falls on, never a hole in the floor. The magic on top of that
 * (lava, braziers, crystals, rune slabs, halos) is carried by emissive and
 * unlit materials rather than by extra lights, because every real light is a
 * per-pixel cost on every material in the world and this has to run on a
 * phone.
 */
export class SceneManager {
  readonly scene = new Scene();

  /** The sun. Exposed so its shadow camera can follow the player. */
  readonly sun: DirectionalLight;

  constructor() {
    this.scene.fog = new Fog(PALETTE.fog, WORLD_FOG.near, WORLD_FOG.far);
    this.setBackground();

    const hemi = new HemisphereLight(SKY_FILL, GROUND_BOUNCE, 1.05);
    hemi.position.set(0, 60, 0);
    this.scene.add(hemi);

    this.scene.add(new AmbientLight(0xffffff, 0.5));

    this.sun = new DirectionalLight(KEY_COLOUR, 1.45);
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
