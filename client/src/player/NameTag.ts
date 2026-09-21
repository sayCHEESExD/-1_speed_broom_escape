import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { cleanDisplayName } from '@broom/shared';

/** Canvas pixels per world unit of tag height. */
const PX_PER_UNIT = 128;

/** Height of the tag in world units. Readable a few broom-lengths away. */
const TAG_HEIGHT = 0.62;

/** Longest a tag may get, in world units, however long the name. */
const MAX_WIDTH = 5.2;

const FONT = '"Arial Black", "Arial Bold", Arial, system-ui, sans-serif';

/**
 * The name floating over a rider: their Bloxity display name, and nothing
 * else - never an id.
 *
 * A camera-facing sprite on a canvas texture, drawn in the same heavy white
 * type with a dark rim as every other piece of text in the game, so it reads
 * over bright stone and dark sky alike. Redrawn only when the NAME changes,
 * never per frame.
 *
 * Depth-tested like the world around it: a name does not show through walls,
 * which would make a stage's hidden routes readable from the start of it.
 */
export class NameTag {
  readonly sprite: Sprite;

  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private name = '\u0000';

  constructor() {
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.material = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new Sprite(this.material);
    // Drawn after the opaque world, so its soft edge blends over it.
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  /** Show this name. An empty name hides the tag. */
  setName(raw: string): void {
    const name = cleanDisplayName(raw);
    if (name === this.name) return;
    this.name = name;
    this.sprite.visible = name.length > 0;
    if (name) this.draw(name);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.sprite.removeFromParent();
  }

  private draw(name: string): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const height = Math.round(TAG_HEIGHT * PX_PER_UNIT);
    let size = height * 0.72;
    const rim = () => size * 0.2;
    ctx.font = `900 ${size}px ${FONT}`;
    // Shrunk to fit rather than clipped: the name is the one field whose
    // length is not ours to choose.
    const maxPx = MAX_WIDTH * PX_PER_UNIT;
    const measured = ctx.measureText(name).width + rim() * 2;
    if (measured > maxPx) size *= maxPx / measured;
    ctx.font = `900 ${size}px ${FONT}`;
    const width = Math.ceil(Math.min(ctx.measureText(name).width + rim() * 2 + 8, maxPx));

    this.canvas.width = width;
    this.canvas.height = height;
    // Resizing a canvas resets its context state.
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = rim();
    ctx.strokeStyle = '#12181f';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(name, width / 2, height / 2);
    ctx.fillText(name, width / 2, height / 2);

    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.sprite.scale.set((width / height) * TAG_HEIGHT, TAG_HEIGHT, 1);
  }
}
