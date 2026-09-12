import type { BroomDefinition, BroomShape } from '@broom/shared';
import type { BufferGeometry } from 'three';
import { BoxSet } from './BoxSet.js';

/**
 * ONE generic broom builder, driven entirely by the roster's `shape`,
 * `palette` and `features`.
 *
 * There is deliberately no per-broom modelling code: a school besom and a
 * racing comet are the same dozen boxes at different sizes with different
 * enchantments bolted on. That is what makes an eleventh broom a data entry
 * rather than a renderer change - and it is why every broom in the game looks
 * like it belongs in the same world.
 *
 * Coordinates are BROOM SPACE: origin at the seat, +Y up, +Z forward (the way
 * the broom points). Each returned geometry is expressed in its own part's
 * local space so it can be hung off an animated node.
 */

/**
 * Geometry and joint offsets for one broom.
 *
 * Built once and shared by every instance of that broom in the scene, which is
 * what makes a ten-stand shop about two dozen meshes rather than two hundred.
 */
export interface BroomParts {
  /**
   * The shaft, the collar, the pegs and every enchantment on them.
   *
   * Origin at the BODY node, which sits at the seat: the shaft runs forward
   * along +Z and back along -Z from there, so pitching the body about X is
   * exactly the nose-up attitude the ascending animation wants and needs no
   * offset of its own.
   */
  readonly body: BufferGeometry;
  /**
   * The bristle bundle. Origin at the collar, extending back along -Z.
   *
   * A separate part because it is the one thing on a broom that MOVES: it
   * streams out behind a cruise, flares under thrust and hangs when hovering,
   * and all three are a rotation of this node.
   */
  readonly bristles: BufferGeometry;
  /**
   * The lit parts: the nose ember, the rune bands, the vent flames.
   *
   * Split out so they can carry an emissive material while the wood stays
   * ordinary Lambert - a broom whose glow is merely a bright vertex colour
   * reads as painted, not enchanted, and emissive on the whole model would
   * flatten the shaft into a slab of light.
   */
  readonly glow: BufferGeometry | null;

  /** Where the bristle node hangs, in BODY-node local space. */
  readonly bristleBase: readonly [number, number, number];
  /** The seat, in BODY-node local space. Always the origin; named for clarity. */
  readonly seatY: number;
  /** Total length nose to bristle tip, for label placement and framing. */
  readonly length: number;
  /** Height of the whole silhouette, rider excluded. */
  readonly height: number;
}

/** Cache keyed by broom id. Ten brooms, built once each, shared forever. */
const CACHE = new Map<string, BroomParts>();

/** Geometry for one broom, built on first use. */
export const broomParts = (definition: BroomDefinition): BroomParts => {
  const cached = CACHE.get(definition.id);
  if (cached) return cached;
  const built = build(definition);
  CACHE.set(definition.id, built);
  return built;
};

/**
 * Release every cached geometry.
 *
 * Only for a full teardown. Instances share these, so disposing while any
 * broom is still on screen empties it.
 */
export const disposeBroomGeometry = (): void => {
  for (const parts of CACHE.values()) {
    parts.body.dispose();
    parts.bristles.dispose();
    parts.glow?.dispose();
  }
  CACHE.clear();
};

/**
 * The shaft: a run of short segments that taper toward the nose.
 *
 * Segments rather than one long box, because a taper is the single strongest
 * signal that a stick is a flying broom rather than a fence post, and a box
 * cannot taper. Six of them is enough to read as smooth at the distance a
 * third-person camera ever sees it from.
 */
const SHAFT_SEGMENTS = 6;

const build = (definition: BroomDefinition): BroomParts => {
  const shape = definition.shape;
  const palette = definition.palette;
  const features = new Set(definition.features);

  const body = new BoxSet();
  const bristles = new BoxSet();
  const glow = new BoxSet();

  // The shaft runs from the collar at -Z forward to the nose at +Z. The seat
  // is the origin, set back from centre so the rider sits over the bundle
  // rather than astride the middle of the stick.
  const tailZ = -shape.shaftLength * 0.38;
  const noseZ = shape.shaftLength * 0.62;
  const run = noseZ - tailZ;
  const segment = run / SHAFT_SEGMENTS;

  for (let i = 0; i < SHAFT_SEGMENTS; i += 1) {
    const t = (i + 0.5) / SHAFT_SEGMENTS;
    // Thickness falls from full at the collar to `shaftTaper` at the nose.
    const thickness = shape.shaftThickness * (1 - t * (1 - shape.shaftTaper));
    const z = tailZ + segment * (i + 0.5);
    body.add([thickness, thickness, segment * 1.02], [0, 0, z], palette.wood);
    // A darker strip along the underside, so the shaft has a lit top and a
    // shaded belly without a second material or a normal map.
    body.add(
      [thickness * 0.72, thickness * 0.3, segment * 1.02],
      [0, -thickness * 0.5, z],
      palette.woodDark,
    );
    if (features.has('runes') && i % 2 === 1) {
      glow.add(
        [thickness * 1.12, thickness * 1.12, segment * 0.22],
        [0, 0, z],
        palette.glow,
      );
    }
    if (features.has('barbs')) {
      body.add(
        [thickness * 0.4, thickness * 0.7, segment * 0.3],
        [0, thickness * 0.62, z],
        palette.bind,
        [0.3, 0, 0],
      );
    }
  }

  // The seat: a small saddle pad, so the rider is sitting on something.
  body.add(
    [shape.shaftThickness * 2.1, shape.seatHeight, shape.shaftThickness * 4.2],
    [0, shape.seatHeight * 0.5, 0],
    palette.bind,
  );

  // The binding collar between shaft and bundle.
  body.add(
    [shape.bindWidth, shape.bindWidth, shape.bindLength],
    [0, 0, tailZ + shape.bindLength * 0.4],
    palette.bind,
  );

  // Footrest pegs, out to each side and a little below the shaft.
  body.addMirrored(
    [shape.pegSpread * 1.4, shape.shaftThickness * 0.45, shape.shaftThickness * 0.8],
    [shape.pegSpread * 0.8, -shape.shaftThickness * 0.5, shape.pegZ],
    palette.bind,
  );
  body.addMirrored(
    [shape.shaftThickness * 0.6, shape.shaftThickness * 0.55, shape.shaftThickness * 1.5],
    [shape.pegSpread * 1.45, -shape.shaftThickness * 0.75, shape.pegZ],
    palette.woodDark,
  );

  // The nose ember: the light that makes a broom a magical object and not a
  // stick. Drawn as a small stack rather than a sphere, in keeping with
  // everything else in this world being boxes.
  if (shape.emberRadius > 0) {
    const r = shape.emberRadius;
    glow.add([r * 1.6, r * 1.6, r * 1.6], [0, 0, noseZ + r], palette.glow);
    glow.add([r * 0.9, r * 0.9, r * 2.4], [0, 0, noseZ + r * 1.8], palette.glow);
  }

  if (features.has('crystal')) {
    const r = Math.max(0.18, shape.emberRadius);
    glow.add([r * 1.1, r * 2.2, r * 1.1], [0, -r * 1.8, noseZ * 0.68], palette.glow, [0, 0, 0.4]);
    body.add([r * 1.4, r * 0.5, r * 1.4], [0, -r * 0.8, noseZ * 0.68], palette.bind);
  }

  if (features.has('pennant')) {
    for (let i = 0; i < 3; i += 1) {
      body.add(
        [0.06, 0.5 - i * 0.1, 0.7],
        [0, 0.55 + i * 0.04, tailZ + 1.1 + i * 0.7],
        palette.bristleTip,
        [0, 0, 0.12 * (i % 2 === 0 ? 1 : -1)],
      );
    }
    body.add([0.08, 0.7, 0.08], [0, 0.35, tailZ + 1.1], palette.bind);
  }

  if (features.has('wings')) {
    for (let i = 0; i < 3; i += 1) {
      body.addMirrored(
        [0.9 - i * 0.22, 0.1, 0.55],
        [0.5 + i * 0.36, 0.12 + i * 0.1, tailZ + 0.9],
        palette.bristleTip,
        [0, 0.3, 0.38 + i * 0.12],
      );
    }
  }

  if (features.has('halo')) {
    const ring = 10;
    for (let i = 0; i < ring; i += 1) {
      const angle = (i / ring) * Math.PI * 2;
      glow.add(
        [0.14, 0.14, 0.3],
        [Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, noseZ * 0.3],
        palette.glow,
        [0, 0, angle],
      );
    }
  }

  if (features.has('vents')) {
    for (const side of [-1, 1]) {
      body.add(
        [0.26, 0.26, 0.5],
        [side * (shape.bindWidth * 0.7), -0.1, tailZ + 0.2],
        palette.bind,
      );
      glow.add(
        [0.2, 0.2, 0.5],
        [side * (shape.bindWidth * 0.7), -0.1, tailZ - 0.35],
        palette.glow,
      );
    }
  }

  buildBundle(bristles, shape, palette, 0, 1);
  if (features.has('doubleTail')) {
    buildBundle(bristles, shape, palette, 0.34, 0.62);
  }

  const bodyGeometry = body.build();
  const bristleGeometry = bristles.build();
  if (!bodyGeometry || !bristleGeometry) {
    throw new Error(`broom ${definition.id} built no geometry`);
  }

  return {
    body: bodyGeometry,
    bristles: bristleGeometry,
    glow: glow.isEmpty ? null : glow.build(),
    bristleBase: [0, 0, tailZ],
    seatY: 0,
    length: run + shape.bristleLength,
    height: shape.shaftThickness + shape.seatHeight + shape.bristleRadius * 2,
  };
};

/**
 * A bundle of bristles, splayed around the shaft's axis.
 *
 * Built in the BRISTLE node's own space, where the origin is the collar and
 * the bundle runs back along -Z - so the animator's flare is one rotation of
 * that node and needs no knowledge of how the slats were laid out.
 *
 * @param lift   how far up the bundle is stacked, for a second tail
 * @param scale  size against the authored bundle
 */
const buildBundle = (
  set: BoxSet,
  shape: BroomShape,
  palette: BroomDefinition['palette'],
  lift: number,
  scale: number,
): void => {
  const count = Math.max(4, Math.round(shape.bristleCount * scale));
  const length = shape.bristleLength * scale;
  const radius = shape.bristleRadius * scale;

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    // The bundle is fat at the collar and fans out toward the tips, which is
    // what stops it reading as a cylinder glued to the end of a stick.
    const spread = radius * 0.9;
    const x = Math.cos(angle) * spread * 0.45;
    const y = Math.sin(angle) * spread * 0.45 + lift;
    set.add(
      [radius * 0.3, radius * 0.3, length],
      [x, y, -length * 0.5],
      palette.bristle,
      // Splayed outward from the axis, so the tips are wider than the root.
      [Math.sin(angle) * 0.2, -Math.cos(angle) * 0.2, 0],
    );
    // The tip, a shade brighter, so a bundle has depth in flat lighting.
    set.add(
      [radius * 0.34, radius * 0.34, length * 0.3],
      [x * 2.1, y * 1.9 + lift * 0.2, -length * 0.95],
      palette.bristleTip,
      [Math.sin(angle) * 0.32, -Math.cos(angle) * 0.32, 0],
    );
  }
};
