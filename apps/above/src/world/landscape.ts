import type { Rng } from '@/world/seed';
import { TERRAIN, waterDepthAt, type TerrainSpec } from '@/world/terrain';

/**
 * The country beyond the plain: foothills, ridges and peaks, as one height
 * field. Pure, so it can be tested without a GPU; ground.ts turns it into a
 * mesh.
 *
 * This replaces seventy-six seven-sided cones, which were about a thousand
 * triangles for the whole horizon. From the opening height the mountains
 * fill the top of every frame, and a ring of cones reads as a paper crown
 * round the town rather than as land: every peak the same shape, no ridges
 * joining them, no valleys between. What makes a mountain range is that it
 * is one surface, folded, and the folds are what catch the light.
 *
 * So the peaks are still the same specs the terrain has always had, and they
 * are joined by a ridged noise that grows with them, and the whole thing is
 * held flat where anything lives: across the plain the town, the dragon and
 * the monsters stand on, and anywhere near the water.
 */

export const LANDSCAPE = {
  /**
   * The plain stays exactly flat out to here, as a share of where the
   * mountains start. Everything placed outside the town (the dragon, the
   * beasts, the heroes, the tracks from the gates) sits inside it.
   */
  plainShare: 0.85,
  /**
   * How far past the plain the range takes to reach its full height. It used
   * to do it in the last 114 m before the ring, so from any height above the
   * town the mountains stood up as one sheer wall round the valley, streaked
   * top to bottom: a crater rim, not a range. Spread over six hundred metres,
   * the nearest peaks come up as shoulders and the big ones stand behind them.
   */
  riseM: 620,
  /**
   * Low rolling hills between the plain and the range, so the valley floor
   * turns up into the mountains through country rather than at a crease.
   */
  foothillM: 36,
  foothillScaleM: 240,
  foothillRiseM: 260,
  /** Past this the land settles back to flat, so the mesh meets the disc. */
  outerM: 3200,
  settleFromM: 2350,
  /** Grid resolution: around, and outwards. */
  around: 360,
  outwards: 120,
  /** How the rings are spaced: above 1 they crowd the near edge, where it is seen closest. */
  ringPower: 1.45,
  /**
   * How tall and how wide a peak is against its spec. The specs were shaped
   * for cones, and read literally they make slopes of forty-five degrees and
   * more, so nearly every face came out as cliff: a ring of dark streaked
   * rock rather than wooded hills. Lower and wider puts most of it at the
   * twenty-five degrees real hills settle at, with rock left for the ridges.
   */
  peakHeight: 0.6,
  peakReach: 2.7,
  /**
   * How much of its height a peak keeps, by how far out it stands: the ones
   * nearest the valley are shoulders, and the full height is saved for the
   * range behind them. Heights and positions are independent in the specs, so
   * without this a 400 m peak stood right at the edge of the plain as often
   * as anywhere, and it is those that made the ring read as a wall.
   */
  nearStature: 0.3,
  fullStatureM: 1500,
  /** Ridge detail: a floor, plus a share of the local peak height. */
  detailFloorM: 24,
  detailShare: 0.22,
  /** Size of the largest ridges, in metres. */
  ridgeScaleM: 520,
  octaves: 5,
  /** How far from the water the land is still held flat, and where it may rise. */
  shoreFlatM: 30,
  shoreRiseM: 150,
} as const;

/** A seeded 2D gradient noise, in roughly [-1, 1]. */
export type Noise2D = (x: number, y: number) => number;

export function createNoise2D(rng: Rng): Noise2D {
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = base[i] ?? 0;
    base[i] = base[j] ?? 0;
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255] ?? 0;

  const grad = (hash: number, x: number, y: number): number => {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const aa = perm[(perm[X] ?? 0) + Y] ?? 0;
    const ab = perm[(perm[X] ?? 0) + Y + 1] ?? 0;
    const ba = perm[(perm[X + 1] ?? 0) + Y] ?? 0;
    const bb = perm[(perm[X + 1] ?? 0) + Y + 1] ?? 0;
    const u = fade(xf);
    const v = fade(yf);
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    // Scaled so the typical range is about [-1, 1] rather than [-0.7, 0.7].
    return (x1 + v * (x2 - x1)) * 0.7071 * 1.35;
  };
}

/**
 * Ridged fractal noise, in [0, 1]. Each octave is folded at zero so its
 * troughs become sharp crests, and the crests of the big octaves are where
 * the small ones are allowed to be strongest. That weighting is what makes
 * the result read as a range of ridges rather than as crumpled paper.
 */
export function ridged(noise: Noise2D, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * frequency, z * frequency));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 1.6));
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return norm > 0 ? sum / norm : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const STATURES = new WeakMap<TerrainSpec, Float64Array>();

/**
 * Each peak's share of its own height, by how far out it stands. Worked out
 * once per terrain: the height is asked for at forty thousand points, and
 * every one of them would otherwise work out the same sixty numbers again.
 */
function staturesOf(terrain: TerrainSpec): Float64Array {
  const known = STATURES.get(terrain);
  if (known) return known;
  const statures = new Float64Array(terrain.mountains.length);
  terrain.mountains.forEach((m, k) => {
    const out = smoothstep(TERRAIN.mountainInnerM, LANDSCAPE.fullStatureM, Math.hypot(m.x, m.z));
    statures[k] = LANDSCAPE.nearStature + (1 - LANDSCAPE.nearStature) * out;
  });
  STATURES.set(terrain, statures);
  return statures;
}

/** The ground's height at a point, in metres. Zero on the plain and by water. */
export function landscapeHeight(terrain: TerrainSpec, noise: Noise2D, x: number, z: number): number {
  const r = Math.hypot(x, z);
  const plainM = TERRAIN.mountainInnerM * LANDSCAPE.plainShare;
  const settle = 1 - smoothstep(LANDSCAPE.settleFromM, LANDSCAPE.outerM, r);
  const hillRise = smoothstep(plainM, plainM + LANDSCAPE.foothillRiseM, r) * settle;
  if (hillRise <= 0) return 0;
  const rise = smoothstep(plainM, plainM + LANDSCAPE.riseM, r);

  // The land stays flat along the shore and never rises out of the water.
  const depth = waterDepthAt(terrain.water, x, z);
  const shore = smoothstep(LANDSCAPE.shoreFlatM, LANDSCAPE.shoreRiseM, -depth);
  if (shore <= 0) return 0;

  // The peaks: the tallest one reaching this point sets the height, and the
  // rest add a little, so neighbouring peaks join into a massif rather than
  // standing in a row of separate cones.
  let highest = 0;
  let rest = 0;
  const statures = staturesOf(terrain);
  for (let k = 0; k < terrain.mountains.length; k++) {
    const m = terrain.mountains[k];
    if (!m) continue;
    const d = Math.hypot(x - m.x, z - m.z) / m.radiusM;
    if (d >= LANDSCAPE.peakReach) continue;
    const t = Math.max(0, 1 - (d / LANDSCAPE.peakReach) ** 2);
    const h = m.heightM * LANDSCAPE.peakHeight * (statures[k] ?? 1) * t * t;
    if (h > highest) {
      rest += highest;
      highest = h;
    } else {
      rest += h;
    }
  }
  const peaks = highest + rest * 0.18;

  // Ridges, stronger where the land is already high.
  const s = 1 / LANDSCAPE.ridgeScaleM;
  const ridge = ridged(noise, x * s, z * s, LANDSCAPE.octaves);
  const detail = (LANDSCAPE.detailFloorM + peaks * LANDSCAPE.detailShare) * (ridge - 0.35) * 2;

  // Foothills: smooth, not ridged, and offset into a different patch of the
  // same noise so they do not simply echo the ridges above them.
  const f = 1 / LANDSCAPE.foothillScaleM;
  const hills = LANDSCAPE.foothillM * (0.55 + 0.45 * noise(x * f + 71.3, z * f - 29.9));

  return Math.max(0, ((peaks + detail) * rise * settle + hills * hillRise) * shore);
}

export interface LandscapeGrid {
  positions: Float32Array;
  index: Uint32Array;
  /** The highest point anywhere on it, for the snow line. */
  maxHeightM: number;
  innerM: number;
}

/** The mesh's own surface at one point. */
export interface GridSample {
  heightM: number;
  /** Rise over run of the triangle the point falls in. */
  slope: number;
}

/**
 * The mesh itself at a point: the triangle it falls in, interpolated. Not
 * `landscapeHeight`, which is the surface the mesh samples; between samples
 * the two differ by a metre or two on a ridge, and a tree stood on the wrong
 * one floats.
 */
export function sampleGrid(grid: LandscapeGrid, x: number, z: number): GridSample {
  const A = LANDSCAPE.around;
  const R = LANDSCAPE.outwards;
  const r = Math.hypot(x, z);
  const t = (r - grid.innerM) / (LANDSCAPE.outerM - grid.innerM);
  if (t < 0 || t >= 1) return { heightM: 0, slope: 0 };
  const u = Math.pow(t, 1 / LANDSCAPE.ringPower) * R;
  let angle = Math.atan2(z, x);
  if (angle < 0) angle += Math.PI * 2;
  const v = (angle / (Math.PI * 2)) * A;
  const j = Math.min(R - 1, Math.floor(u));
  const i = Math.min(A - 1, Math.floor(v));
  const a = j * (A + 1) + i;
  const b = a + 1;
  const c = a + (A + 1);
  const d = c + 1;
  // The same split the index uses: (a, b, c) below the diagonal, (b, d, c) above.
  const lower = u - j + (v - i) <= 1;
  return onTriangle(grid.positions, lower ? a : b, lower ? b : d, c, x, z);
}

/** Just the height, for callers that do not need the slope. */
export function gridHeightAt(grid: LandscapeGrid, x: number, z: number): number {
  return sampleGrid(grid, x, z).heightM;
}

function onTriangle(positions: Float32Array, ia: number, ib: number, ic: number, x: number, z: number): GridSample {
  const ax = positions[ia * 3] ?? 0;
  const ay = positions[ia * 3 + 1] ?? 0;
  const az = positions[ia * 3 + 2] ?? 0;
  const bx = positions[ib * 3] ?? 0;
  const by = positions[ib * 3 + 1] ?? 0;
  const bz = positions[ib * 3 + 2] ?? 0;
  const cx = positions[ic * 3] ?? 0;
  const cy = positions[ic * 3 + 1] ?? 0;
  const cz = positions[ic * 3 + 2] ?? 0;
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(det) < 1e-9) return { heightM: ay, slope: 0 };
  const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
  const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
  const heightM = wa * ay + wb * by + (1 - wa - wb) * cy;
  // The triangle's normal, from the cross product of two of its edges.
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const slope = Math.abs(ny) < 1e-9 ? Number.POSITIVE_INFINITY : Math.hypot(nx, nz) / Math.abs(ny);
  return { heightM, slope };
}

/** A polar grid over the country beyond the plain, displaced by `landscapeHeight`. */
export function buildLandscapeGrid(terrain: TerrainSpec, rng: Rng): LandscapeGrid {
  const noise = createNoise2D(rng);
  const innerM = TERRAIN.mountainInnerM * LANDSCAPE.plainShare;
  const outerM = LANDSCAPE.outerM;
  const A = LANDSCAPE.around;
  const R = LANDSCAPE.outwards;
  const positions = new Float32Array((A + 1) * (R + 1) * 3);
  let maxHeightM = 0;

  for (let j = 0; j <= R; j++) {
    const t = Math.pow(j / R, LANDSCAPE.ringPower);
    const r = innerM + (outerM - innerM) * t;
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // The seam column is copied from the first, so the ring closes exactly.
      const h = i === A ? (positions[(j * (A + 1)) * 3 + 1] ?? 0) : landscapeHeight(terrain, noise, x, z);
      const k = (j * (A + 1) + i) * 3;
      positions[k] = x;
      positions[k + 1] = h;
      positions[k + 2] = z;
      // Read back what was stored, not what was computed: the buffer is 32-bit,
      // and a snow line set from the 64-bit value sits a hair above the peak.
      const stored = positions[k + 1] ?? 0;
      if (stored > maxHeightM) maxHeightM = stored;
    }
  }

  const index = new Uint32Array(A * R * 6);
  let n = 0;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * (A + 1) + i;
      const b = a + 1;
      const c = a + (A + 1);
      const d = c + 1;
      // Wound so the surface faces up. Rings run outwards and columns run
      // anticlockwise seen from above, and (a, c, b) under that layout faces
      // the ground: it was the first thing written, and the normals test
      // below is what says so.
      index[n++] = a;
      index[n++] = b;
      index[n++] = c;
      index[n++] = b;
      index[n++] = d;
      index[n++] = c;
    }
  }
  return { positions, index, maxHeightM, innerM };
}

/**
 * The woods on the hills. The landscape is coloured by what would grow at
 * each height, but a colour is not a wood: from the cloud band a slope
 * painted green is felt, and the same slope carrying trees has a grain that
 * catches the light the way the real thing does. So the hills get trees, in
 * stands with clearings between them, thinning out towards the tree line and
 * never on a face too steep to hold soil.
 */
export const FOREST = {
  /** How many to try to place. The clearings reject most of them. */
  attempts: 120000,
  /** Where the woods reach from and to, in metres from the centre. */
  fromM: TERRAIN.mountainInnerM * LANDSCAPE.plainShare + 12,
  toM: 2300,
  /**
   * Above 1, tries crowd towards the valley, where the woods are seen from
   * closest; far out, under the haze, a thin scatter reads the same.
   */
  nearBias: 1.8,
  /** Size of a stand of trees, and how much of the land they cover. */
  standScaleM: 170,
  standCover: 0.5,
  /** As a share of the highest point: above this, no trees. */
  treeLine: 0.52,
  /** Rise over run: steeper than this is rock. */
  maxSlope: 0.9,
  /** Stay back from the water. */
  shoreM: 18,
  /** Below this height the woods are mostly broadleaf, above it conifer. */
  broadleafBelowM: 55,
  /** Sunk this far into the ground, so none stands on a corner of air. */
  sinkM: 0.6,
} as const;

export interface ForestTree {
  x: number;
  y: number;
  z: number;
  /** 1 is an ordinary tree; the meshes are drawn to that size. */
  size: number;
  conifer: boolean;
  /** A small colour shift, about 1. */
  tint: number;
}

export function buildForest(terrain: TerrainSpec, grid: LandscapeGrid, rng: Rng): ForestTree[] {
  const noise = createNoise2D(rng);
  const trees: ForestTree[] = [];
  const f = 1 / FOREST.standScaleM;
  const treeLineM = grid.maxHeightM * FOREST.treeLine;
  const standFrom = 1 - FOREST.standCover;
  for (let n = 0; n < FOREST.attempts; n++) {
    const r = FOREST.fromM + (FOREST.toM - FOREST.fromM) * Math.pow(rng(), FOREST.nearBias);
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const roll = rng();
    // In stands, with clearings between them, and the edge of a stand thins
    // out rather than stopping at a line.
    const stand = 0.5 + 0.5 * noise(x * f, z * f);
    if (roll > smoothstep(standFrom, standFrom + 0.2, stand)) continue;
    if (waterDepthAt(terrain.water, x, z) > -FOREST.shoreM) continue;
    const ground = sampleGrid(grid, x, z);
    // Thinning out towards the tree line rather than stopping at a ruled height.
    if (ground.heightM > treeLineM * (0.72 + 0.28 * rng())) continue;
    if (ground.slope > FOREST.maxSlope) continue;
    const conifer = ground.heightM > FOREST.broadleafBelowM ? rng() < 0.82 : rng() < 0.3;
    trees.push({
      x,
      y: ground.heightM - FOREST.sinkM,
      z,
      size: 0.8 + rng() * 0.6,
      conifer,
      tint: 0.84 + rng() * 0.3,
    });
  }
  return trees;
}
