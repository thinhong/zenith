import { BufferAttribute, BufferGeometry } from 'three';
import { mulberry32, range, type Rng } from '@/world/seed';

/**
 * What a tree is made of, near and far (world/tree-mesh.ts draws them).
 *
 * A tree used to be a pole under six twenty-sided balls, flat shaded: from
 * above a green die, from the street a heap of them on a stick. What makes a
 * tree read as a tree is not how many leaves it has. It is four other things,
 * and these models are built for them:
 *
 * - **The crown is lit as one soft shape.** Every leaf vertex's normal leans
 *   out from the middle of the whole crown as well as from its own clump, so
 *   the sun side is bright and the far side falls away smoothly, as a canopy
 *   does from any distance. The clumps show in the outline, not as facets.
 * - **It is dark inside and underneath.** Each vertex carries a baked shade,
 *   low at the bottom and in the middle, full on top and outside.
 * - **It has wood in it.** A trunk that forks into limbs, twigs off the limbs,
 *   and gaps between the clumps of leaves where they show.
 * - **Its outline is ragged**: many lumpy clumps, not a few smooth balls.
 *
 * The leaves' own texture, clusters lit and in shadow, is not in the geometry
 * at all: the tree material draws it from noise (tree-mesh.ts).
 *
 * Each kind comes twice. The near model is the tree; the far one is the same
 * tree with its biggest clumps only and no limbs, about a sixth of the
 * triangles, built from the same layout so that one can dissolve into the
 * other without the tree changing shape.
 *
 * Tree space: x and z in crown diameters, y in the tree's height, the foot of
 * the trunk at the origin. An instance scales it by (diameter, height,
 * diameter), so one model serves every size and proportion. Every model has
 * `position`, `normal`, `color` (the baked shade, the same in all three
 * channels, for the tinted material) and `bark` (1 on wood, 0 on leaves).
 */

type V3 = readonly [number, number, number];

export const TREE_SHAPE = {
  /** Every model is built from this seed: the same trees on every load. */
  seed: 0x7a11,
  /** How much a clump's surface heaves, as a share of its radius. */
  lump: 0.2,
  /** Baked shade: at the bottom of the crown and at its top; and in its middle, against its surface. */
  shade: { low: 0.66, high: 1.14, inner: 0.68 },
  /**
   * Leaf cards near the eye (`shell`): the solid core as a share of the
   * clump and how much darker it is; how far out the cards lie, as a share of
   * the clump; and half a card's side, the same.
   */
  leaves: { core: 0.66, coreShade: 0.84, out: 0.86, size: 0.62 },
  broadleaf: {
    crown: { y: 0.67, rx: 0.46, ry: 0.27, bottom: 0.4, top: 0.95, blend: 0.62 },
    fork: { y: 0.42 },
    trunk: [0.066, 0.052, 0.046, 0.036] as const,
    limbs: 4,
    limbReach: [0.2, 0.29] as const,
    limbTop: [0.6, 0.72] as const,
    twigsPerLimb: 2,
    /** Clumps at the limbs' ends, the twigs' ends, and on top, as radii in crown diameters. */
    bigClump: [0.17, 0.2] as const,
    twigClump: [0.12, 0.15] as const,
    topClump: 0.19,
    /** Small clumps on the crown's surface, and how big. */
    sprays: 9,
    spray: [0.07, 0.1] as const,
    /** A clump is this much less tall than wide, in tree space. */
    squash: 0.62,
  },
  conifer: {
    /** The lowest tier's rim, and the tip, in heights. */
    crownFrom: 0.3,
    tip: 1,
    /** How far a tier rises from its rim to the trunk, and the top one. */
    rise: 0.14,
    topRise: 0.2,
    /**
     * Branch tips round a tier, near and far, and how far in the notches
     * between them come. Five deep points from the air were a star on a flag.
     */
    tips: 8,
    farTips: 6,
    /** Tiers near and far. */
    tiers: 8,
    farTiers: 4,
    notch: [0.8, 0.88] as const,
    trunk: [0.06, 0.04, 0.01] as const,
  },
  slender: {
    stems: 3,
    reach: [0.19, 0.25] as const,
    tip: [0.64, 0.8] as const,
    stem: [0.014, 0.011, 0.008, 0.004] as const,
    cloud: [0.17, 0.2] as const,
    squash: 0.56,
  },
} as const;

// --- small vector helpers --------------------------------------------------

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function normalize(a: V3, fallback: V3 = [0, 1, 0]): V3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : fallback;
}

/** Points along a path, by the share of the way along it. */
function along(path: readonly V3[], t: number): V3 {
  const last = path.length - 1;
  const at = clamp01(t) * last;
  const i = Math.min(last - 1, Math.floor(at));
  const a = path[i] ?? [0, 0, 0];
  const b = path[i + 1] ?? a;
  return lerp(a, b, at - i);
}

// --- the model being built -------------------------------------------------

const NOT_A_CARD: V3 = [0.5, 0.5, -1];

class Model {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly shade: number[] = [];
  private readonly bark: number[] = [];
  private readonly leaf: number[] = [];
  private readonly index: number[] = [];

  get vertices(): number {
    return this.position.length / 3;
  }

  /** `leaf` is a card's own u and v and its seed; a seed below 0 is not a card. */
  vertex(p: V3, n: V3, shade: number, bark: 0 | 1, leaf: V3 = NOT_A_CARD): number {
    this.position.push(p[0], p[1], p[2]);
    this.normal.push(n[0], n[1], n[2]);
    this.shade.push(shade, shade, shade);
    this.bark.push(bark);
    this.leaf.push(leaf[0], leaf[1], leaf[2]);
    return this.vertices - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.index.push(a, b, c);
  }

  at(vertex: number): V3 {
    return [this.position[vertex * 3] ?? 0, this.position[vertex * 3 + 1] ?? 0, this.position[vertex * 3 + 2] ?? 0];
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normal), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.shade), 3));
    geometry.setAttribute('bark', new BufferAttribute(new Float32Array(this.bark), 1));
    geometry.setAttribute('leaf', new BufferAttribute(new Float32Array(this.leaf), 3));
    const index = this.vertices > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index);
    geometry.setIndex(new BufferAttribute(index, 1));
    return geometry;
  }
}

// --- clumps of leaves ------------------------------------------------------

interface Sphere {
  dirs: V3[];
  faces: [number, number, number][];
}

const SPHERES = new Map<number, Sphere>();

/** A unit icosphere, indexed, wound counter-clockwise seen from outside. */
function icosphere(detail: number): Sphere {
  const cached = SPHERES.get(detail);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  const dirs: V3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as V3[]
  ).map((d) => normalize(d));
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const middles = new Map<number, number>();
    const middle = (a: number, b: number): number => {
      const key = a < b ? a * 4096 + b : b * 4096 + a;
      const found = middles.get(key);
      if (found !== undefined) return found;
      dirs.push(normalize(lerp(dirs[a] ?? [0, 1, 0], dirs[b] ?? [0, 1, 0], 0.5)));
      middles.set(key, dirs.length - 1);
      return dirs.length - 1;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const sphere = { dirs, faces };
  SPHERES.set(detail, sphere);
  return sphere;
}

/** A clump's surface: a few long waves across it, so it heaves rather than bristles. */
function lumpsOf(rng: Rng, amount: number): (d: V3) => number {
  const waves = [0, 1, 2].map(() => ({
    axis: normalize([range(rng, -1, 1), range(rng, -1, 1), range(rng, -1, 1)]),
    freq: range(rng, 2.1, 3.3),
    phase: range(rng, 0, Math.PI * 2),
  }));
  return (d) => {
    let sum = 0;
    for (const wave of waves) sum += Math.sin(dot(wave.axis, d) * wave.freq * Math.PI + wave.phase);
    return 1 + (amount / waves.length) * sum;
  };
}

/** The whole crown, as the shape its leaves are lit as. */
interface Crown {
  centre: V3;
  radii: V3;
  bottom: number;
  top: number;
  /**
   * How far a leaf's normal leans toward the whole crown's. A round crown is
   * lit as one shape; a crown of flat clouds in layers keeps more of each
   * cloud's own, or the top of a low cloud would be lit as if it faced down.
   */
  blend: number;
}

function leafShade(p: V3, crown: Crown): number {
  const S = TREE_SHAPE.shade;
  const up = clamp01((p[1] - crown.bottom) / (crown.top - crown.bottom));
  const out = clamp01(
    Math.hypot(
      (p[0] - crown.centre[0]) / crown.radii[0],
      (p[1] - crown.centre[1]) / crown.radii[1],
      (p[2] - crown.centre[2]) / crown.radii[2],
    ),
  );
  return (S.low + (S.high - S.low) * Math.pow(up, 0.8)) * (S.inner + (1 - S.inner) * out);
}

/** The direction out of the crown at a point: the gradient of its ellipsoid. */
function crownNormal(p: V3, crown: Crown): V3 {
  return normalize([
    (p[0] - crown.centre[0]) / (crown.radii[0] * crown.radii[0]),
    (p[1] - crown.centre[1]) / (crown.radii[1] * crown.radii[1]),
    (p[2] - crown.centre[2]) / (crown.radii[2] * crown.radii[2]),
  ]);
}

interface ClumpSpec {
  centre: V3;
  radii: V3;
  /** Kept in the far model too. */
  far: boolean;
  /** Small enough that twenty faces are enough for it, even near. */
  small?: boolean;
}

function clump(model: Model, detail: number, spec: ClumpSpec, crown: Crown, rng: Rng, grow = 1): void {
  const sphere = icosphere(detail);
  const lumps = lumpsOf(rng, TREE_SHAPE.lump);
  const jitter = range(rng, 0.93, 1.07);
  const base = model.vertices;
  const r = mul(spec.radii, grow);
  for (const d of sphere.dirs) {
    const k = lumps(d);
    const p: V3 = [spec.centre[0] + d[0] * r[0] * k, spec.centre[1] + d[1] * r[1] * k, spec.centre[2] + d[2] * r[2] * k];
    const own = normalize([d[0] / r[0], d[1] / r[1], d[2] / r[2]]);
    const whole = crownNormal(p, crown);
    const n = normalize(lerp(own, whole, crown.blend), own);
    model.vertex(p, n, leafShade(p, crown) * jitter, 0);
  }
  for (const [a, b, c] of sphere.faces) model.triangle(base + a, base + b, base + c);
}

/**
 * A clump near the eye: a shell of leaf cards round a smaller solid core.
 *
 * Seen close, a solid clump is a ball whatever is done to its outline, and a
 * flattened one is a plate: from under a tree its crown was a stack of cut
 * paper. Each card is a square laid on one face of a polyhedron round the
 * clump, a little outside it and a little bigger than the face, so the cards
 * overlap and stand out past the core; the material cuts each one into a
 * cluster of leaves (tree-mesh.ts), so what the eye meets is leaves over
 * leaves, sky through the gaps at the edge, and the dark core behind them.
 * The core is what keeps the middle of a crown from being see-through.
 */
function shell(model: Model, spec: ClumpSpec, crown: Crown, rng: Rng, core: boolean): void {
  const L = TREE_SHAPE.leaves;
  const sphere = icosphere(0);
  const faces = core ? sphere.faces : OCTAHEDRON;
  const dirs = core ? sphere.dirs : OCTAHEDRON_DIRS;
  const lumps = lumpsOf(rng, TREE_SHAPE.lump);
  const jitter = range(rng, 0.93, 1.07);
  const r = spec.radii;
  if (core) {
    const inner: ClumpSpec = { centre: spec.centre, radii: mul(r, L.core), far: spec.far };
    const base = model.vertices;
    for (const d of sphere.dirs) {
      const k = lumps(d);
      const p: V3 = [spec.centre[0] + d[0] * inner.radii[0] * k, spec.centre[1] + d[1] * inner.radii[1] * k, spec.centre[2] + d[2] * inner.radii[2] * k];
      const own = normalize([d[0] / r[0], d[1] / r[1], d[2] / r[2]]);
      const n = normalize(lerp(own, crownNormal(p, crown), crown.blend), own);
      model.vertex(p, n, leafShade(p, crown) * jitter * L.coreShade, 0);
    }
    for (const [a, b, c] of sphere.faces) model.triangle(base + a, base + b, base + c);
  }
  for (const [ia, ib, ic] of faces) {
    const a = dirs[ia] ?? [0, 1, 0];
    const b = dirs[ib] ?? [0, 1, 0];
    const c = dirs[ic] ?? [0, 1, 0];
    const out = normalize([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]);
    // Two directions in the face, turned at random, so no two cards line up.
    const spin = range(rng, 0, Math.PI * 2);
    const u0 = normalize(sub(b, a), [1, 0, 0]);
    const v0 = cross(out, u0);
    const u = add(mul(u0, Math.cos(spin)), mul(v0, Math.sin(spin)));
    const v = cross(out, u);
    const half = L.size * range(rng, 0.9, 1.12);
    const middle = mul(out, L.out);
    const seed = rng();
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const base = model.vertices;
    for (const [su, sv] of corners) {
      const q = add(middle, add(mul(u, su * half), mul(v, sv * half)));
      const k = lumps(normalize(q));
      const p: V3 = [spec.centre[0] + q[0] * r[0] * k, spec.centre[1] + q[1] * r[1] * k, spec.centre[2] + q[2] * r[2] * k];
      const own = normalize([out[0] / r[0], out[1] / r[1], out[2] / r[2]]);
      const n = normalize(lerp(own, crownNormal(p, crown), crown.blend), own);
      model.vertex(p, n, leafShade(p, crown) * jitter, 0, [(su + 1) / 2, (sv + 1) / 2, seed]);
    }
    model.triangle(base, base + 1, base + 2);
    model.triangle(base, base + 2, base + 3);
  }
}

const OCTAHEDRON_DIRS: V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** Wound counter-clockwise from outside, like the icosphere. */
const OCTAHEDRON: [number, number, number][] = [
  [2, 4, 0],
  [2, 0, 5],
  [2, 5, 1],
  [2, 1, 4],
  [3, 0, 4],
  [3, 5, 0],
  [3, 1, 5],
  [3, 4, 1],
];

// --- wood ------------------------------------------------------------------

interface Tube {
  path: V3[];
  radii: number[];
  shades: number[];
  sides: number;
  /** Kept in the far model too. */
  far: boolean;
}

/**
 * A tapered tube along a path, open at both ends: its foot is in the ground
 * or in the limb it grows from, and its tip is inside a clump of leaves.
 * Wound counter-clockwise from outside, with smooth normals round it.
 */
function tube(model: Model, spec: Tube, sides = spec.sides): void {
  const path = spec.path;
  const n = path.length;
  const first = path[0] ?? [0, 0, 0];
  const last = path[n - 1] ?? first;
  const overall = normalize(sub(last, first));
  // One reference for the whole tube, so its rings do not twist against each other.
  const reference: V3 = Math.abs(overall[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const rings: number[] = [];
  for (let k = 0; k < n; k++) {
    const here = path[k] ?? first;
    // A ring on the ground lies flat on it, or half of it would be underground.
    const tangent: V3 =
      here[1] <= 1e-6 ? [0, 1, 0] : normalize(sub(path[Math.min(n - 1, k + 1)] ?? here, path[Math.max(0, k - 1)] ?? here), overall);
    const u = normalize(cross(reference, tangent), [1, 0, 0]);
    const v = cross(tangent, u);
    rings.push(model.vertices);
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const out = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
      model.vertex(add(here, mul(out, spec.radii[k] ?? 0)), out, spec.shades[k] ?? 1, 1);
    }
  }
  for (let k = 0; k + 1 < n; k++) {
    const a0 = rings[k] ?? 0;
    const b0 = rings[k + 1] ?? 0;
    for (let j = 0; j < sides; j++) {
      const a = a0 + j;
      const b = a0 + ((j + 1) % sides);
      const c = b0 + j;
      const d = b0 + ((j + 1) % sides);
      model.triangle(a, b, d);
      model.triangle(a, d, c);
    }
  }
}

// --- broadleaf -------------------------------------------------------------

interface Layout {
  crown: Crown;
  wood: Tube[];
  clumps: ClumpSpec[];
  /** How much bigger a far clump is, to fill the crown the near ones do between them. */
  farGrow: number;
}

function broadleafLayout(): Layout {
  const rng = mulberry32(TREE_SHAPE.seed);
  const B = TREE_SHAPE.broadleaf;
  const crown: Crown = {
    centre: [0, B.crown.y, 0],
    radii: [B.crown.rx, B.crown.ry, B.crown.rx],
    bottom: B.crown.bottom,
    top: B.crown.top,
    blend: B.crown.blend,
  };
  const fork: V3 = [0.004, B.fork.y, 0.006];
  const wood: Tube[] = [
    {
      // A little flare at the foot, and a trunk that is not quite straight.
      path: [[0, 0, 0], [0.004, 0.05, 0.002], [0.01, 0.22, -0.004], fork],
      radii: [...B.trunk],
      shades: [0.72, 0.8, 0.88, 0.8],
      sides: 7,
      far: true,
    },
  ];
  const clumps: ClumpSpec[] = [];
  const squash = (r: number): V3 => [r, r * B.squash, r];
  const turn = range(rng, 0, Math.PI * 2);
  for (let i = 0; i < B.limbs; i++) {
    const azimuth = turn + (i * Math.PI * 2) / B.limbs + range(rng, -0.3, 0.3);
    const out: V3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
    const start = add(fork, [out[0] * 0.012, -0.02 + i * 0.008, out[2] * 0.012]);
    const reach = range(rng, B.limbReach[0], B.limbReach[1]);
    const end: V3 = [out[0] * reach, range(rng, B.limbTop[0], B.limbTop[1]), out[2] * reach];
    // Bowed: it rises first, then reaches out.
    const middle = add(lerp(start, end, 0.5), [-out[0] * 0.03, 0.035, -out[2] * 0.03]);
    const limb = [start, middle, end];
    wood.push({ path: limb, radii: [0.026, 0.018, 0.009], shades: [0.74, 0.7, 0.66], sides: 5, far: false });
    clumps.push({ centre: add(end, [out[0] * 0.03, 0.03, out[2] * 0.03]), radii: squash(range(rng, B.bigClump[0], B.bigClump[1])), far: true });
    for (let k = 0; k < B.twigsPerLimb; k++) {
      const from = along(limb, k === 0 ? 0.55 : 0.8);
      const side = (k === 0 ? -1 : 1) * range(rng, 0.55, 0.95);
      const heading = azimuth + side;
      const length = range(rng, 0.12, 0.17);
      const tip = add(from, [Math.cos(heading) * length, range(rng, 0.05, 0.1), Math.sin(heading) * length]);
      wood.push({ path: [from, tip], radii: [0.011, 0.004], shades: [0.7, 0.66], sides: 4, far: false });
      // Far off, one twig's clump in every other limb: six clumps, each grown to fill the crown.
      clumps.push({ centre: add(tip, [0, 0.02, 0]), radii: squash(range(rng, B.twigClump[0], B.twigClump[1])), far: k === 1 && i % 2 === 0 });
    }
  }
  // A leader up the middle, with the top of the crown on it.
  const top: V3 = [0.015, 0.83, -0.01];
  wood.push({ path: [fork, add(fork, [0.01, 0.2, -0.01]), top], radii: [0.028, 0.018, 0.008], shades: [0.76, 0.72, 0.7], sides: 5, far: false });
  clumps.push({ centre: top, radii: squash(B.topClump), far: true });
  // Two more low in the middle, so the crown is not a ring of clumps with sky through it from below.
  for (let k = 0; k < 2; k++) {
    const azimuth = turn + Math.PI / B.limbs + k * Math.PI;
    clumps.push({ centre: [Math.cos(azimuth) * 0.13, 0.57, Math.sin(azimuth) * 0.13], radii: squash(0.15), far: false });
  }
  // Sprays: small clumps out on the surface between the big ones, so the
  // outline is broken into many bumps of different sizes, not a few of one.
  for (let k = 0; k < B.sprays; k++) {
    const azimuth = turn + (k * Math.PI * 2) / B.sprays + range(rng, -0.25, 0.25);
    const up = range(rng, -0.2, 0.85);
    const out = Math.sqrt(1 - up * up) * 0.96;
    const at: V3 = [Math.cos(azimuth) * out * B.crown.rx, B.crown.y + up * B.crown.ry * 0.96, Math.sin(azimuth) * out * B.crown.rx];
    clumps.push({ centre: at, radii: squash(range(rng, B.spray[0], B.spray[1])), far: false, small: true });
  }
  return { crown, wood, clumps, farGrow: 1.24 };
}

function build(layout: Layout, near: boolean): BufferGeometry {
  const model = new Model();
  const rng = mulberry32(TREE_SHAPE.seed + (near ? 1 : 2));
  for (const piece of layout.wood) {
    if (!near && !piece.far) continue;
    if (near) {
      tube(model, piece);
      continue;
    }
    // Far off a trunk or a stem is one straight run of four or five sides.
    const last = piece.path.length - 1;
    tube(model, {
      ...piece,
      path: [piece.path[0] ?? [0, 0, 0], piece.path[last] ?? [0, 1, 0]],
      radii: [piece.radii[0] ?? 0.02, piece.radii[last] ?? 0.01],
      shades: [piece.shades[0] ?? 0.8, piece.shades[last] ?? 0.8],
      sides: Math.max(4, piece.sides - 2),
    });
  }
  for (const piece of layout.clumps) {
    if (!near && !piece.far) continue;
    // Near, leaves; far, fewer clumps, solid, each a little bigger to fill the same crown.
    if (near) shell(model, piece, layout.crown, rng, !piece.small);
    else clump(model, 0, piece, layout.crown, rng, layout.farGrow);
  }
  return model.geometry();
}

const broadleaf = broadleafLayout();

export function broadleafNear(): BufferGeometry {
  return build(broadleaf, true);
}

export function broadleafFar(): BufferGeometry {
  return build(broadleaf, false);
}

// --- slender, of several stems ---------------------------------------------

function slenderLayout(): Layout {
  const rng = mulberry32(TREE_SHAPE.seed + 7);
  const S = TREE_SHAPE.slender;
  const crown: Crown = { centre: [0, 0.68, 0], radii: [0.46, 0.32, 0.46], bottom: 0.4, top: 0.98, blend: 0.34 };
  const wood: Tube[] = [];
  const clumps: ClumpSpec[] = [];
  const squash = (r: number): V3 => [r, r * S.squash, r];
  const turn = range(rng, 0, Math.PI * 2);
  for (let i = 0; i < S.stems; i++) {
    const azimuth = turn + (i * Math.PI * 2) / S.stems + range(rng, -0.35, 0.35);
    const out: V3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
    const reach = range(rng, S.reach[0], S.reach[1]) * (1 - i * 0.08);
    const tipY = range(rng, S.tip[0], S.tip[1]) * (1 - i * 0.06);
    const base: V3 = [out[0] * 0.012, 0, out[2] * 0.012];
    // Leaning out low down and straightening as it rises, the way a stem
    // grows away from its neighbours toward the light.
    const stem: V3[] = [
      base,
      [out[0] * reach * 0.35, tipY * 0.3, out[2] * reach * 0.35],
      [out[0] * reach * 0.72, tipY * 0.64, out[2] * reach * 0.72],
      [out[0] * reach, tipY, out[2] * reach],
    ];
    wood.push({ path: stem, radii: [...S.stem], shades: [0.8, 0.86, 0.84, 0.8], sides: 5, far: true });
    const tip = stem[3] ?? base;
    clumps.push({ centre: add(tip, [out[0] * 0.03, 0.035, out[2] * 0.03]), radii: squash(range(rng, S.cloud[0], S.cloud[1])), far: true });
    // A cloud part-way up, out to one side.
    const mid = along(stem, 0.66);
    const aside = azimuth + (i % 2 === 0 ? 0.9 : -0.9);
    clumps.push({ centre: add(mid, [Math.cos(aside) * 0.1, 0.03, Math.sin(aside) * 0.1]), radii: squash(range(rng, 0.12, 0.14)), far: true });
    for (let k = 0; k < 2; k++) {
      const from = along(stem, k === 0 ? 0.5 : 0.76);
      const heading = azimuth + (k === 0 ? -1 : 1) * range(rng, 0.7, 1.1);
      const length = range(rng, 0.1, 0.14);
      const end = add(from, [Math.cos(heading) * length, range(rng, 0.04, 0.08), Math.sin(heading) * length]);
      wood.push({ path: [from, end], radii: [0.006, 0.0025], shades: [0.8, 0.78], sides: 4, far: false });
      clumps.push({ centre: add(end, [0, 0.015, 0]), radii: squash(range(rng, 0.08, 0.1)), far: false, small: true });
    }
  }
  clumps.push({ centre: [0.01, 0.9, -0.02], radii: squash(0.15), far: true });
  return { crown, wood, clumps, farGrow: 1.16 };
}

const slender = slenderLayout();

export function slenderNear(): BufferGeometry {
  return build(slender, true);
}

export function slenderFar(): BufferGeometry {
  return build(slender, false);
}

// --- conifer ---------------------------------------------------------------

/**
 * A conifer is tiers of branches, each a skirt that rises to the trunk and
 * droops at its rim, the rim a ragged ring of branch tips, darker underneath
 * and further down. It used to be three plain cones: a party hat, or a stack
 * of them.
 *
 * The normals are the surface's own, worked out in tree space. They must not
 * be leaned outward there: an instance stretches a conifer to about twice as
 * tall as it is wide, which stretches every normal toward the horizontal, and
 * the first version, leaned out on top of that, was lit from above as if its
 * tiers were walls. From the air it was a dark green star.
 */
function conifer(near: boolean): BufferGeometry {
  const C = TREE_SHAPE.conifer;
  const model = new Model();
  const rng = mulberry32(TREE_SHAPE.seed + (near ? 11 : 12));
  tube(
    model,
    { path: [[0, 0, 0], [0, 0.5, 0], [0, C.tip - 0.06, 0]], radii: [...C.trunk], shades: [0.72, 0.8, 0.8], sides: near ? 6 : 4, far: true },
  );
  const tiers = near ? C.tiers : C.farTiers;
  const tips = near ? C.tips : C.farTips;
  for (let i = 0; i < tiers; i++) {
    const s = i / (tiers - 1);
    const rimY = C.crownFrom + s * (C.tip - C.crownFrom - C.topRise);
    const reach = (0.5 - 0.04) * Math.pow(1 - s, 0.9) * range(rng, 0.95, 1.04) + 0.04;
    const rise = C.rise * (1 - 0.35 * s) + (s > 0.99 ? C.topRise - C.rise * 0.65 : 0);
    const collarY = rimY + rise;
    const twist = range(rng, 0, Math.PI * 2);
    const tone = 0.76 + 0.34 * s;
    // A skirt's profile, collar to rim: high and flat near the trunk, then
    // falling away, so its outer part hangs. Radius as a share of the reach,
    // and height down from the collar as a share of the rise.
    const profile = [
      { r: 0.06, down: 0 },
      { r: 0.55, down: 0.36 },
      { r: 1, down: 1 },
    ];
    const ringOf = (k: number, count: number, jag: boolean): number[] => {
      const step = profile[k] ?? { r: 1, down: 1 };
      const next = profile[Math.min(profile.length - 1, k + 1)] ?? step;
      const prev = profile[Math.max(0, k - 1)] ?? step;
      // The slope here, in tree space: height lost per unit of reach.
      const fall = ((next.down - prev.down) * rise) / Math.max(1e-6, (next.r - prev.r) * reach);
      const ring: number[] = [];
      for (let j = 0; j < count; j++) {
        const angle = twist + (j / count) * Math.PI * 2;
        const out: V3 = [Math.cos(angle), 0, Math.sin(angle)];
        const tip = jag && j % 2 === 0;
        const r = step.r * reach * (jag ? (tip ? range(rng, 0.96, 1.05) : range(rng, C.notch[0], C.notch[1])) : 1);
        // Branch tips hang a little lower than the notches between them.
        const y = collarY - step.down * rise - (jag ? (tip ? 0.014 : -0.006) : 0);
        const n = normalize([out[0] * fall, 1, out[2] * fall]);
        const shade = tone * (k === 0 ? 0.8 : k === 1 ? 0.95 : tip ? 1.1 : 0.98);
        ring.push(model.vertex([out[0] * r, y, out[2] * r], n, shade, 0));
      }
      return ring;
    };
    const collar = ringOf(0, tips, false);
    // Far off the skirt goes straight from the collar to the rim; near, it
    // bends at a middle ring, which is where the droop comes from.
    const middle = near ? ringOf(1, tips * 2, false) : null;
    const rim = ringOf(2, tips * 2, true);
    const inner = middle ?? rim;
    // The collar to the next ring out: each collar vertex fans to three.
    for (let j = 0; j < tips; j++) {
      const c = collar[j] ?? 0;
      const cNext = collar[(j + 1) % tips] ?? 0;
      const m0 = inner[j * 2] ?? 0;
      const m1 = inner[j * 2 + 1] ?? 0;
      const m2 = inner[(j * 2 + 2) % (tips * 2)] ?? 0;
      model.triangle(c, m1, m0);
      model.triangle(c, cNext, m1);
      model.triangle(cNext, m2, m1);
    }
    // The middle ring out to the rim, quad by quad.
    if (middle) {
      for (let j = 0; j < tips * 2; j++) {
        const a = middle[j] ?? 0;
        const b = middle[(j + 1) % (tips * 2)] ?? 0;
        const c = rim[j] ?? 0;
        const d = rim[(j + 1) % (tips * 2)] ?? 0;
        model.triangle(a, b, d);
        model.triangle(a, d, c);
      }
    }
    // Underneath, from the rim in to the trunk a little above it. Far off only
    // the lowest tier needs one: the rest are only ever seen from above or level.
    if (!near && i > 0) continue;
    const hubY = collarY - rise * 0.62;
    const hub = model.vertex([0, hubY, 0], [0, -1, 0], tone * 0.46, 0);
    const under: number[] = [];
    for (let j = 0; j < tips * 2; j++) {
      const top = rim[j] ?? 0;
      const p = model.at(top);
      const out = normalize([p[0], 0, p[2]], [1, 0, 0]);
      under.push(model.vertex(p, normalize([out[0] * 0.5, -1, out[2] * 0.5]), tone * 0.6, 0));
    }
    for (let j = 0; j < tips * 2; j++) {
      model.triangle(hub, under[j] ?? 0, under[(j + 1) % (tips * 2)] ?? 0);
    }
  }
  return model.geometry();
}

export function coniferNear(): BufferGeometry {
  return conifer(true);
}

export function coniferFar(): BufferGeometry {
  return conifer(false);
}

// --- a shrub ---------------------------------------------------------------

/**
 * Three lumps together, low and wide: a shrub, not a ball. Unit space, base
 * at 0, about 1 across and 1 tall. Twenty faces a lump: there are fifteen
 * hundred of them in the citadel, and at eighty a lump they cost more than
 * all its trees.
 */
export function shrubGeometry(): BufferGeometry {
  const model = new Model();
  const rng = mulberry32(TREE_SHAPE.seed + 21);
  const crown: Crown = { centre: [0, 0.42, 0], radii: [0.5, 0.42, 0.5], bottom: 0, top: 0.95, blend: 0.5 };
  const parts: ClumpSpec[] = [
    { centre: [0, 0.48, 0], radii: [0.36, 0.44, 0.36], far: true },
    { centre: [0.2, 0.34, 0.1], radii: [0.27, 0.32, 0.27], far: true },
    { centre: [-0.16, 0.32, -0.14], radii: [0.26, 0.3, 0.26], far: true },
  ];
  for (const part of parts) clump(model, 0, part, crown, rng);
  return model.geometry();
}
