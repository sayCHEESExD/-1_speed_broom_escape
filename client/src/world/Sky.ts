import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Group,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Camera,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';

/**
 * The sky: a gradient dome and a field of BLOCKY clouds.
 *
 * The clouds are real geometry rather than a painted texture, because the
 * reference art's clouds are unmistakably built out of bricks - soft painted
 * cumulus is the single fastest way to make this world stop looking like the
 * game it is copying. Each cloud is a cluster of boxes; the whole sky is TWO
 * merged meshes (a lit top and a shaded underside) and one dome, so the entire
 * atmosphere costs three draw calls.
 *
 * Nothing here casts or receives shadows and nothing is lit: a cloud that
 * darkened as the sun moved would be a cloud nobody asked for.
 */

/** How far out the dome sits. Inside the camera's far plane. */
const DOME_RADIUS = 1600;

/**
 * Cloud field extent, in world units, and how high it floats.
 *
 * ONE tile of it, `length` long, repeated along the run (see `follow`). The
 * course is nearly twelve thousand units long; a single field laid over the
 * start of it left every stage past the fifth under an empty sky.
 */
const FIELD = {
  halfWidth: 900,
  length: 2800,
  minY: 120,
  maxY: 240,
  clusters: 90,
} as const;

/** Copies of the cloud tile kept around the camera: behind, here and ahead. */
const CLOUD_COPIES = 3;

/** Deterministic PRNG, so every client sees exactly the same sky. */
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

export class Sky {
  readonly root = new Group();

  private readonly disposables: (BufferGeometry | ShaderMaterial | MeshBasicMaterial)[] = [];

  /** The cloud tiles, one group per copy, each holding both layers. */
  private readonly cloudTiles: Group[] = [];

  constructor() {
    const dome = this.buildDome();
    this.root.add(dome);
    this.buildClouds();
    // Drawn behind everything, and never occluding the world.
    this.root.renderOrder = -1;

    /*
     * The sky FOLLOWS whichever camera draws it.
     *
     * The dome used to sit at the world origin with a 1600-unit radius, so a
     * player more than 1600 units down the course was OUTSIDE it - and a
     * back-faced sphere seen from outside draws nothing, leaving the flat
     * background colour behind every stage from the sixth on. Hooked on the
     * dome's own draw rather than on the game loop, so any camera - the
     * player's, or a debug one - gets a sky.
     */
    dome.onBeforeRender = (_renderer, _scene, camera: Camera) => this.follow(camera, dome);
  }

  /** Centre the dome on the camera and keep the cloud tiles around it. */
  private follow(camera: Camera, dome: Mesh): void {
    const { x, z } = camera.position;
    dome.position.set(x, camera.position.y, z);
    dome.updateMatrixWorld();

    // Tiles snap to whole multiples of the tile length, so clouds keep their
    // parallax - they are fixed in the world, never glued to the camera.
    const base = Math.floor(z / FIELD.length) - Math.floor(CLOUD_COPIES / 2);
    this.cloudTiles.forEach((tile, index) => {
      const at = (base + index) * FIELD.length;
      if (tile.position.z !== at) {
        tile.position.z = at;
        tile.updateMatrixWorld(true);
      }
    });
  }

  /**
   * A vertical gradient painted on the inside of a sphere.
   *
   * A two-stop shader rather than a texture: it is a dozen lines, it never
   * bands, and it costs no upload at all.
   */
  private buildDome(): Mesh {
    const geometry = new SphereGeometry(DOME_RADIUS, 24, 16);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new Color(PALETTE.skyTop) },
        midColor: { value: new Color(PALETTE.sky) },
        bottomColor: { value: new Color(PALETTE.fog) },
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        varying float vHeight;
        void main() {
          // Two bands: luminous blue overhead easing through lavender to the
          // haze the fog is matched to, so horizon and fog meet invisibly.
          float h = clamp(vHeight, -1.0, 1.0);
          vec3 sky = mix(midColor, topColor, clamp(h * 1.6, 0.0, 1.0));
          vec3 low = mix(bottomColor, midColor, clamp((h + 0.25) * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(h > 0.0 ? sky : low, 1.0);
        }
      `,
    });

    this.disposables.push(geometry, material);
    const dome = new Mesh(geometry, material);
    dome.frustumCulled = false;
    return dome;
  }

  /**
   * The cloud field.
   *
   * Every cluster is five to nine boxes stepped around a centre, which is what
   * gives the chunky stacked silhouette the reference art has. Two merged
   * meshes rather than one so the undersides can be a shade darker without a
   * second material per cloud.
   */
  private buildClouds(): void {
    const random = seeded(0x9a1ce);
    const tops: BufferGeometry[] = [];
    const bases: BufferGeometry[] = [];

    for (let i = 0; i < FIELD.clusters; i += 1) {
      const cx = (random() * 2 - 1) * FIELD.halfWidth;
      const cy = FIELD.minY + random() * (FIELD.maxY - FIELD.minY);
      const cz = random() * FIELD.length;
      const scale = 8 + random() * 16;
      const blocks = 5 + Math.floor(random() * 5);

      for (let b = 0; b < blocks; b += 1) {
        const t = blocks === 1 ? 0.5 : b / (blocks - 1);
        // A billow: widest and tallest in the middle of the cluster.
        const bulge = Math.sin(t * Math.PI);
        const w = scale * (1.1 + bulge * 1.5 + random() * 0.4);
        const h = scale * (0.5 + bulge * 0.55);
        const d = scale * (1.0 + bulge * 1.2 + random() * 0.4);

        const x = cx + (t - 0.5) * scale * 4.2;
        const y = cy + bulge * scale * 0.35 + (random() - 0.5) * scale * 0.2;
        const z = cz + (random() - 0.5) * scale * 1.2;

        const top = new BoxGeometry(w, h, d);
        top.translate(x, y, z);
        tops.push(top);

        // A flat slab under it, a touch wider, reading as the shaded base.
        const base = new BoxGeometry(w * 1.04, h * 0.32, d * 1.04);
        base.translate(x, y - h * 0.62, z);
        bases.push(base);
      }
    }

    const layers = [this.mergeLayer(tops, PALETTE.cloud), this.mergeLayer(bases, PALETTE.cloudShade)];
    for (let copy = 0; copy < CLOUD_COPIES; copy += 1) {
      const tile = new Group();
      for (const layer of layers) {
        if (!layer) continue;
        // The geometry and material are SHARED between copies: three tiles
        // cost three times the draw calls and nothing more in memory.
        const mesh = new Mesh(layer.geometry, layer.material);
        mesh.frustumCulled = false;
        tile.add(mesh);
      }
      this.cloudTiles.push(tile);
      this.root.add(tile);
    }
  }

  private mergeLayer(
    parts: BufferGeometry[],
    color: number,
  ): { geometry: BufferGeometry; material: MeshBasicMaterial } | null {
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return null;

    // Unlit and unfogged: a cloud two hundred units up must not fade into the
    // haze the ground uses, and must not dim as the sun's target moves.
    const material = new MeshBasicMaterial({ color, fog: false });
    this.disposables.push(merged, material);
    return { geometry: merged, material };
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.root.removeFromParent();
  }
}
