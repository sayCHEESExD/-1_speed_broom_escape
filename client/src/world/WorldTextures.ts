import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Every texture in the game, drawn at runtime on a canvas.
 *
 * There is not one image file in this build's WORLD. The whole toy-brick
 * look - the flagstone ground, the dungeon masonry, the timber walkways, the
 * conjured rune slabs, the gold trophy pads and the cavern dark - costs a few
 * kilobytes of code and nothing at all against the 12 MB budget. The only
 * images anywhere are the supplied rider FBX and the three HUD icons.
 *
 * Textures are cached and shared: a caller asking twice gets the same GPU
 * upload, so the hundred-odd floor slabs of a six-stage course are one texture
 * between them.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /**
   * Bright grass with moulded studs.
   *
   * Square studs, not round: the reference art's ground is a brick baseplate,
   * and a circle reads as a different toy entirely.
   */
  grassStuds(color: string, highlight: string): Texture {
    return this.cached(`studs:${color}:${highlight}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      const cells = 4;
      const step = size / cells;
      const stud = step * 0.44;
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iz = 0; iz < cells; iz += 1) {
          const x = ix * step + (step - stud) / 2;
          const y = iz * step + (step - stud) / 2;
          // A shadow under and a lit face over: two rectangles is the whole
          // trick that makes a flat square read as a moulded stud.
          ctx.fillStyle = 'rgba(0,0,0,0.13)';
          ctx.fillRect(x, y + 2, stud, stud);
          ctx.fillStyle = highlight;
          ctx.fillRect(x, y, stud, stud);
        }
      }
      return ctx.canvas;
    });
  }

  /** Dungeon masonry, for the walls that box the whole course in. */
  brick(color: string, dark: string, speck: string): Texture {
    return this.cached(`brick:${color}:${dark}:${speck}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // Offset courses, so the wall reads as laid rather than as a flat panel.
      const rows = 8;
      const rowHeight = size / rows;
      ctx.fillStyle = dark;
      for (let r = 0; r < rows; r += 1) {
        ctx.fillRect(0, r * rowHeight + rowHeight - 2, size, 2);
      }
      for (let r = 0; r < rows; r += 1) {
        const offset = r % 2 === 0 ? 0 : size / 8;
        for (let c = 0; c < 4; c += 1) {
          ctx.fillRect(offset + c * (size / 4), r * rowHeight, 2, rowHeight);
        }
      }

      // The fine speckle the reference walls carry up close.
      ctx.fillStyle = speck;
      for (let i = 0; i < 260; i += 1) {
        const x = (i * 37) % size;
        const y = (i * 61) % size;
        ctx.fillRect(x, y, 2, 2);
      }
      return ctx.canvas;
    });
  }

  /** Wooden planks, for the bridges and the raised blocks. */
  planks(color: string, dark: string, speck: string): Texture {
    return this.cached(`planks:${color}:${dark}:${speck}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      const boards = 4;
      const boardHeight = size / boards;
      ctx.fillStyle = dark;
      for (let i = 0; i <= boards; i += 1) {
        ctx.fillRect(0, i * boardHeight - 1.5, size, 3);
      }

      ctx.fillStyle = speck;
      for (let i = 0; i < 300; i += 1) {
        const x = (i * 53) % size;
        const y = (i * 29) % size;
        ctx.fillRect(x, y, 2, 2);
      }
      return ctx.canvas;
    });
  }

  /** The gold chequer of a stage finish pad. */
  goldCheck(color: string, alt: string): Texture {
    return this.cached(`gold:${color}:${alt}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = alt;
      for (let y = 0; y < size; y += 32) {
        for (let x = 0; x < size; x += 32) {
          if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
        }
      }
      return ctx.canvas;
    });
  }

  /** Quicksand: coarse speckled sand, for the bottom of the sinking stages. */
  sand(color: string, dark: string): Texture {
    return this.cached(`sand:${color}:${dark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = dark;
      // A deterministic speckle - every client must draw the same sand.
      for (let i = 0; i < 420; i += 1) {
        const x = (i * 71) % size;
        const y = (i * 37) % size;
        ctx.fillRect(x, y, 3, 3);
      }
      // Slow ripples, so a flat plane still reads as a surface.
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(0, i * 32 + 10);
        ctx.bezierCurveTo(32, i * 32, 96, i * 32 + 20, size, i * 32 + 10);
        ctx.stroke();
      }
      return ctx.canvas;
    });
  }

  /**
   * A CONJURED RUNE SLAB: the surface this whole game is played on.
   *
   * Drawn rather than lit by geometry, because what makes it read as conjured
   * is the PATTERN - a bright border and a lattice of glyph marks inside it,
   * so the slab has a visible EDGE. That edge is the functional half: a player
   * committing a second of meter to a crossing is aiming at the far lip of one
   * of these, and an evenly-glowing tile gives them nothing to aim at.
   */
  runeSlab(color: string, edge: string): Texture {
    return this.cached(`rune:${color}:${edge}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);

      // The border. Two rings, so the edge has depth rather than being a
      // single stroke that disappears at a distance.
      ctx.strokeStyle = edge;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, size - 6, size - 6);
      ctx.lineWidth = 2;
      ctx.strokeRect(14, 14, size - 28, size - 28);

      // The glyph lattice. A FIXED pattern, never a random scatter: every
      // client has to draw the same slab, and a stage read differently by two
      // players in the same room is the one thing a shared world cannot do.
      ctx.strokeStyle = edge;
      ctx.lineWidth = 3;
      const marks: readonly (readonly number[])[] = [
        [30, 40, 64, 40, 64, 62],
        [98, 40, 98, 74, 74, 74],
        [30, 96, 54, 96, 54, 72],
        [76, 96, 100, 96],
        [46, 56, 46, 84],
      ];
      for (const mark of marks) {
        ctx.beginPath();
        ctx.moveTo(mark[0] as number, mark[1] as number);
        for (let i = 2; i < mark.length; i += 2) {
          ctx.lineTo(mark[i] as number, mark[i + 1] as number);
        }
        ctx.stroke();
      }
      return ctx.canvas;
    });
  }

  /** Weathered stone blocks, for the vaults and the ruined halls. */
  stone(color: string, dark: string): Texture {
    return this.cached(`stone:${color}:${dark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = dark;
      for (let r = 0; r < 4; r += 1) {
        ctx.fillRect(0, r * 32 + 30, size, 2);
        ctx.fillRect((r % 2 === 0 ? 0 : 64) + 30, r * 32, 2, 32);
      }
      // Chipped corners: a couple of dark flecks per block.
      for (let i = 0; i < 60; i += 1) {
        ctx.fillRect((i * 53) % size, (i * 29) % size, 3, 3);
      }
      return ctx.canvas;
    });
  }

  /**
   * The treadmill belt: chevrons that scroll along the belt's length.
   *
   * They point along U, not V. The belt's top face maps U to its long axis, so
   * a chevron drawn pointing "up" the canvas would run ACROSS the machine.
   */
  /**
   * Ice: a pale sheet with a few brighter cracks.
   *
   * Deliberately low-contrast. The stage's warning is the handling, not the
   * texture, and a busy floor under a mount that is already sliding is noise.
   */
  ice(color: string, bright: string): Texture {
    return this.cached(`ice:${color}:${bright}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = bright;
      ctx.lineWidth = 2;
      const cracks: readonly (readonly number[])[] = [
        [6, 10, 26, 22, 18, 44],
        [40, 4, 52, 26, 38, 58],
        [2, 52, 22, 60],
      ];
      for (const crack of cracks) {
        ctx.beginPath();
        ctx.moveTo(crack[0] as number, crack[1] as number);
        for (let i = 2; i < crack.length; i += 2) {
          ctx.lineTo(crack[i] as number, crack[i + 1] as number);
        }
        ctx.stroke();
      }
      return ctx.canvas;
    });
  }

  belt(base: string, mark: string): Texture {
    return this.cached(`belt:${base}:${mark}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = mark;
      for (let i = 0; i < 2; i += 1) {
        const base = i * 32;
        ctx.beginPath();
        ctx.moveTo(base + 22, 4);
        ctx.lineTo(base + 4, size / 2);
        ctx.lineTo(base + 22, size - 4);
        ctx.lineTo(base + 28, size - 4);
        ctx.lineTo(base + 10, size / 2);
        ctx.lineTo(base + 28, 4);
        ctx.closePath();
        ctx.fill();
      }
      return ctx.canvas;
    });
  }

  /**
   * The sky dome: a deep-to-bright blue gradient with painterly cumulus.
   *
   * Equirectangular, so `v` is latitude - 0 is straight up, 0.5 is the
   * horizon. The camera only ever sees a band around the middle, which is why
   * the gradient does its work there and the clouds are massed just above the
   * horizon rather than scattered evenly over the sphere.
   *
   * Clouds are built from soft radial blobs in two passes: a blue-grey
   * underside offset downward, then a white lit pass over it. That one trick
   * is most of the difference between "circles" and "clouds" - a flat white
   * disc reads as a sticker, a shaded one reads as volume.
   *
   * Used as `scene.background` rather than a sky dome mesh: three renders it
   * as a true background, which costs no draw call and cannot be culled.
   */
  sky(): Texture {
    const texture = this.cached(
      'sky',
      () => {
        const width = 1536;
        const height = 768;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#1a7fe0');
        gradient.addColorStop(0.22, '#2f9bf0');
        gradient.addColorStop(0.4, '#57b7f8');
        gradient.addColorStop(0.52, '#8fd6ff');
        gradient.addColorStop(0.62, '#c8edff');
        gradient.addColorStop(0.76, '#7ec8f7');
        gradient.addColorStop(1, '#3b96e2');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        const random = seeded(20260908);
        const layers: CloudLayer[] = [
          { count: 30, minV: 0.2, maxV: 0.44, scale: 28, squash: 0.4, alpha: 0.45, shade: 0.16 },
          { count: 26, minV: 0.34, maxV: 0.54, scale: 46, squash: 0.52, alpha: 0.78, shade: 0.38 },
          { count: 18, minV: 0.46, maxV: 0.63, scale: 68, squash: 0.6, alpha: 0.95, shade: 0.55 },
        ];

        for (const layer of layers) {
          for (let i = 0; i < layer.count; i += 1) {
            const x = random() * width;
            const y = height * (layer.minV + random() * (layer.maxV - layer.minV));
            const scale = layer.scale * (0.65 + random() * 0.8);
            // Drawn again either side of the seam when it is close to one, so
            // a cloud is never sliced in half where the texture wraps.
            drawCloud(ctx, x, y, scale, layer, random);
            if (x < scale * 3) drawCloud(ctx, x + width, y, scale, layer, random);
            else if (x > width - scale * 3) drawCloud(ctx, x - width, y, scale, layer, random);
          }
        }

        return canvas;
      },
      false,
    );

    texture.mapping = EquirectangularReflectionMapping;
    return texture;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement, repeat = true): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    if (repeat) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }
}

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};

/** Tuning for one depth of cloud. */
interface CloudLayer {
  readonly count: number;
  /** Latitude band the layer occupies, 0 = zenith, 0.5 = horizon. */
  readonly minV: number;
  readonly maxV: number;
  readonly scale: number;
  /** Vertical squash. Cumulus near the horizon are far wider than tall. */
  readonly squash: number;
  readonly alpha: number;
  /** How strongly the underside is shaded, 0..1. */
  readonly shade: number;
}

/**
 * One cumulus: a row of lobes that billow in the middle and flatten at the
 * base, drawn shaded then lit.
 */
const drawCloud = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  layer: CloudLayer,
  random: () => number,
): void => {
  const lobes = 7 + Math.floor(random() * 5);

  // The layout is generated once and drawn twice, so the shaded pass and the
  // lit pass are the same shape rather than two different clouds.
  const shape: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < lobes; i += 1) {
    const t = lobes === 1 ? 0.5 : i / (lobes - 1);
    const bulge = Math.sin(t * Math.PI);
    shape.push({
      x: (t - 0.5) * scale * 3.2,
      y: -bulge * scale * (0.3 + random() * 0.45) + (random() - 0.5) * scale * 0.2,
      r: scale * (0.32 + bulge * 0.5 + random() * 0.2),
    });
  }
  // A flat-ish base, so the cloud sits on a line instead of floating.
  const baseLobes = 3 + Math.floor(random() * 3);
  for (let i = 0; i < baseLobes; i += 1) {
    const t = baseLobes === 1 ? 0.5 : i / (baseLobes - 1);
    shape.push({
      x: (t - 0.5) * scale * 2.6,
      y: scale * 0.12,
      r: scale * (0.35 + random() * 0.22),
    });
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, layer.squash);

  if (layer.shade > 0.01) {
    for (const lobe of shape) {
      softBlob(
        ctx,
        lobe.x,
        lobe.y + scale * 0.3,
        lobe.r,
        '150,190,225',
        layer.alpha * layer.shade,
      );
    }
  }
  for (const lobe of shape) {
    softBlob(ctx, lobe.x, lobe.y, lobe.r, '255,255,255', layer.alpha);
  }

  ctx.restore();
};

/**
 * A soft-edged blob.
 *
 * The gradient is what makes a cloud painterly: a plain filled circle gives a
 * hard rim that reads as a sticker however many you overlap.
 */
const softBlob = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rgb: string,
  alpha: number,
): void => {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(0.6, `rgba(${rgb},${alpha * 0.82})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
};

/** Deterministic PRNG, so every client renders exactly the same sky. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
