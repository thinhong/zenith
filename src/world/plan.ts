import {
  createGridIndex,
  distanceToSegment,
  rectCorners,
  rectsOverlap,
  rotYAlong,
  segmentCrossing,
  segmentRectDistance,
  type Vec2,
} from '@/world/geometry2d';
import { createNoise2D, LANDSCAPE, type Noise2D } from '@/world/landscape';
import {
  createGraph,
  largestComponent,
  PAVEMENT_M,
  planBridges,
  ROADS,
  type DraftEdge,
  type Point,
  type RoadGraph,
  type RoadKind,
} from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { centrelinePoint, TERRAIN, waterDepthAt, type TerrainSpec } from '@/world/terrain';

/**
 * The town plan: where the roads go, before anything is built along them.
 *
 * It used to be one grid clipped to a circle with a ring road round the rim,
 * which from the air read exactly as that: a round pizza of equal squares.
 * Nothing real is planned in one go. A town grows out along the roads that
 * lead to it, each part laid out in the fashion of its day and lined up on
 * whatever road it grew from, and the joins between the parts are where the
 * interesting shapes are: the wedge where two grids meet at an angle, the
 * side street that meets the high road at sixty degrees, the close that
 * stops dead.
 *
 * So this builds a town the same way, in layers:
 *
 * 1. **A core**, laid out first: a grid for a planned centre or a citadel, or
 *    lanes radiating from a market square for a town that grew round one,
 *    with a few greens kept open between its rings.
 * 2. **A ring** round the core, where a wall was or a boulevard is.
 * 3. **Arterials**, main roads leading out through the country, curving
 *    gently, not evenly spaced, running on past the edge of town as country
 *    roads.
 * 4. **Collectors**, one street down the middle of each wedge between two
 *    arterials, so every wedge splits into two districts.
 * 5. **Districts**, one per half-wedge, each with its own character (a
 *    regular grid, large blocks, winding lanes, a suburb of closes), each
 *    lined up on the arterial it grew from, each with its own block size.
 * 6. **The edge**, an outline that wanders and reaches out along the
 *    arterials, because a town sprawls along its roads.
 *
 * Every piece is drawn as short straight segments, and then all of them are
 * joined into one graph wherever they cross (`planarize`), so the joins
 * between districts take care of themselves.
 *
 * Pure: no three.js. The era files choose a style; `parcels.ts` puts lots
 * along the result.
 */

const TAU = Math.PI * 2;

export const PLAN = {
  /** Length of one straight piece of a street that wanders. */
  curveStepM: 22,
  /** Sampling along a main road, a ring or a collector. */
  lineStepM: 14,
  /** How far a street is carried past the edge of its district, so it meets the road there. */
  meetM: 5,
  /** Ends closer than this become one junction. */
  snapM: 1.2,
  /** Dead ends shorter than this are what an overshooting street leaves behind. */
  stubM: 11,
  /** Road pieces shorter than this are folded into the junction at one end. */
  minEdgeM: 3,
  /**
   * A district street running alongside a main road, nearer than this, is
   * dropped: it would be a service lane stacked against the boulevard.
   */
  parallelClearM: 18,
  parallelCos: 0.9,
  /** Roads stop short of the hills, because they are drawn flat. */
  countryStopM: TERRAIN.mountainInnerM * LANDSCAPE.plainShare - 35,
  /** A park must be at least this on its short side. */
  minParkM: 14,
  /** A green between the rings of a radial town is at most this across. */
  greenMaxM: 38,
  /** A long street is only ever left out between cross streets at most this far apart. */
  dropUpToM: 60,
  /** How far past the edge of town lattices are laid, so nothing inside is missed. */
  latticeReachM: 80,
} as const;

export type RoadPattern = 'grid' | 'radial';

/** How lots are cut along the streets of one part of town. */
export interface ParcelStyle {
  /** Width along the street. */
  frontM: readonly [number, number];
  /** Depth back from the pavement. */
  depthM: readonly [number, number];
  /** Space between the pavement and the front wall. */
  setbackM: number;
  /** Space between one building and the next along the street. */
  gapM: readonly [number, number];
  /** Share of the frontage that gets a building at all. */
  fill: number;
  /** Chance of a lower annex behind the main building. */
  annexChance: number;
  /** Chance the ground behind a front lot is built on too, back to back. */
  backfill: number;
}

export interface DistrictStyle {
  /** What this kind of district is called, for the tests and the HUD. */
  name: string;
  /** How often it is chosen, against the others. */
  weight: number;
  /** Spacing of the cross streets, which run away from the main road. */
  pitchM: readonly [number, number];
  /** Spacing of the long streets, which run beside it. */
  acrossM: readonly [number, number];
  /** How much further apart the cross streets get towards the edge of town. */
  grade: number;
  streetM: number;
  /** How far the streets wander, and how long one wander is. */
  warpM: number;
  warpScaleM: number;
  /** Share of street pieces left out: bigger blocks and T-junctions. */
  dropShare: number;
  /** Share of cross streets that stop at the first long street. */
  deadEndShare: number;
  /** Share of long streets that grow a short close into the block. */
  closeShare: number;
  /** How far the grid may turn from the road it is lined up on. */
  skewRad: number;
  /** Chance a block is kept as a park. */
  parkChance: number;
  parcel: ParcelStyle;
}

export interface CoreStyle {
  /** How far the core reaches in each direction. */
  radiusAt: (angle: number) => number;
  pattern: RoadPattern;
  pitchM: readonly [number, number];
  acrossM: readonly [number, number];
  streetM: number;
  warpM: number;
  warpScaleM: number;
  /** A fixed turn for the core grid, or null for a chosen one. */
  turnRad: number | null;
  dropShare: number;
  parkChance: number;
  parcel: ParcelStyle;
  /** Lines exactly through the centre, evenly spaced: a planned citadel. */
  exact?: boolean;
  /** Radial pattern: how many lanes leave the square, and along which angles some must. */
  spokes?: number;
  spokeAngles?: readonly number[];
  /** Radial pattern: rings of lane, as shares of the core radius. */
  rings?: readonly number[];
  /** Radial pattern: short lanes between the rings. */
  alleys?: number;
  /** Radial pattern: pieces of ground between two rings and two lanes kept open as greens. */
  greens?: number;
  /** Ground nothing is laid through: a palace precinct, a moat. */
  keepOut?: (x: number, z: number) => boolean;
}

export interface PlanStyle {
  /** The town's edge: mean radius as a share of the settlement, and how it wanders. */
  outline: { share: number; wobble: number; fingerM: number; fingerRad: number };
  core: CoreStyle;
  /** A road round the core, offset from its edge (negative runs inside it). */
  ring: { offsetM: number; widthM: number; kind: RoadKind } | null;
  arterials: {
    count: number;
    /** Fixed angles, for a town whose roads leave by its gates. */
    angles?: readonly number[];
    widthM: number;
    countryWidthM: number;
    wanderRad: number;
    /**
     * How far past the ring a road runs straight out before it starts to
     * wander. A road that leaves by a gate leaves it square to the wall.
     */
    calmM?: number;
    /** How far past the edge of town they run as country roads. */
    reachM: number;
  };
  /** Width of the street down the middle of each wedge. 0 for none. */
  collectorM: number;
  /** The kinds of district, chosen per half-wedge. Empty for a town that ends at its wall. */
  districts: readonly DistrictStyle[];
  shoreRoad: { offsetM: number; widthM: number } | null;
  /** Houses strung out along the country roads, past the edge. */
  ribbon: { reachM: number; parcel: ParcelStyle } | null;
  /** An open square in the middle of the core, with a street round it. */
  square: { wM: number; dM: number; lot: 'park' | null } | null;
}

/** Open ground the lot placer keeps clear. */
export interface Reserve {
  x: number;
  z: number;
  wM: number;
  dM: number;
  rotY: number;
  /** A park lot is made of it; null keeps it open with nothing on it. */
  lot: 'park' | null;
}

export interface TownPlan {
  roads: RoadGraph;
  reserves: Reserve[];
  /** How lots are cut at a point, or null where nothing is built. */
  parcelAt: (x: number, z: number) => ParcelStyle | null;
  /** 0 in the middle of town, 1 at its edge in that direction. */
  reach: (x: number, z: number) => number;
  /** The road round the core, in order round it. */
  ring: Point[];
  /** The name of the district at a point, or null. For the tests and the HUD. */
  districtAt: (x: number, z: number) => string | null;
}

/** Region codes. Districts count up from 1. */
const WATER = -3;
const OUTSIDE = -2;
const SQUARE = -1;
const KEEP = -4;
const CORE = 0;

export interface RoadPiece {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  kind: RoadKind;
  widthM: number;
  /** Which of two roads drawn over each other wins. */
  rank: number;
  /** A main road: arterials, the ring, collectors, the shore road, the square. */
  main: boolean;
  /**
   * For a main road: how close a district street may run alongside it before
   * it is dropped. Wide for the roads that run outwards, narrow for the ring
   * and the square, which a grid meets side on all the way round.
   */
  besideM?: number;
}

/** A road that runs outwards, as an angle that drifts with distance. */
interface Curve {
  base: number;
  amp: number;
  freq: number;
  phase: number;
  /** The wander is nothing at `calmFromM` and full `calmM` further out. */
  calmFromM?: number;
  calmM?: number;
}

function wrap(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

function angleDiff(a: number, b: number): number {
  const d = wrap(a - b);
  return d > Math.PI ? d - TAU : d;
}

function curveAngle(curve: Curve, r: number): number {
  let fade = 1;
  if (curve.calmM !== undefined && curve.calmM > 0) {
    const t = Math.min(1, Math.max(0, (r - (curve.calmFromM ?? 0)) / curve.calmM));
    fade = t * t * (3 - 2 * t);
  }
  return curve.base + curve.amp * fade * Math.sin(r * curve.freq + curve.phase);
}

/** Runs a plan to the end in one go. For tests, and for anything with no frame to protect. */
export function planTown(rng: Rng, terrain: TerrainSpec, style: PlanStyle): TownPlan {
  const steps = planSteps(rng, terrain, style);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * The plan, built in steps so an era change never blocks a frame: the era's
 * own generator yields between them (world/eras/index.ts EraBuild).
 */
export function* planSteps(rng: Rng, terrain: TerrainSpec, style: PlanStyle): Generator<void, TownPlan, void> {
  const water = terrain.water;
  const dry = (x: number, z: number): boolean => waterDepthAt(water, x, z) < -ROADS.bankMarginM;
  const noise = createNoise2D(rng);
  const R = terrain.cityRadiusM * style.outline.share;
  const core = style.core;
  const ringOffset = style.ring?.offsetM ?? 0;
  const ringAt = (angle: number): number => core.radiusAt(angle) + ringOffset;

  // --- the main roads out, and the edge of town that follows them -----------
  const arterials = arterialCurves(rng, style, R, ringAt, dry);
  const outlineAt = makeOutline(rng, style, R, arterials, ringAt);
  const n = arterials.length;
  const collectors: Curve[] = arterials.map((curve, k) => {
    const next = arterials[(k + 1) % n] ?? curve;
    const gap = n > 1 ? wrap(next.base - curve.base) : TAU;
    return {
      base: curve.base + gap / 2,
      amp: range(rng, 0.03, 0.1) * gap,
      freq: range(rng, 0.005, 0.011),
      phase: range(rng, 0, TAU),
    };
  });
  const collectorOffset = (k: number, r: number): number => {
    const a = arterials[k];
    const b = arterials[(k + 1) % n];
    const c = collectors[k];
    if (!a || !b || !c) return Math.PI;
    const gap = n > 1 ? wrap(curveAngle(b, r) - curveAngle(a, r)) || TAU : TAU;
    const wander = c.amp * Math.sin(r * c.freq + c.phase);
    return Math.min(gap * 0.85, Math.max(gap * 0.15, gap / 2 + wander));
  };

  // --- the square in the middle ----------------------------------------------
  const turn = core.turnRad ?? range(rng, 0, Math.PI / 2);
  const coreU: Vec2 = { x: Math.cos(turn), z: Math.sin(turn) };
  const coreV: Vec2 = { x: -coreU.z, z: coreU.x };
  const square = style.square;
  const squareHalfW = square ? square.wM / 2 + PAVEMENT_M + core.streetM / 2 : 0;
  const squareHalfD = square ? square.dM / 2 + PAVEMENT_M + core.streetM / 2 : 0;
  const inSquare = (x: number, z: number): boolean => {
    if (!square) return false;
    return (
      Math.abs(x * coreU.x + z * coreU.z) < squareHalfW - 0.5 && Math.abs(x * coreV.x + z * coreV.z) < squareHalfD - 0.5
    );
  };

  // --- which part of town a point is in ---------------------------------------
  const districts: DistrictStyle[] = pickDistricts(rng, style.districts, n * 2);
  const hasDistricts = districts.length > 0 && n > 0;
  const sectorAt = (r: number, angle: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const curve = arterials[k];
      if (!curve) continue;
      const d = wrap(angle - curveAngle(curve, r));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return 1 + best * 2 + (bestD < collectorOffset(best, r) ? 0 : 1);
  };
  const regionAt = (x: number, z: number): number => {
    if (!dry(x, z)) return WATER;
    if (inSquare(x, z)) return SQUARE;
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    if (r < ringAt(angle)) return core.keepOut?.(x, z) ? KEEP : CORE;
    if (!hasDistricts || r > outlineAt(angle)) return OUTSIDE;
    return sectorAt(r, angle);
  };

  const pieces: RoadPiece[] = [];
  const reserves: Reserve[] = [];

  // --- the ring -----------------------------------------------------------------
  const ringPoints: Point[] = [];
  if (style.ring) {
    const meanM = ringAt(0) * 0.5 + ringAt(Math.PI) * 0.5;
    const steps = Math.max(24, Math.round((TAU * meanM) / PLAN.lineStepM));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * TAU;
      const r = ringAt(angle);
      ringPoints.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
    }
    for (let i = 0; i < ringPoints.length; i++) {
      const p = ringPoints[i];
      const q = ringPoints[(i + 1) % ringPoints.length];
      if (!p || !q || !dry(p.x, p.z) || !dry(q.x, q.z)) continue;
      pieces.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, kind: style.ring.kind, widthM: style.ring.widthM, rank: 4, main: true, besideM: 5 });
    }
  }

  // --- the arterials and the collectors -------------------------------------
  for (const curve of arterials) {
    const r0 = ringAt(curve.base) - PLAN.meetM;
    const r1 = Math.min(outlineAt(curve.base) + style.arterials.reachM, PLAN.countryStopM);
    polar(curve, r0, r1, (p, q) => {
      if (!dry(p.x, p.z) || !dry(q.x, q.z)) return;
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      const inside = Math.hypot(mx, mz) < outlineAt(Math.atan2(mz, mx));
      pieces.push({
        ax: p.x,
        az: p.z,
        bx: q.x,
        bz: q.z,
        kind: inside ? 'avenue' : 'street',
        widthM: inside ? style.arterials.widthM : style.arterials.countryWidthM,
        rank: inside ? 3 : 1.5,
        main: true,
      });
    });
  }
  if (hasDistricts && style.collectorM > 0) {
    for (let k = 0; k < n; k++) {
      const a = arterials[k];
      if (!a) continue;
      const angleAt = (r: number): number => curveAngle(a, r) + collectorOffset(k, r);
      const r0 = ringAt(angleAt(ringAt(a.base))) - PLAN.meetM;
      const r1 = outlineAt(angleAt(R)) - 6;
      let previous: Point | null = null;
      for (let r = r0; r <= r1 + 1e-6; r += PLAN.lineStepM) {
        const angle = angleAt(r);
        const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
        if (previous && dry(p.x, p.z) && dry(previous.x, previous.z)) {
          pieces.push({ ax: previous.x, az: previous.z, bx: p.x, bz: p.z, kind: 'street', widthM: style.collectorM, rank: 2, main: true });
        }
        previous = p;
      }
    }
  }

  // --- the shore road ---------------------------------------------------------
  if (style.shoreRoad) shoreRoad(pieces, terrain, style.shoreRoad, outlineAt, dry);

  // --- the square, with a street round it -------------------------------------
  // A grid core lays its own street round the square (below). A radial one
  // needs it drawn, because its lanes start from the square's edge.
  if (square && core.pattern === 'radial') {
    const corners = [
      [-squareHalfW, -squareHalfD],
      [squareHalfW, -squareHalfD],
      [squareHalfW, squareHalfD],
      [-squareHalfW, squareHalfD],
    ].map(([a, b]) => ({
      x: coreU.x * (a ?? 0) + coreV.x * (b ?? 0),
      z: coreU.z * (a ?? 0) + coreV.z * (b ?? 0),
    }));
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % 4];
      if (!p || !q) continue;
      pieces.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, kind: 'street', widthM: core.streetM, rank: 2.5, main: true, besideM: 5 });
    }
  }
  if (square) {
    reserves.push({ x: 0, z: 0, wM: square.wM, dM: square.dM, rotY: rotYAlong(coreU.x, coreU.z), lot: square.lot });
  }
  yield;

  // --- the core ---------------------------------------------------------------
  const extent = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ringAt((i / 8) * TAU))) + 10;
  const lattice: RoadPiece[] = [];
  const clip = makeClipper(regionAt, lattice);
  if (core.pattern === 'grid') {
    // With a square in the middle, the grid is laid out from the square's own
    // edges, so the street round the square is simply the grid's first line
    // on each side and nothing of the grid falls inside it.
    const aLines = core.exact
      ? exactLines(core.pitchM[0], extent)
      : square
        ? mirrored(rng, core.pitchM, squareHalfW, extent)
        : lines(rng, core.pitchM, -extent, extent, 0, R);
    const bLines = core.exact
      ? exactLines(core.acrossM[0], extent)
      : square
        ? mirrored(rng, core.acrossM, squareHalfD, extent)
        : lines(rng, core.acrossM, -extent, extent, 0, R);
    latticePieces({
      rng,
      noise,
      own: CORE,
      origin: { x: 0, z: 0 },
      u: coreU,
      v: coreV,
      aLines,
      bLines,
      crossFrom: null,
      streetM: core.streetM,
      warpM: core.warpM,
      warpScaleM: core.warpScaleM,
      dropShare: core.dropShare,
      deadEndShare: 0,
      closeShare: 0,
      parkChance: core.parkChance,
      clip,
      regionAt,
      reserves,
    });
  } else {
    radialPieces(rng, core, ringAt, clip, regionAt, reserves);
  }
  yield;

  // --- the districts ------------------------------------------------------------
  if (hasDistricts) {
    for (let k = 0; k < n; k++) {
      if (k > 0) yield;
      for (const half of [0, 1] as const) {
        const own = 1 + k * 2 + half;
        const district = districts[own - 1];
        const anchor = arterials[half === 0 ? k : (k + 1) % n];
        if (!district || !anchor) continue;
        const frame = districtFrame(rng, anchor, district, half, ringAt, outlineAt);
        const reachM = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => outlineAt((i / 8) * TAU))) + PLAN.latticeReachM;
        latticePieces({
          rng,
          noise,
          own,
          origin: frame.origin,
          u: frame.u,
          v: frame.v,
          aLines: lines(rng, district.pitchM, -reachM * 0.6, reachM, district.grade, R),
          bLines: lines(rng, district.acrossM, district.acrossM[0] * range(rng, 0.8, 1.05), reachM, 0, R),
          crossFrom: -district.acrossM[1],
          streetM: district.streetM,
          warpM: district.warpM,
          warpScaleM: district.warpScaleM,
          dropShare: district.dropShare,
          deadEndShare: district.deadEndShare,
          closeShare: district.closeShare,
          parkChance: district.parkChance,
          clip,
          regionAt,
          reserves,
        });
      }
    }
  }
  yield;

  // Streets that would run alongside a main road go; the main road serves them.
  const mains = pieces.filter((p) => p.main);
  const mainIndex = createGridIndex(40);
  mains.forEach((p, i) =>
    mainIndex.insert(i, Math.min(p.ax, p.bx), Math.min(p.az, p.bz), Math.max(p.ax, p.bx), Math.max(p.az, p.bz)),
  );
  for (const piece of lattice) {
    if (!runsAlongside(piece, mains, mainIndex)) pieces.push(piece);
  }
  yield;

  // --- one graph -------------------------------------------------------------------
  const drafted = planarize(pieces);
  yield;
  const cleaned = cleanUp(drafted.points, drafted.edges);
  if (water.kind === 'river') {
    for (const bridge of planBridges(cleaned.points, cleaned.edges)) {
      cleaned.edges.push({ a: bridge.a, b: bridge.b, kind: 'avenue', widthM: style.arterials.widthM * 0.8 });
    }
  }
  const roads = largestComponent(createGraph(cleaned.points, cleaned.edges));

  const parcelAt = (x: number, z: number): ParcelStyle | null => {
    const region = regionAt(x, z);
    if (region === CORE) return core.parcel;
    if (region >= 1) return districts[region - 1]?.parcel ?? null;
    if (region === OUTSIDE && style.ribbon) {
      const r = Math.hypot(x, z);
      if (r < outlineAt(Math.atan2(z, x)) + style.ribbon.reachM && r < PLAN.countryStopM) return style.ribbon.parcel;
    }
    return null;
  };

  return {
    roads,
    reserves,
    parcelAt,
    reach: (x, z) => Math.hypot(x, z) / Math.max(1, outlineAt(Math.atan2(z, x))),
    ring: ringPoints,
    districtAt: (x, z) => {
      const region = regionAt(x, z);
      if (region === CORE) return 'core';
      if (region >= 1) return districts[region - 1]?.name ?? null;
      return null;
    },
  };
}

/**
 * Where the main roads leave. Spread round the town with a good deal of
 * slack, so the wedges between them are not all the same size, and never
 * straight out to sea.
 */
function arterialCurves(
  rng: Rng,
  style: PlanStyle,
  R: number,
  ringAt: (angle: number) => number,
  dry: (x: number, z: number) => boolean,
): Curve[] {
  const spec = style.arterials;
  const bases: number[] = [];
  if (spec.angles) bases.push(...spec.angles);
  else {
    const start = range(rng, 0, TAU);
    const step = TAU / Math.max(1, spec.count);
    for (let k = 0; k < spec.count; k++) bases.push(start + k * step + range(rng, -0.3, 0.3) * step);
  }
  const curves: Curve[] = [];
  for (const base of bases) {
    const curve: Curve = {
      base: wrap(base),
      amp: spec.angles ? spec.wanderRad : range(rng, 0.4, 1) * spec.wanderRad,
      freq: range(rng, 0.004, 0.009),
      phase: range(rng, 0, TAU),
      calmFromM: ringAt(base),
      calmM: spec.calmM ?? 0,
    };
    if (!spec.angles) {
      // Out to sea is not a road.
      const probe = Math.max(ringAt(curve.base) + 40, R * 0.75);
      const angle = curveAngle(curve, probe);
      if (!dry(Math.cos(angle) * probe, Math.sin(angle) * probe)) continue;
    }
    curves.push(curve);
  }
  curves.sort((a, b) => a.base - b.base);
  return curves;
}

/**
 * The edge of town: a slow wobble at a few wavelengths, and a reach out along
 * each main road, because that is where a town spreads first.
 */
function makeOutline(
  rng: Rng,
  style: PlanStyle,
  R: number,
  arterials: readonly Curve[],
  ringAt: (angle: number) => number,
): (angle: number) => number {
  const o = style.outline;
  const waves = [
    { n: 2, a: 0.55 },
    { n: 3, a: 0.45 },
    { n: 5, a: 0.28 },
    { n: 7, a: 0.16 },
  ].map((w) => ({ n: w.n, a: w.a * o.wobble * range(rng, 0.6, 1), p: range(rng, 0, TAU) }));
  const fingers = arterials.map((curve) => ({ angle: curveAngle(curve, R), m: o.fingerM * range(rng, 0.5, 1) }));
  return (angle) => {
    let r = 1;
    for (const w of waves) r += w.a * Math.sin(w.n * angle + w.p);
    let out = R * r;
    for (const f of fingers) {
      const d = angleDiff(angle, f.angle) / o.fingerRad;
      out += f.m * Math.exp(-d * d);
    }
    return Math.max(out, ringAt(angle) + 60);
  };
}

/** Calls `visit` for each straight piece of a polar curve between two radii. */
function polar(curve: Curve, r0: number, r1: number, visit: (p: Point, q: Point) => void): void {
  let previous: Point | null = null;
  for (let r = r0; r <= r1 + 1e-6; r += PLAN.lineStepM) {
    const angle = curveAngle(curve, r);
    const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    if (previous) visit(previous, p);
    previous = p;
  }
}

/** One district per half-wedge, weighted, and never the same kind twice running. */
function pickDistricts(rng: Rng, kinds: readonly DistrictStyle[], count: number): DistrictStyle[] {
  if (kinds.length === 0) return [];
  const total = kinds.reduce((sum, k) => sum + k.weight, 0);
  const out: DistrictStyle[] = [];
  for (let i = 0; i < count; i++) {
    let chosen: DistrictStyle | undefined;
    for (let tries = 0; tries < 6; tries++) {
      let roll = rng() * total;
      for (const kind of kinds) {
        roll -= kind.weight;
        if (roll <= 0) {
          chosen = kind;
          break;
        }
      }
      if (chosen !== out[i - 1] || kinds.length === 1) break;
    }
    const fallback = kinds[0];
    if (chosen) out.push(chosen);
    else if (fallback) out.push(fallback);
  }
  return out;
}

/**
 * The frame a district is laid out in: lined up on the arterial it grew
 * from, turned a little off it, with its long streets running beside it on
 * the district's own side.
 */
function districtFrame(
  rng: Rng,
  anchor: Curve,
  district: DistrictStyle,
  half: 0 | 1,
  ringAt: (angle: number) => number,
  outlineAt: (angle: number) => number,
): { origin: Point; u: Vec2; v: Vec2 } {
  const r0 = ringAt(anchor.base);
  const rMid = (r0 + outlineAt(anchor.base)) / 2;
  const at = (r: number): Point => {
    const angle = curveAngle(anchor, r);
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  };
  const p = at(rMid - 6);
  const q = at(rMid + 6);
  const length = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  const skew = range(rng, -district.skewRad, district.skewRad);
  const tx = (q.x - p.x) / length;
  const tz = (q.z - p.z) / length;
  const u = { x: tx * Math.cos(skew) - tz * Math.sin(skew), z: tx * Math.sin(skew) + tz * Math.cos(skew) };
  let v = { x: -u.z, z: u.x };
  // Pointing into the district: the way the angle grows for the first half,
  // back the other way for the second.
  const midAngle = curveAngle(anchor, rMid);
  const tangential = { x: -Math.sin(midAngle), z: Math.cos(midAngle) };
  const into = v.x * tangential.x + v.z * tangential.z;
  if ((half === 0 && into < 0) || (half === 1 && into > 0)) v = { x: -v.x, z: -v.z };
  return { origin: at(r0), u, v };
}

/** Positions of lattice lines between `from` and `to`, spaced by `pitch` and wider by `grade` far out. */
function lines(
  rng: Rng,
  pitch: readonly [number, number],
  from: number,
  to: number,
  grade: number,
  R: number,
): number[] {
  const out: number[] = [];
  const spacing = (at: number): number => range(rng, pitch[0], pitch[1]) * (1 + (grade * Math.max(0, at)) / R);
  let at = from;
  while (at <= to) {
    out.push(at);
    at += spacing(at);
  }
  return out;
}

/** Lines at plus and minus `half`, then outwards on both sides at the pitch. */
function mirrored(rng: Rng, pitch: readonly [number, number], half: number, extent: number): number[] {
  const out = [-half, half];
  for (const side of [-1, 1]) {
    let at = half;
    for (;;) {
      at += range(rng, pitch[0], pitch[1]);
      if (at > extent) break;
      out.push(side * at);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Evenly spaced lines through zero exactly. */
function exactLines(pitch: number, extent: number): number[] {
  const out: number[] = [];
  const count = Math.ceil(extent / pitch);
  for (let i = -count; i <= count; i++) out.push(i * pitch);
  return out;
}

type Clip = (ax: number, az: number, bx: number, bz: number, own: number, template: Omit<RoadPiece, 'ax' | 'az' | 'bx' | 'bz'>) => void;

/**
 * Keeps the part of a piece inside its own region. Where it leaves across a
 * road (into the core, another district or the square), it is carried on a
 * few metres so it meets that road; where it leaves into the country or the
 * water, it simply stops.
 */
function makeClipper(regionAt: (x: number, z: number) => number, out: RoadPiece[]): Clip {
  return (ax, az, bx, bz, own, template) => {
    const ra = regionAt(ax, az);
    const rb = regionAt(bx, bz);
    if (ra === own && rb === own) {
      out.push({ ...template, ax, az, bx, bz });
      return;
    }
    if (ra !== own && rb !== own) return;
    const inside = ra === own ? { x: ax, z: az } : { x: bx, z: bz };
    const outside = ra === own ? { x: bx, z: bz } : { x: ax, z: az };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const x = inside.x + (outside.x - inside.x) * mid;
      const z = inside.z + (outside.z - inside.z) * mid;
      if (regionAt(x, z) === own) lo = mid;
      else hi = mid;
    }
    const length = Math.hypot(outside.x - inside.x, outside.z - inside.z) || 1;
    const beyond = regionAt(
      inside.x + (outside.x - inside.x) * hi,
      inside.z + (outside.z - inside.z) * hi,
    );
    const meets = beyond >= 0 || beyond === SQUARE;
    const t = meets ? lo + PLAN.meetM / length : lo;
    out.push({
      ...template,
      ax: inside.x,
      az: inside.z,
      bx: inside.x + (outside.x - inside.x) * t,
      bz: inside.z + (outside.z - inside.z) * t,
    });
  };
}

interface LatticeSpec {
  rng: Rng;
  noise: Noise2D;
  own: number;
  origin: Point;
  u: Vec2;
  v: Vec2;
  /** Positions of the cross streets along u. */
  aLines: readonly number[];
  /** Positions of the long streets along v. */
  bLines: readonly number[];
  /** Where cross streets start, beyond the road the district is lined up on; null to start at the first long street. */
  crossFrom: number | null;
  streetM: number;
  warpM: number;
  warpScaleM: number;
  dropShare: number;
  deadEndShare: number;
  closeShare: number;
  parkChance: number;
  clip: Clip;
  regionAt: (x: number, z: number) => number;
  reserves: Reserve[];
}

/**
 * A grid, bent. The lattice is regular in its own frame, and a smooth
 * displacement field moves every point of it, so the streets curve and the
 * blocks change size and angle across the district while every junction is
 * still shared by the streets that meet at it.
 */
function latticePieces(spec: LatticeSpec): void {
  const { rng, noise, own, origin, u, v, aLines, bLines, clip } = spec;
  const scale = 1 / Math.max(1, spec.warpScaleM);
  const ox = range(rng, -300, 300);
  const oz = range(rng, -300, 300);
  const warp = (x: number, z: number): Point =>
    spec.warpM <= 0
      ? { x, z }
      : {
          x: x + spec.warpM * noise(x * scale + ox, z * scale + oz),
          z: z + spec.warpM * noise(x * scale + oz + 17.1, z * scale - ox - 5.3),
        };
  const at = (a: number, b: number): Point =>
    warp(origin.x + u.x * a + v.x * b, origin.z + u.z * a + v.z * b);
  const template = { kind: 'street' as RoadKind, widthM: spec.streetM, rank: 1, main: false };
  const segments = spec.warpM > 2.5 ? (length: number) => Math.max(1, Math.round(length / PLAN.curveStepM)) : () => 1;

  const street = (a0: number, b0: number, a1: number, b1: number): void => {
    const p = at(a0, b0);
    const q = at(a1, b1);
    const count = segments(Math.hypot(q.x - p.x, q.z - p.z));
    let previous = p;
    for (let s = 1; s <= count; s++) {
      const t = s / count;
      const next = s === count ? q : at(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t);
      clip(previous.x, previous.z, next.x, next.z, own, template);
      previous = next;
    }
  };

  // Long streets, beside the road the district is lined up on. One is left
  // out only between cross streets close enough together that the block it
  // opens up still has frontage all round; between far-apart ones it would
  // leave a field in the middle of town.
  for (let j = 0; j < bLines.length; j++) {
    const b = bLines[j] ?? 0;
    for (let i = 0; i + 1 < aLines.length; i++) {
      const a0 = aLines[i] ?? 0;
      const a1 = aLines[i + 1] ?? 0;
      if (rng() < spec.dropShare && a1 - a0 <= PLAN.dropUpToM) continue;
      street(a0, b, a1, b);
      // A close: a short dead end into the block, which is what a suburb
      // built after the car is made of.
      if (j + 1 < bLines.length && rng() < spec.closeShare) {
        const mid = (a0 + a1) / 2;
        const deep = Math.min(((bLines[j + 1] ?? b) - b) * 0.45, 38);
        if (deep > 14) street(mid, b, mid, b + deep);
      }
    }
  }
  // Cross streets, running away from it.
  const firstB = bLines[0] ?? 0;
  for (let i = 0; i < aLines.length; i++) {
    const a = aLines[i] ?? 0;
    if (spec.crossFrom !== null) street(a, spec.crossFrom, a, firstB);
    for (let j = 0; j + 1 < bLines.length; j++) {
      if (rng() < spec.dropShare) continue;
      if (j > 0 && rng() < spec.deadEndShare) continue;
      street(a, bLines[j] ?? 0, a, bLines[j + 1] ?? 0);
    }
  }

  // Some blocks are kept as parks.
  if (spec.parkChance <= 0) return;
  for (let i = 0; i + 1 < aLines.length; i++) {
    for (let j = 0; j + 1 < bLines.length; j++) {
      if (rng() >= spec.parkChance) continue;
      const a0 = aLines[i] ?? 0;
      const a1 = aLines[i + 1] ?? 0;
      const b0 = bLines[j] ?? 0;
      const b1 = bLines[j + 1] ?? 0;
      const c = [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
      if (!c.every((p) => spec.regionAt(p.x, p.z) === own)) continue;
      const [p0, p1, p2, p3] = c as [Point, Point, Point, Point];
      const alongX = (p1.x - p0.x + p2.x - p3.x) / 2;
      const alongZ = (p1.z - p0.z + p2.z - p3.z) / 2;
      const acrossX = (p3.x - p0.x + p2.x - p1.x) / 2;
      const acrossZ = (p3.z - p0.z + p2.z - p1.z) / 2;
      const clearM = spec.streetM + (PAVEMENT_M + 1.5) * 2;
      const wM = Math.hypot(alongX, alongZ) - clearM;
      const dM = Math.hypot(acrossX, acrossZ) - clearM;
      if (Math.min(wM, dM) < PLAN.minParkM) continue;
      spec.reserves.push({
        x: (p0.x + p1.x + p2.x + p3.x) / 4,
        z: (p0.z + p1.z + p2.z + p3.z) / 4,
        wM,
        dM,
        rotY: rotYAlong(alongX, alongZ),
        lot: 'park',
      });
    }
  }
}

/**
 * Lanes that radiate from a market square to the gates, crossed by rings of
 * lane at two or three distances, with short alleys between the rings. That
 * is the plan of a town that grew round a market rather than one that was
 * laid out, and it is the plan of nearly every walled town in Europe.
 */
/** The most a radial lane wanders off its line, in radians. */
const SPOKE_WANDER_RAD = 0.09;
/** The most a ring of lane wanders in and out, as a share of its radius. */
const RING_WOBBLE = 0.07;

function radialPieces(
  rng: Rng,
  core: CoreStyle,
  ringAt: (angle: number) => number,
  clip: Clip,
  regionAt: (x: number, z: number) => number,
  reserves: Reserve[],
): void {
  const template = { kind: 'street' as RoadKind, widthM: core.streetM, rank: 1.2, main: false };
  const angles: number[] = [...(core.spokeAngles ?? [])];
  const wanted = Math.max(angles.length, core.spokes ?? 6);
  // Fill the widest gaps first, so the spokes end up roughly even.
  while (angles.length < wanted) {
    if (angles.length === 0) {
      angles.push(range(rng, 0, TAU));
      continue;
    }
    const sorted = [...angles].map(wrap).sort((a, b) => a - b);
    let widest = 0;
    let at = 0;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i] ?? 0;
      const b = i + 1 < sorted.length ? (sorted[i + 1] ?? 0) : (sorted[0] ?? 0) + TAU;
      if (b - a > widest) {
        widest = b - a;
        at = a;
      }
    }
    angles.push(at + widest * range(rng, 0.4, 0.6));
  }
  for (const base of angles) {
    const curve: Curve = {
      base,
      amp: range(rng, 0.03, SPOKE_WANDER_RAD),
      freq: range(rng, 0.02, 0.05),
      phase: range(rng, 0, TAU),
    };
    const r1 = ringAt(base) + PLAN.meetM;
    let previous: Point | null = null;
    for (let r = 0; r <= r1; r += PLAN.lineStepM * 0.8) {
      const angle = curveAngle(curve, r);
      const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      if (previous) clip(previous.x, previous.z, p.x, p.z, CORE, template);
      previous = p;
    }
  }
  const rings = core.rings ?? [0.5];
  for (const share of rings) {
    const wobble = range(rng, 0.03, RING_WOBBLE);
    const phase = range(rng, 0, TAU);
    const meanM = ringAt(0) * share;
    const steps = Math.max(18, Math.round((TAU * meanM) / (PLAN.lineStepM * 0.8)));
    let previous: Point | null = null;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * TAU;
      const r = ringAt(angle) * share * (1 + wobble * Math.sin(3 * angle + phase));
      const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      if (previous) clip(previous.x, previous.z, p.x, p.z, CORE, template);
      previous = p;
    }
  }
  const bands = [...rings, 1].sort((a, b) => a - b);
  // Greens: a piece of ground between two rings and two lanes kept open, the
  // green with the well on it that a town like this has somewhere. Without
  // them a radial town has no open ground at all, because it has no blocks
  // to leave empty.
  const greens: Reserve[] = [];
  const spokes = [...angles].map(wrap).sort((a, b) => a - b);
  const clearM = core.streetM / 2 + PAVEMENT_M + 1.5;
  const wantedGreens = core.greens ?? 0;
  for (let tries = 0; greens.length < wantedGreens && tries < wantedGreens * 8; tries++) {
    const k = Math.floor(rng() * spokes.length);
    const a = spokes[k] ?? 0;
    const b = k + 1 < spokes.length ? (spokes[k + 1] ?? 0) : (spokes[0] ?? 0) + TAU;
    const band = Math.floor(rng() * (bands.length - 1));
    const inner = bands[band] ?? 0.5;
    const outer = bands[band + 1] ?? 1;
    const angle = (a + b) / 2 + range(rng, -0.15, 0.15) * (b - a);
    const reach = ringAt(angle);
    const r = (reach * (inner + outer)) / 2;
    // Clear of the lanes either side however far they wander, and of the
    // rings above and below however far they wobble.
    const side = Math.min(angle - a, b - angle) - SPOKE_WANDER_RAD;
    const wM = Math.min(PLAN.greenMaxM, 2 * (r * Math.sin(Math.max(0, side)) - clearM));
    const dM = Math.min(PLAN.greenMaxM * 0.8, reach * (outer - inner) - reach * RING_WOBBLE * (inner + outer) - 2 * clearM);
    if (Math.min(wM, dM) < PLAN.minParkM) continue;
    const green: Reserve = {
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      wM,
      dM,
      rotY: rotYAlong(-Math.sin(angle), Math.cos(angle)),
      lot: 'park',
    };
    const grown = { ...green, wM: wM + clearM * 2, dM: dM + clearM * 2 };
    if (!rectCorners(green).every((p) => regionAt(p.x, p.z) === CORE)) continue;
    if ([...reserves, ...greens].some((other) => rectsOverlap(grown, other))) continue;
    greens.push(green);
  }
  reserves.push(...greens);

  // Alleys between the rings, and from the last ring to the edge, but never
  // across a green.
  for (let i = 0; i < (core.alleys ?? 0); i++) {
    const band = Math.floor(rng() * (bands.length - 1));
    const inner = bands[band] ?? 0.5;
    const outer = bands[band + 1] ?? 1;
    const angle = range(rng, 0, TAU);
    const reach = ringAt(angle);
    const r0 = reach * inner - PLAN.meetM;
    const r1 = reach * outer + PLAN.meetM;
    const bend = range(rng, -0.05, 0.05);
    const mid = (r0 + r1) / 2;
    const p = { x: Math.cos(angle) * r0, z: Math.sin(angle) * r0 };
    const m = { x: Math.cos(angle + bend) * mid, z: Math.sin(angle + bend) * mid };
    const q = { x: Math.cos(angle) * r1, z: Math.sin(angle) * r1 };
    const crosses = greens.some(
      (green) =>
        segmentRectDistance(p.x, p.z, m.x, m.z, green) < clearM || segmentRectDistance(m.x, m.z, q.x, q.z, green) < clearM,
    );
    if (crosses) continue;
    clip(p.x, p.z, m.x, m.z, CORE, template);
    clip(m.x, m.z, q.x, q.z, CORE, template);
  }
}

/** A road along the shore, set back from the water, as far as the town reaches. */
function shoreRoad(
  pieces: RoadPiece[],
  terrain: TerrainSpec,
  spec: { offsetM: number; widthM: number },
  outlineAt: (angle: number) => number,
  dry: (x: number, z: number) => boolean,
): void {
  const water = terrain.water;
  const offsets =
    water.kind === 'river'
      ? [-(water.halfWidthM + spec.offsetM), water.halfWidthM + spec.offsetM]
      : [-spec.offsetM];
  for (const offset of offsets) {
    let previous: Point | null = null;
    for (let i = 0; i < water.offsetsM.length; i++) {
      const c = centrelinePoint(water, i);
      const p = { x: c.x + water.nrmX * offset, z: c.z + water.nrmZ * offset };
      const r = Math.hypot(p.x, p.z);
      const keep = dry(p.x, p.z) && r < outlineAt(Math.atan2(p.z, p.x)) + 30;
      if (keep && previous) {
        pieces.push({
          ax: previous.x,
          az: previous.z,
          bx: p.x,
          bz: p.z,
          kind: 'avenue',
          widthM: spec.widthM,
          rank: 2.5,
          main: true,
        });
      }
      previous = keep ? p : null;
    }
  }
}

/** Whether a district street runs alongside a main road, too close to be worth having. */
function runsAlongside(
  piece: RoadPiece,
  mains: readonly RoadPiece[],
  index: ReturnType<typeof createGridIndex>,
): boolean {
  const mx = (piece.ax + piece.bx) / 2;
  const mz = (piece.az + piece.bz) / 2;
  const length = Math.hypot(piece.bx - piece.ax, piece.bz - piece.az) || 1;
  const dx = (piece.bx - piece.ax) / length;
  const dz = (piece.bz - piece.az) / length;
  const reach = PLAN.parallelClearM + 16;
  let alongside = false;
  index.query(mx - reach, mz - reach, mx + reach, mz + reach, (i) => {
    const main = mains[i];
    if (!main) return;
    const mainLength = Math.hypot(main.bx - main.ax, main.bz - main.az) || 1;
    const cos = Math.abs(((main.bx - main.ax) * dx + (main.bz - main.az) * dz) / mainLength);
    if (cos < PLAN.parallelCos) return;
    // Beyond the end of a main road is not beside it: that is a street
    // carrying on where the road stops, like a lane in through a gate.
    const along = ((mx - main.ax) * (main.bx - main.ax) + (mz - main.az) * (main.bz - main.az)) / (mainLength * mainLength);
    if (along < 0 || along > 1) return;
    const clearM = (main.besideM ?? PLAN.parallelClearM) + (main.widthM + piece.widthM) / 2 - PLAN.meetM;
    if (distanceToSegment(mx, mz, main.ax, main.az, main.bx, main.bz) < clearM) {
      alongside = true;
      return true;
    }
  });
  return alongside;
}

/**
 * Joins every piece into one graph: wherever two cross, or one ends against
 * another, both are cut there and share a junction.
 */
export function planarize(pieces: readonly RoadPiece[]): { points: Point[]; edges: DraftEdge[] } {
  const index = createGridIndex(24);
  const pad = PLAN.snapM;
  pieces.forEach((p, i) =>
    index.insert(
      i,
      Math.min(p.ax, p.bx) - pad,
      Math.min(p.az, p.bz) - pad,
      Math.max(p.ax, p.bx) + pad,
      Math.max(p.az, p.bz) + pad,
    ),
  );
  const cuts: number[][] = pieces.map(() => [0, 1]);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!p) continue;
    const lengthP = Math.hypot(p.bx - p.ax, p.bz - p.az);
    if (lengthP < 1e-6) continue;
    index.query(
      Math.min(p.ax, p.bx) - pad,
      Math.min(p.az, p.bz) - pad,
      Math.max(p.ax, p.bx) + pad,
      Math.max(p.az, p.bz) + pad,
      (j) => {
        if (j <= i) return;
        const q = pieces[j];
        if (!q) return;
        const lengthQ = Math.hypot(q.bx - q.ax, q.bz - q.az);
        if (lengthQ < 1e-6) return;
        const hit = segmentCrossing(p.ax, p.az, p.bx, p.bz, q.ax, q.az, q.bx, q.bz);
        if (!hit) return;
        const slackP = pad / lengthP;
        const slackQ = pad / lengthQ;
        if (hit.t < -slackP || hit.t > 1 + slackP || hit.u < -slackQ || hit.u > 1 + slackQ) return;
        cuts[i]?.push(Math.min(1, Math.max(0, hit.t)));
        cuts[j]?.push(Math.min(1, Math.max(0, hit.u)));
      },
    );
  }

  const points: Point[] = [];
  const cells = new Map<string, number[]>();
  const nodeAt = (x: number, z: number): number => {
    const cx = Math.floor(x / PLAN.snapM);
    const cz = Math.floor(z / PLAN.snapM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const id of cells.get(`${cx + dx},${cz + dz}`) ?? []) {
          const p = points[id];
          if (p && Math.hypot(p.x - x, p.z - z) < PLAN.snapM) return id;
        }
      }
    }
    points.push({ x, z });
    const id = points.length - 1;
    const key = `${cx},${cz}`;
    const list = cells.get(key);
    if (list) list.push(id);
    else cells.set(key, [id]);
    return id;
  };

  const best = new Map<string, { edge: DraftEdge; rank: number }>();
  pieces.forEach((p, i) => {
    const ts = [...new Set((cuts[i] ?? []).map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
    let previous = -1;
    for (const t of ts) {
      const id = nodeAt(p.ax + (p.bx - p.ax) * t, p.az + (p.bz - p.az) * t);
      if (previous >= 0 && previous !== id) {
        const key = previous < id ? `${previous}:${id}` : `${id}:${previous}`;
        const held = best.get(key);
        if (!held || p.rank > held.rank || (p.rank === held.rank && p.widthM > held.edge.widthM)) {
          best.set(key, { edge: { a: previous, b: id, kind: p.kind, widthM: p.widthM }, rank: p.rank });
        }
      }
      previous = id;
    }
  });
  return { points, edges: [...best.values()].map((held) => held.edge) };
}

/**
 * Folds pieces too short to matter into the junction at one end, then takes
 * off the stubs a street leaves where it overshot a road.
 */
function cleanUp(points: Point[], edges: DraftEdge[]): { points: Point[]; edges: DraftEdge[] } {
  // Short pieces: merge their two ends.
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (const e of edges) {
    const a = points[e.a];
    const b = points[e.b];
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.z - a.z) < PLAN.minEdgeM) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  const merged = new Map<string, DraftEdge>();
  for (const e of edges) {
    const a = find(e.a);
    const b = find(e.b);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const held = merged.get(key);
    if (!held || e.widthM > held.widthM) merged.set(key, { ...e, a, b });
  }
  let kept = [...merged.values()];

  // Stubs: a short dead end off a junction is an overshoot, not a street.
  for (let pass = 0; pass < 3; pass++) {
    const degree = new Int32Array(points.length);
    for (const e of kept) {
      degree[e.a] = (degree[e.a] ?? 0) + 1;
      degree[e.b] = (degree[e.b] ?? 0) + 1;
    }
    const before = kept.length;
    kept = kept.filter((e) => {
      const a = points[e.a];
      const b = points[e.b];
      if (!a || !b) return false;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length >= PLAN.stubM) return true;
      const loose = (degree[e.a] ?? 0) === 1 || (degree[e.b] ?? 0) === 1;
      return !loose;
    });
    if (kept.length === before) break;
  }
  return { points, edges: kept };
}
