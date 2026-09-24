import type { Structure } from '@/world/eras';
import { orientToFrame, toLocal, toWorld, type Frame } from '@/world/frame';
import { createGridIndex, distanceToSegment, rectBounds, rotYAlong, type OrientedRect } from '@/world/geometry2d';
import type { Lot } from '@/world/lots';
import { lakeDepthAt, lakeRadiusAt, type Lake } from '@/world/plan';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * Gardens made round water, for an era that makes them (2300). Pure: lots
 * and the square in the middle of town in, structures, trees and ponds out
 * (AGENTS.md 3).
 *
 * Every park is a garden round a pond: a chain of overlapping pools with a
 * pale stone edge, a line of stepping stones across its narrowest part, an
 * island with one tree on it when the pond is big enough, rocks at the edge,
 * a gravel path in from the street, and trees in groves, a few of them red
 * maples. In the bigger ones a tea house stands half over the water.
 *
 * The middle of town is its own thing (`buildHeart`): a great hall on a pond
 * that fills the square.
 *
 * Ponds are discs, because a disc is the one shape the renderer has that is
 * round (the `round` structure), and overlapping discs of one colour make a
 * pond of any shape. Everything is laid out round the lot's own centre, as if
 * the lot were unturned, and turned with it (world/frame.ts).
 */
export interface WaterGardenStyle {
  moss: readonly number[];
  water: number;
  /** The stone at a pond's edge. */
  rim: number;
  stone: readonly number[];
  rock: readonly number[];
  gravel: number;
  cedar: readonly number[];
  roof: readonly number[];
  post: number;
  /** The great hall's roofs, and its galleries' and towers': tile, darker than a house's. */
  hallRoof: number;
  /** The hall's posts: dark timber. */
  timber: number;
  /** Gilding on the hall's ridges, and a ginkgo's leaves in autumn. */
  gold: number;
  /** The big trees of the wood behind the hall: a darker green than the town's. */
  wood: number;
  reed: number;
  /** The grass of the square the hall stands in: quieter than a park's. */
  lawn: number;
  /** Paper: the lanterns' lights. */
  paper: number;
  /** A tree's own leaf colour, for the few that are not the era's green. */
  redMaple: number;
  redShare: number;
}

/** A tree a garden plants itself, rather than one world/props.ts places. */
export interface PlantedTree {
  x: number;
  z: number;
  radiusM: number;
  heightM: number;
  /** Several slender stems, rather than one trunk. */
  stems: boolean;
  /** Its own leaf colour, when it is not the era's. */
  colour?: number;
}

/** A disc of water. */
export interface Pond {
  x: number;
  z: number;
  radiusM: number;
}

export interface Lookout {
  x: number;
  z: number;
  faceX: number;
  faceZ: number;
}

export interface WaterGardens {
  structures: Structure[];
  trees: PlantedTree[];
  ponds: Pond[];
  /** Ground over water that can be walked on: bridge planks and islands. */
  dry: OrientedRect[];
  islands: Pond[];
  /** What somebody on foot cannot walk through: the tea houses' decks. */
  barriers: OrientedRect[];
  lookout: Lookout | null;
}

export const WATER_GARDEN = {
  /** Around the edge of a park: moss stops this far in, as the grass of a park does (world/parks.ts). */
  edgeM: 1.2,
  /** The front of a park, its street side, is kept dry this deep, so it can be walked into. */
  frontDryM: 8,
  /** And the other sides this far. */
  sideDryM: 3,
  /** A park narrower than this has one small pool at the back, not a pond; narrower than `poolFromM`, none. */
  pondFromM: 22,
  poolFromM: 10,
  /** A pond's pools: how many, and how big against the park's short side. */
  pools: [3, 6] as const,
  poolShare: [0.13, 0.24] as const,
  minPoolM: 2.2,
  /** Heights of the layers: moss, the stone edge, the water, a stepping stone, an island. */
  mossY: 0.04,
  rimH: 0.08,
  waterH: 0.1,
  stoneH: 0.16,
  islandH: 0.18,
  rimM: 0.7,
  stepM: 0.34,
  stepPitchM: 0.8,
  /** A pool at least this big grows an island with a tree on it. */
  islandFromM: 6,
  /** A tea house: deck, how high, roof height and size. */
  teaFromM: 26,
  teaShare: 0.5,
  teaDeckM: 4.2,
  teaDeckH: 0.42,
  teaRoofY: 2.9,
  /** Trees in a park, per 100 square metres of it, and the least room between two. */
  treesPer100: 0.9,
  treeGapM: 3.2,
  pathM: 1.6,
} as const;

function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.max(0, Math.floor(roll * colours.length)));
  return colours[index] ?? 0x808080;
}

function inPools(pools: readonly Pond[], x: number, z: number, marginM: number): boolean {
  return pools.some((pool) => Math.hypot(x - pool.x, z - pool.z) < pool.radiusM + marginM);
}

/**
 * A chain of overlapping pools along a gently turning line, inside a
 * rectangle of the lot's unturned frame.
 */
function poolChain(
  rng: Rng,
  cx: number,
  cz: number,
  halfW: number,
  halfD: number,
  shortM: number,
): Pond[] {
  const pools: Pond[] = [];
  const count = Math.round(range(rng, WATER_GARDEN.pools[0], WATER_GARDEN.pools[1]));
  let heading = range(rng, 0, Math.PI * 2);
  let x = cx + range(rng, -0.3, 0.3) * halfW;
  let z = cz + range(rng, -0.3, 0.3) * halfD;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    let r = shortM * range(rng, WATER_GARDEN.poolShare[0], WATER_GARDEN.poolShare[1]);
    if (i > 0) {
      heading += range(rng, -0.7, 0.7);
      const step = (previous + r) * 0.62;
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
    }
    // Kept inside, shrinking to fit, and turned back toward the middle when it strays.
    const room = Math.min(halfW - Math.abs(x - cx), halfD - Math.abs(z - cz)) - WATER_GARDEN.rimM;
    r = Math.min(r, room);
    if (r < WATER_GARDEN.minPoolM) {
      heading = Math.atan2(cz - z, cx - x);
      x = Math.min(cx + halfW - WATER_GARDEN.minPoolM, Math.max(cx - halfW + WATER_GARDEN.minPoolM, x));
      z = Math.min(cz + halfD - WATER_GARDEN.minPoolM, Math.max(cz - halfD + WATER_GARDEN.minPoolM, z));
      continue;
    }
    pools.push({ x, z, radiusM: r });
    previous = r;
  }
  return pools;
}

/** Water, and the stone edge round it, one pool at a time: overlapping, they make one pond. */
function drawPools(out: Structure[], pools: readonly Pond[], style: WaterGardenStyle): void {
  for (const pool of pools) {
    const rimR = pool.radiusM + WATER_GARDEN.rimM;
    out.push({ kind: 'round', x: pool.x, y: 0, z: pool.z, wM: rimR * 2, hM: WATER_GARDEN.rimH, dM: rimR * 2, rotY: 0, colour: style.rim });
  }
  for (const pool of pools) {
    out.push({ kind: 'round', x: pool.x, y: 0, z: pool.z, wM: pool.radiusM * 2, hM: WATER_GARDEN.waterH, dM: pool.radiusM * 2, rotY: 0, colour: style.water });
  }
}

/** A low rock: a squat four-sided pyramid reads as a stone set in moss. */
function rock(out: Structure[], rng: Rng, x: number, z: number, style: WaterGardenStyle): void {
  const w = range(rng, 0.8, 1.9);
  out.push({ kind: 'roof', x, y: 0, z, wM: w, hM: range(rng, 0.35, 0.85), dM: w * range(rng, 0.6, 1), rotY: range(rng, 0, Math.PI), colour: pick(style.rock, rng()) });
}

function tree(rng: Rng, style: WaterGardenStyle, x: number, z: number, big = false): PlantedTree {
  const red = rng() < style.redShare;
  const planted: PlantedTree = {
    x,
    z,
    radiusM: big ? range(rng, 4.2, 5.4) : range(rng, 2, 3.3),
    heightM: big ? range(rng, 9, 11.5) : range(rng, 5.2, 8),
    stems: !big && rng() < 0.8,
  };
  if (red && !big) planted.colour = style.redMaple;
  return planted;
}

export function buildWaterGardens(rng: Rng, lots: readonly Lot[], style: WaterGardenStyle): WaterGardens {
  const structures: Structure[] = [];
  const trees: PlantedTree[] = [];
  const ponds: Pond[] = [];
  const islands: Pond[] = [];
  const dry: OrientedRect[] = [];
  const barriers: OrientedRect[] = [];
  const lookout: Lookout | null = null;

  for (const lot of lots) {
    if (lot.use !== 'park' || lot.heightM > 0) continue;
    const from = structures.length;
    const W = lot.wM;
    const D = lot.dM;
    const shortM = Math.min(W, D);
    structures.push({
      kind: 'flat',
      x: lot.x,
      y: WATER_GARDEN.mossY,
      z: lot.z,
      wM: W - WATER_GARDEN.edgeM * 2,
      hM: 1,
      dM: D - WATER_GARDEN.edgeM * 2,
      rotY: 0,
      colour: pick(style.moss, lot.jitter),
    });
    const localTrees: PlantedTree[] = [];
    const localIslands: Pond[] = [];
    let pools: Pond[] = [];
    let pathX: number | null = null;
    if (shortM < WATER_GARDEN.pondFromM && shortM >= WATER_GARDEN.poolFromM) {
      // A small garden: one still pool at the back, a rock beside it.
      const r = shortM * range(rng, 0.2, 0.26);
      const x = lot.x + range(rng, -0.2, 0.2) * W;
      const z = lot.z + D / 2 - WATER_GARDEN.sideDryM - WATER_GARDEN.rimM - r;
      if (z - r > lot.z - D / 2 + 3) {
        pools = [{ x, z, radiusM: r }];
        drawPools(structures, pools, style);
        const angle = range(rng, 0, Math.PI * 2);
        rock(structures, rng, x + Math.cos(angle) * (r + 0.9), z + Math.sin(angle) * (r + 0.9), style);
      }
    } else if (shortM >= WATER_GARDEN.pondFromM) {
      // The pond keeps clear of the street side, which is the way in.
      const front = -D / 2 + WATER_GARDEN.frontDryM;
      const back = D / 2 - WATER_GARDEN.sideDryM;
      const halfW = W / 2 - WATER_GARDEN.sideDryM;
      const halfD = (back - front) / 2;
      pools = poolChain(rng, lot.x, lot.z + (front + back) / 2, halfW, halfD, shortM);
      drawPools(structures, pools, style);

      // Stepping stones across the smallest pool, square to the chain.
      const narrow = [...pools].sort((a, b) => a.radiusM - b.radiusM)[0];
      if (narrow && pools.length > 1) {
        const angle = range(rng, 0, Math.PI);
        const count = Math.floor((narrow.radiusM * 2) / WATER_GARDEN.stepPitchM);
        for (let i = 0; i <= count; i++) {
          const t = -narrow.radiusM + i * WATER_GARDEN.stepPitchM;
          structures.push({
            kind: 'round',
            x: narrow.x + Math.cos(angle) * t,
            y: 0,
            z: narrow.z + Math.sin(angle) * t,
            wM: WATER_GARDEN.stepM * 2,
            hM: WATER_GARDEN.stoneH,
            dM: WATER_GARDEN.stepM * 2 * range(rng, 0.8, 1),
            rotY: range(rng, 0, Math.PI),
            colour: pick(style.stone, rng()),
          });
        }
      }

      // An island with one tree, in the biggest pool if it is big enough.
      const biggest = [...pools].sort((a, b) => b.radiusM - a.radiusM)[0];
      if (biggest && biggest.radiusM >= WATER_GARDEN.islandFromM) {
        const r = biggest.radiusM * 0.3;
        const x = biggest.x + range(rng, -0.25, 0.25) * biggest.radiusM;
        const z = biggest.z + range(rng, -0.25, 0.25) * biggest.radiusM;
        structures.push({ kind: 'round', x, y: 0, z, wM: r * 2, hM: WATER_GARDEN.islandH, dM: r * 2, rotY: 0, colour: pick(style.moss, rng()) });
        localTrees.push(tree(rng, style, x, z));
        localIslands.push({ x, z, radiusM: r });
      }

      // A tea house half over the water, in the bigger gardens.
      if (biggest && shortM >= WATER_GARDEN.teaFromM && rng() < WATER_GARDEN.teaShare) {
        const toward = Math.atan2(lot.z - biggest.z, lot.x - biggest.x) + range(rng, -0.6, 0.6);
        const edge = biggest.radiusM - 0.6;
        const x = biggest.x + Math.cos(toward) * edge;
        const z = biggest.z + Math.sin(toward) * edge;
        const deck = WATER_GARDEN.teaDeckM;
        structures.push({ kind: 'box', x, y: 0, z, wM: deck, hM: WATER_GARDEN.teaDeckH, dM: deck, rotY: 0, colour: pick(style.cedar, rng()) });
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          structures.push({ kind: 'box', x: x + sx * (deck / 2 - 0.2), y: 0, z: z + sz * (deck / 2 - 0.2), wM: 0.14, hM: WATER_GARDEN.teaRoofY, dM: 0.14, rotY: 0, colour: style.post });
        }
        const roofW = deck + 1.2;
        if (rng() < 0.5) {
          structures.push({ kind: 'roof', x, y: WATER_GARDEN.teaRoofY, z, wM: roofW, hM: 1.3, dM: roofW, rotY: 0, colour: pick(style.roof, rng()) });
        } else {
          structures.push({ kind: 'box', x, y: WATER_GARDEN.teaRoofY, z, wM: roofW, hM: 0.24, dM: roofW, rotY: 0, colour: pick(style.roof, rng()) });
          structures.push({ kind: 'box', x, y: WATER_GARDEN.teaRoofY - 0.06, z, wM: roofW - 0.06, hM: 0.06, dM: roofW - 0.06, rotY: 0, colour: pick(style.cedar, rng()) });
        }
        const deckAt = toWorld(lot, x - lot.x, z - lot.z);
        barriers.push({ x: deckAt.x, z: deckAt.z, wM: deck, dM: deck, rotY: lot.rotY });
      }

      // Rocks along the edge.
      for (const pool of pools) {
        if (rng() < 0.4) continue;
        const angle = range(rng, 0, Math.PI * 2);
        rock(structures, rng, pool.x + Math.cos(angle) * (pool.radiusM + 0.9), pool.z + Math.sin(angle) * (pool.radiusM + 0.9), style);
      }

      // A gravel path in from the street to the water.
      const nearest = [...pools].sort((a, b) => a.z - a.radiusM - (b.z - b.radiusM))[0];
      if (nearest) {
        const start = -D / 2 + WATER_GARDEN.edgeM;
        const end = nearest.z - lot.z - nearest.radiusM - WATER_GARDEN.rimM;
        if (end > start + 1) {
          pathX = nearest.x;
          structures.push({
            kind: 'flat',
            x: nearest.x,
            y: WATER_GARDEN.mossY + 0.02,
            z: lot.z + (start + end) / 2,
            wM: WATER_GARDEN.pathM,
            hM: 1,
            dM: end - start,
            rotY: 0,
            colour: style.gravel,
          });
        }
      }
    }

    // Groves: trees where there is room, off the water and the path, a little apart.
    const wanted = Math.max(1, Math.round(((W * D) / 100) * WATER_GARDEN.treesPer100));
    for (let tries = 0; tries < wanted * 6 && localTrees.length < wanted; tries++) {
      const x = lot.x + range(rng, -W / 2 + 2, W / 2 - 2);
      const z = lot.z + range(rng, -D / 2 + 2, D / 2 - 2);
      if (inPools(pools, x, z, 1.4)) continue;
      if (pathX !== null && Math.abs(x - pathX) < 1.8 && z < lot.z) continue;
      if (localTrees.some((t) => Math.hypot(t.x - x, t.z - z) < WATER_GARDEN.treeGapM)) continue;
      localTrees.push(tree(rng, style, x, z));
    }

    orientToFrame(structures, from, lot);
    for (const t of localTrees) {
      const at = toWorld(lot, t.x - lot.x, t.z - lot.z);
      trees.push({ ...t, x: at.x, z: at.z });
    }
    const lotPonds: Pond[] = [];
    for (const pool of pools) {
      const at = toWorld(lot, pool.x - lot.x, pool.z - lot.z);
      lotPonds.push({ x: at.x, z: at.z, radiusM: pool.radiusM });
    }
    ponds.push(...lotPonds);
    // So nobody who comes to the park stands in its pond (world/interior.ts spotOutside).
    if (lotPonds.length > 0) lot.ponds = lotPonds;
    for (const island of localIslands) {
      const at = toWorld(lot, island.x - lot.x, island.z - lot.z);
      islands.push({ x: at.x, z: at.z, radiusM: island.radiusM });
    }
  }

  return { structures, trees, ponds, dry, islands, barriers, lookout };
}

/**
 * A quick test for "is this in the water", for the tree planter and the
 * walker: the ponds and the lakes, less anything that can be walked on over
 * them (bridges, piers, islands). `marginM` grows the water by that much.
 */
export function wetTest(
  gardens: Pick<WaterGardens, 'ponds' | 'dry' | 'islands'>,
  lakes: readonly Lake[] = [],
): (x: number, z: number, marginM?: number) => boolean {
  const index = createGridIndex(24);
  gardens.ponds.forEach((pond, i) => {
    index.insert(i, pond.x - pond.radiusM - 3, pond.z - pond.radiusM - 3, pond.x + pond.radiusM + 3, pond.z + pond.radiusM + 3);
  });
  return (x, z, marginM = 0) => {
    let wet = false;
    index.query(x, z, x, z, (i) => {
      const pond = gardens.ponds[i];
      if (pond && Math.hypot(x - pond.x, z - pond.z) < pond.radiusM + marginM) wet = true;
    });
    if (!wet && lakes.length > 0 && lakeDepthAt(lakes, x, z) > -marginM) wet = true;
    if (!wet) return false;
    if (gardens.islands.some((island) => Math.hypot(x - island.x, z - island.z) < island.radiusM - 0.3)) return false;
    for (const plank of gardens.dry) {
      const local = toLocal(plank, x, z);
      if (Math.abs(local.x) < plank.wM / 2 && Math.abs(local.z) < plank.dM / 2) return false;
    }
    return true;
  };
}

/**
 * Ground free for a tree or a rock: off every building and its garden, and
 * off every lane and its verge.
 */
export function clearGround(lots: readonly Lot[], roads: RoadGraph): (x: number, z: number, padM: number) => boolean {
  const lotIndex = createGridIndex(24);
  lots.forEach((lot, i) => {
    const box = rectBounds(lot, (lot.garden?.depthM ?? 0) + 2);
    lotIndex.insert(i, box.minX, box.minZ, box.maxX, box.maxZ);
  });
  const roadIndex = createGridIndex(24);
  roads.edges.forEach((edge, i) => {
    const a = roads.nodes[edge.a];
    const b = roads.nodes[edge.b];
    if (!a || !b) return;
    const pad = edge.widthM / 2 + PAVEMENT_M + 3;
    roadIndex.insert(i, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
  });
  return (x, z, padM) => {
    let clear = true;
    lotIndex.query(x, z, x, z, (i) => {
      const lot = lots[i];
      if (!clear || !lot || lot.use === 'park') return;
      const local = toLocal(lot, x, z);
      const front = lot.dM / 2 + (lot.garden?.depthM ?? 0);
      if (Math.abs(local.x) < lot.wM / 2 + padM && local.z < lot.dM / 2 + padM && local.z > -front - padM) clear = false;
    });
    if (!clear) return false;
    roadIndex.query(x, z, x, z, (i) => {
      const edge = roads.edges[i];
      const a = edge ? roads.nodes[edge.a] : undefined;
      const b = edge ? roads.nodes[edge.b] : undefined;
      if (!clear || !edge || !a || !b) return;
      if (distanceToSegment(x, z, a.x, a.z, b.x, b.z) < edge.widthM / 2 + PAVEMENT_M + padM) clear = false;
    });
    return clear;
  };
}

export const LAKESIDE = {
  /** An island in the biggest lake: how big against the lake, and how far out from its middle. */
  islandShare: [0.13, 0.19] as const,
  islandOut: 0.3,
  /** A pier out over the water, as a share of the way to the middle, and its width. */
  pierShare: [0.32, 0.5] as const,
  pierM: 2,
  pierY: 0.45,
  shelterM: 4.6,
  /** A pavilion on stilts at the edge: its size, and how much of it stands over the water. */
  pavilion: [6.5, 5] as const,
  pavilionOver: 0.55,
  pavilionDeckY: 0.55,
  pavilionRoofY: 3.4,
  /** Trees along the shore: how far in from the water, and how far apart. */
  shoreTreeM: [3, 8] as const,
  shoreTreeGapM: 7,
  rocks: 8,
} as const;

export interface Lakesides {
  structures: Structure[];
  trees: PlantedTree[];
  /** Over the water, and walked on. */
  dry: OrientedRect[];
  islands: Pond[];
  barriers: OrientedRect[];
}

/**
 * What is built at the edge of the lakes in town: an island with trees in
 * the biggest, a timber pier out over each with a roof at its end, a
 * pavilion on stilts half over the water, rocks at the edge, and trees along
 * the shore wherever the ground is free.
 */
export function buildLakesides(
  rng: Rng,
  lakes: readonly Lake[],
  free: (x: number, z: number, padM: number) => boolean,
  style: WaterGardenStyle,
): Lakesides {
  const structures: Structure[] = [];
  const trees: PlantedTree[] = [];
  const dry: OrientedRect[] = [];
  const islands: Pond[] = [];
  const barriers: OrientedRect[] = [];
  const biggest = [...lakes].sort((a, b) => b.radiusM - a.radiusM)[0];

  for (const lake of lakes) {
    // --- an island, in the biggest ------------------------------------------------
    if (lake === biggest) {
      const angle = range(rng, 0, Math.PI * 2);
      const r = lake.radiusM * range(rng, LAKESIDE.islandShare[0], LAKESIDE.islandShare[1]);
      const out = lake.radiusM * LAKESIDE.islandOut;
      const x = lake.x + Math.cos(angle) * out;
      const z = lake.z + Math.sin(angle) * out;
      structures.push({ kind: 'round', x, y: 0, z, wM: (r + 0.8) * 2, hM: 0.14, dM: (r + 0.8) * 2, rotY: 0, colour: style.rim });
      structures.push({ kind: 'round', x, y: 0, z, wM: r * 2, hM: 0.2, dM: r * 2, rotY: 0, colour: pick(style.moss, rng()) });
      islands.push({ x, z, radiusM: r });
      trees.push(tree(rng, style, x + r * 0.2, z - r * 0.15, true));
      trees.push({ ...tree(rng, style, x - r * 0.45, z + r * 0.3), colour: style.redMaple });
      rock(structures, rng, x + r * 0.5, z + r * 0.5, style);
    }

    // --- a pier with a roof at its end ------------------------------------------------
    const pierAngle = range(rng, 0, Math.PI * 2);
    const edge = lakeRadiusAt(lake, pierAngle);
    const pierLength = edge * range(rng, LAKESIDE.pierShare[0], LAKESIDE.pierShare[1]);
    const outX = -Math.cos(pierAngle);
    const outZ = -Math.sin(pierAngle);
    const startX = lake.x + Math.cos(pierAngle) * (edge + 2.5);
    const startZ = lake.z + Math.sin(pierAngle) * (edge + 2.5);
    if (free(startX, startZ, 0.5)) {
      const total = pierLength + 2.5;
      const rotY = rotYAlong(outX, outZ);
      const midX = startX + outX * (total / 2);
      const midZ = startZ + outZ * (total / 2);
      const deck = pick(style.cedar, rng());
      structures.push({ kind: 'box', x: midX, y: 0, z: midZ, wM: total, hM: LAKESIDE.pierY, dM: LAKESIDE.pierM, rotY, colour: deck });
      dry.push({ x: midX, z: midZ, wM: total, dM: LAKESIDE.pierM, rotY });
      const endX = startX + outX * (total - LAKESIDE.shelterM / 2);
      const endZ = startZ + outZ * (total - LAKESIDE.shelterM / 2);
      const s = LAKESIDE.shelterM;
      structures.push({ kind: 'box', x: endX, y: 0, z: endZ, wM: s, hM: LAKESIDE.pierY, dM: s, rotY, colour: deck });
      dry.push({ x: endX, z: endZ, wM: s, dM: s, rotY });
      const sideX = -outZ;
      const sideZ = outX;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        structures.push({
          kind: 'box',
          x: endX + outX * a * (s / 2 - 0.2) + sideX * b * (s / 2 - 0.2),
          y: 0,
          z: endZ + outZ * a * (s / 2 - 0.2) + sideZ * b * (s / 2 - 0.2),
          wM: 0.13,
          hM: 3,
          dM: 0.13,
          rotY,
          colour: style.post,
        });
      }
      structures.push({ kind: 'box', x: endX, y: 3, z: endZ, wM: s + 1.2, hM: 0.22, dM: s + 1.2, rotY, colour: pick(style.roof, rng()) });
      structures.push({ kind: 'box', x: endX, y: 2.94, z: endZ, wM: s + 1.14, hM: 0.06, dM: s + 1.14, rotY, colour: pick(style.cedar, rng()) });
    }

    // --- a pavilion on stilts, half over the water ------------------------------------
    const pavAngle = pierAngle + Math.PI * range(rng, 0.6, 1.4);
    const pavEdge = lakeRadiusAt(lake, pavAngle);
    const [pw, pd] = LAKESIDE.pavilion;
    const inward = pd * (LAKESIDE.pavilionOver - 0.5);
    const px = lake.x + Math.cos(pavAngle) * (pavEdge - inward);
    const pz = lake.z + Math.sin(pavAngle) * (pavEdge - inward);
    const landX = lake.x + Math.cos(pavAngle) * (pavEdge + pd * 0.6);
    const landZ = lake.z + Math.sin(pavAngle) * (pavEdge + pd * 0.6);
    if (free(landX, landZ, 1)) {
      // Local +x along the shore, local +z out over the water.
      const rotY = rotYAlong(-Math.sin(pavAngle), Math.cos(pavAngle));
      structures.push({ kind: 'box', x: px, y: 0, z: pz, wM: pw, hM: LAKESIDE.pavilionDeckY, dM: pd, rotY, colour: pick(style.cedar, rng()) });
      dry.push({ x: px, z: pz, wM: pw, dM: pd, rotY });
      const ux = Math.cos(rotY);
      const uz = -Math.sin(rotY);
      const vx = Math.sin(rotY);
      const vz = Math.cos(rotY);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        structures.push({
          kind: 'box',
          x: px + ux * a * (pw / 2 - 0.25) + vx * b * (pd / 2 - 0.25),
          y: 0,
          z: pz + uz * a * (pw / 2 - 0.25) + vz * b * (pd / 2 - 0.25),
          wM: 0.15,
          hM: LAKESIDE.pavilionRoofY,
          dM: 0.15,
          rotY,
          colour: style.post,
        });
      }
      const roofW = pw + 2;
      const roofD = pd + 2;
      structures.push({ kind: 'box', x: px, y: LAKESIDE.pavilionRoofY, z: pz, wM: roofW, hM: 0.26, dM: roofD, rotY, colour: pick(style.roof, rng()) });
      structures.push({ kind: 'box', x: px, y: LAKESIDE.pavilionRoofY - 0.07, z: pz, wM: roofW - 0.06, hM: 0.07, dM: roofD - 0.06, rotY, colour: pick(style.cedar, rng()) });
    }

    // --- rocks at the edge, and trees along the shore ---------------------------------
    for (let i = 0; i < LAKESIDE.rocks; i++) {
      const t = range(rng, 0, Math.PI * 2);
      const r = lakeRadiusAt(lake, t) + range(rng, 0.2, 1.4);
      const x = lake.x + Math.cos(t) * r;
      const z = lake.z + Math.sin(t) * r;
      if (!free(x, z, 0.5)) continue;
      rock(structures, rng, x, z, style);
    }
    const around = 2 * Math.PI * lake.radiusM;
    const wanted = Math.floor(around / LAKESIDE.shoreTreeGapM);
    const shore: PlantedTree[] = [];
    for (let tries = 0; tries < wanted * 3 && shore.length < wanted * 0.8; tries++) {
      const t = range(rng, 0, Math.PI * 2);
      const r = lakeRadiusAt(lake, t) + range(rng, LAKESIDE.shoreTreeM[0], LAKESIDE.shoreTreeM[1]);
      const x = lake.x + Math.cos(t) * r;
      const z = lake.z + Math.sin(t) * r;
      if (!free(x, z, 1.5)) continue;
      if (shore.some((other) => Math.hypot(other.x - x, other.z - z) < LAKESIDE.shoreTreeGapM * 0.7)) continue;
      // Now and then a big old one, leaning over the water.
      shore.push(tree(rng, style, x, z, rng() < 0.12));
    }
    trees.push(...shore);
  }
  return { structures, trees, dry, islands, barriers };
}

/**
 * The heart of the town: a great hall on a pond.
 *
 * The pond fills most of the square, wider than it is deep, with a lobe at
 * the back and one at each front corner. The hall stands in the back of it
 * on a stone base just clear of the water, under two roofs, a lower one all
 * round and the great one over it, whose ends turn up. Open galleries run out
 * over the water to each side, to a tower where each turns forward, and one
 * runs back to the shore behind, which is the way in. From the air the roofs
 * are a bird with its wings open; from the far bank a long low line on the
 * water with one roof rising out of the middle of it.
 *
 * On the near bank, straight across the water from the hall, a timber
 * platform half over the water, which is where it is looked at from (the
 * day's lunch, story/days/after.ts). In the pond, an island with one old tree
 * and a lantern, reached by a bridge of planks that zig-zags; a heap of rocks
 * with a maple on it; lilies; reeds by the bridge. A gravel path round the
 * whole pond. Behind the hall a wood of big dark trees, so its roofs stand
 * against them; in front, open grass. Red maples at the water and two gold
 * ginkgos behind the hall are all the colour there is.
 *
 * It replaced a white ring of roof round a round pond, which was massive
 * enough and read from the air as a stadium: the one bright, hard-edged thing
 * in a town of dark roofs, timber and moss. The hall is the town's own
 * language, the same dark roofs and timber, only more of it.
 */
export const HEART = {
  /** The pond: its middle, from the square's (toward the front), its size and shape. */
  pond: {
    z: 4,
    radiusM: 52,
    // Wider than it is deep; a lobe at the back for the hall to stand in, and
    // one at each front corner.
    lobes: [
      { k: 2, amp: 0.14, phase: Math.PI / 2 },
      { k: 3, amp: 0.045, phase: 0 },
      { k: 5, amp: 0.02, phase: 0.7 },
    ],
  },
  /** The hall stands this far behind the square's middle, in the back of the pond. */
  hallZ: -16,
  /** The stone it stands on, just clear of the water; walked on. */
  base: { wM: 34, dM: 26, hM: 0.5 },
  /** Its timber floor round the walls, a hand higher than the stone; walked on too. */
  floor: { outM: 3.1, hM: 0.6 },
  /** The hall itself, a lot: paper walls, lit at night. */
  body: { wM: 18, dM: 11, hM: 7.2 },
  /** Posts all round under the lower roof, this far out from the walls and about this far apart. */
  veranda: { outM: 2.2, everyM: 3.3, sizeM: 0.36 },
  /** The lower roof all round, then the great one over it. */
  skirt: { wM: 30, dM: 22.5, y: 4.9, hM: 3.6 },
  roof: { wM: 22, dM: 16, y: 7.0, hM: 6.2 },
  /** The galleries out over the water: floor, posts, and a roof whose ends turn up. */
  wing: { widthM: 4.4, floorH: 0.45, eaveY: 4.1, roofWM: 6.4, roofH: 2.3, everyM: 3.2, postM: 0.24 },
  /** A tower where each wing turns forward: a room under two roofs. */
  tower: { x: 36, baseM: 8.6, bodyM: 5.2, bodyH: 7.4, skirtM: 9.8, skirtY: 3.8, skirtH: 1.7, roofM: 7.6, roofY: 7.0, roofH: 3.4 },
  /** How far the wings run on forward from the towers. */
  forwardM: 14,
  /** The gallery from the back of the hall runs this far on past the shore. */
  tailPastM: 4,
  /** The platform on the near bank the hall is looked at from, half over the water. */
  lookout: { wM: 12, dM: 7, hM: 0.32 },
  /** An island with one old tree on it, and a heap of rocks with a maple, from the square's middle. */
  island: { x: -33, z: 27, radiusM: 6.5 },
  rocks: { x: 27, z: 21, radiusM: 3.2 },
  /** The old tree on the island: wide and not tall, as a tree alone by water grows. */
  oldTree: { radiusM: 5.6, heightM: 9.5 },
  /** The bridge of planks to the island, in zig-zag lengths, each this far off the straight line. */
  zigzag: { planks: 4, widthM: 1.2, hM: 0.28, turnRad: 0.52 },
  lilies: { drifts: 10, perDrift: 14, spreadM: 5 },
  reeds: { clumps: 5, perClump: 18 },
  pathM: 3,
  /**
   * The gravel path round the pond: about this far from the water, wandering
   * nearer and further. At one distance all the way round it was a running
   * track round a pool.
   */
  stroll: { widthM: 2.4, outM: 7, wanderM: 3.2, wobbleM: 1.6, swingM: 2.2, leastM: 3.4, segments: 160 },
  /** The wood behind the hall: trees this far apart, kept this far from the water. */
  wood: { gapM: 6.2, waterM: 8.5, tries: 900 },
} as const;

export interface Heart {
  structures: Structure[];
  trees: PlantedTree[];
  /** The hall and its two towers, as lots: people come to them, and their windows light at night. */
  lots: Lot[];
  /** The pond, drawn with the lakes' water. */
  pond: Lake;
  /** What can be walked on over the water: the stone, the galleries, the platform, the planks. */
  dry: OrientedRect[];
  /** Floors, where no tree may be planted however dry they are. */
  floors: OrientedRect[];
  islands: Pond[];
  barriers: OrientedRect[];
  lookout: Lookout;
}

export function buildHeart(
  rng: Rng,
  square: { x: number; z: number; wM: number; dM: number; rotY: number },
  style: WaterGardenStyle,
  firstLotId: number,
): Heart {
  const frame: Frame = { x: square.x, z: square.z, rotY: square.rotY };
  const structures: Structure[] = [];
  const trees: PlantedTree[] = [];
  const lots: Lot[] = [];
  const dry: OrientedRect[] = [];
  const floors: OrientedRect[] = [];
  const barriers: OrientedRect[] = [];
  const islands: Pond[] = [];
  const cx = square.x;
  const cz = square.z;
  const halfW = square.wM / 2;
  const halfD = square.dM / 2;

  // Everything is laid out square to the world round the square's middle, as
  // if the square were unturned, and turned with it at the end.
  const P = HEART.pond;
  const pond: Lake = { x: cx, z: cz + P.z, radiusM: P.radiusM, lobes: P.lobes };
  const shore = (angle: number, outM = 0): { x: number; z: number } => {
    const r = lakeRadiusAt(pond, angle) + outM;
    return { x: pond.x + Math.cos(angle) * r, z: pond.z + Math.sin(angle) * r };
  };
  const depth = (x: number, z: number): number => lakeDepthAt([pond], x, z);
  const put = (
    kind: Structure['kind'],
    x: number,
    y: number,
    z: number,
    wM: number,
    hM: number,
    dM: number,
    colour: number,
    rotY = 0,
    lotId?: number,
  ): void => {
    const piece: Structure = { kind, x, y, z, wM, hM, dM, rotY, colour };
    if (lotId !== undefined) piece.lotId = lotId;
    structures.push(piece);
  };
  const floor = (x: number, z: number, wM: number, dM: number, rotY = 0): void => {
    dry.push({ x, z, wM, dM, rotY });
    floors.push({ x, z, wM, dM, rotY });
  };
  const lantern = (x: number, z: number): void => {
    const stone = pick(style.stone, 0.9);
    put('box', x, 0, z, 0.5, 0.9, 0.5, stone);
    put('box', x, 0.9, z, 0.78, 0.14, 0.78, stone);
    put('box', x, 1.04, z, 0.5, 0.48, 0.5, style.paper);
    put('roof', x, 1.52, z, 1.08, 0.44, 1.08, pick(style.rock, 0.5));
    put('box', x, 1.9, z, 0.16, 0.22, 0.16, stone);
    barriers.push({ x, z, wM: 0.8, dM: 0.8, rotY: 0 });
  };
  const boulder = (x: number, z: number, size: number): void => {
    const w = size * range(rng, 0.8, 1.2);
    put('roof', x, 0, z, w, size * range(rng, 0.45, 0.7), w * range(rng, 0.6, 0.95), pick(style.rock, rng()), range(rng, 0, Math.PI));
  };

  // --- ground: moss, the path round the pond, and the paths in -------------
  put('flat', cx, 0.02, cz, square.wM, 1, square.dM, style.lawn);
  const S = HEART.stroll;
  const strollOut = (angle: number): number =>
    Math.max(
      S.leastM,
      S.outM + S.wanderM * Math.sin(2 * angle + 0.8) + S.swingM * Math.sin(3 * angle + 0.3) + S.wobbleM * Math.sin(5 * angle + 2.1),
    );
  const onStroll = (angle: number): { x: number; z: number } => shore(angle, strollOut(angle));
  for (let i = 0; i < S.segments; i++) {
    const a = onStroll((i / S.segments) * Math.PI * 2);
    const b = onStroll(((i + 1) / S.segments) * Math.PI * 2);
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    // A hair apart in height, so where two overlap they do not fight.
    put('flat', (a.x + b.x) / 2, 0.06 + (i % 2) * 0.004, (a.z + b.z) / 2, length + 0.3, 1, S.widthM, style.gravel, rotYAlong(b.x - a.x, b.z - a.z));
  }
  const L = HEART.lookout;
  const near = shore(Math.PI / 2);
  const deckZ = near.z;
  const south = deckZ + L.dM / 2;
  put('flat', cx, 0.07, (south + cz + halfD) / 2, HEART.pathM, 1, cz + halfD - south, style.gravel);
  const back = shore(-Math.PI / 2);
  const tailEnd = back.z - HEART.tailPastM;
  put('flat', cx, 0.07, (cz - halfD + tailEnd) / 2, HEART.pathM, 1, tailEnd - (cz - halfD), style.gravel);
  for (const side of [-1, 1]) {
    const end = onStroll(side < 0 ? Math.PI : 0);
    const from = cx + side * halfW;
    put('flat', (from + end.x) / 2, 0.07, end.z, Math.abs(from - end.x), 1, HEART.pathM, style.gravel);
  }

  // --- the hall ------------------------------------------------------------
  const hz = cz + HEART.hallZ;
  const B = HEART.base;
  const F = HEART.floor;
  const Bd = HEART.body;
  const hallId = firstLotId;
  put('box', cx, 0, hz, B.wM, B.hM, B.dM, pick(style.stone, 0.3));
  floor(cx, hz, B.wM, B.dM);
  put('box', cx, 0, hz, Bd.wM + F.outM * 2, F.hM, Bd.dM + F.outM * 2, pick(style.cedar, 0.5));
  // A broad step down to the water at the front.
  put('box', cx, 0, hz + B.dM / 2 + 0.55, 9, 0.26, 1.4, pick(style.stone, 0.8));
  lots.push({ id: hallId, x: cx, z: hz, wM: Bd.wM, dM: Bd.dM, rotY: 0, use: 'temple', heightM: Bd.hM, style: 'low', jitter: rng() });
  const V = HEART.veranda;
  const K = HEART.skirt;
  const px = Bd.wM / 2 + V.outM;
  const pz = Bd.dM / 2 + V.outM;
  const acrossX = Math.max(2, Math.round((px * 2) / V.everyM));
  const acrossZ = Math.max(2, Math.round((pz * 2) / V.everyM));
  const post = (x: number, z: number): void => put('box', x, F.hM, z, V.sizeM, K.y - F.hM, V.sizeM, style.timber);
  for (let i = 0; i <= acrossX; i++) {
    const x = cx - px + (i * 2 * px) / acrossX;
    post(x, hz - pz);
    post(x, hz + pz);
  }
  for (let j = 1; j < acrossZ; j++) {
    const z = hz - pz + (j * 2 * pz) / acrossZ;
    post(cx - px, z);
    post(cx + px, z);
  }
  // Timber under each roof, so the eaves are warm seen from below.
  put('box', cx, K.y - 0.12, hz, K.wM - 0.4, 0.12, K.dM - 0.4, pick(style.cedar, 0.2), 0, hallId);
  put('roof', cx, K.y, hz, K.wM, K.hM, K.dM, style.hallRoof, 0, hallId);
  const R = HEART.roof;
  put('box', cx, R.y - 0.1, hz, R.wM - 0.3, 0.1, R.dM - 0.3, pick(style.cedar, 0.2), 0, hallId);
  put('hue', cx, R.y, hz, R.wM, R.hM, R.dM, style.hallRoof, 0, hallId);
  // Two gilded birds at the ends of the ridge.
  for (const side of [-1, 1]) put('box', cx + side * (R.wM / 2 - 1.3), R.y + R.hM * 1.1, hz, 0.34, 1.2, 0.22, style.gold, 0, hallId);

  // --- the galleries and towers ----------------------------------------------
  const W = HEART.wing;
  const gallery = (x0: number, z0: number, x1: number, z1: number): void => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / length;
    const uz = (z1 - z0) / length;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const turn = rotYAlong(ux, uz);
    put('box', mx, 0, mz, length, W.floorH, W.widthM, pick(style.cedar, 0.45), turn);
    floor(mx, mz, length, W.widthM, turn);
    const count = Math.max(1, Math.round(length / W.everyM));
    for (let i = 0; i <= count; i++) {
      const t = -length / 2 + (i * length) / count;
      for (const side of [-1, 1]) {
        const off = side * (W.widthM / 2 - 0.3);
        put('box', mx + ux * t - uz * off, W.floorH, mz + uz * t + ux * off, W.postM, W.eaveY - W.floorH, W.postM, style.timber, turn);
      }
    }
    put('box', mx, W.eaveY - 0.08, mz, length + 0.9, 0.08, W.roofWM - 0.3, pick(style.cedar, 0.3), turn);
    put('hue', mx, W.eaveY, mz, length + 1.2, W.roofH, W.roofWM, style.hallRoof, turn);
  };
  const T = HEART.tower;
  let id = hallId + 1;
  for (const side of [-1, 1]) {
    const tx = cx + side * T.x;
    gallery(cx + (side * B.wM) / 2, hz, tx - (side * T.baseM) / 2, hz);
    const towerId = id++;
    put('box', tx, 0, hz, T.baseM, B.hM, T.baseM, pick(style.stone, 0.3));
    floor(tx, hz, T.baseM, T.baseM);
    lots.push({ id: towerId, x: tx, z: hz, wM: T.bodyM, dM: T.bodyM, rotY: 0, use: 'temple', heightM: T.bodyH, style: 'low', jitter: rng() });
    const c = T.bodyM / 2 + 1.1;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      put('box', tx + sx * c, B.hM, hz + sz * c, 0.3, T.skirtY - B.hM, 0.3, style.timber);
    }
    put('box', tx, T.skirtY - 0.1, hz, T.skirtM - 0.3, 0.1, T.skirtM - 0.3, pick(style.cedar, 0.2), 0, towerId);
    put('roof', tx, T.skirtY, hz, T.skirtM, T.skirtH, T.skirtM, style.hallRoof, 0, towerId);
    put('box', tx, T.roofY - 0.1, hz, T.roofM - 0.3, 0.1, T.roofM - 0.3, pick(style.cedar, 0.2), 0, towerId);
    put('roof', tx, T.roofY, hz, T.roofM, T.roofH, T.roofM, style.hallRoof, 0, towerId);
    put('box', tx, T.roofY + T.roofH - 0.35, hz, 0.22, 1.2, 0.22, style.gold, 0, towerId);
    gallery(tx, hz + T.baseM / 2, tx, hz + T.baseM / 2 + HEART.forwardM);
  }
  // Back to the shore behind, which is the way in.
  gallery(cx, hz - B.dM / 2, cx, tailEnd);

  // --- the platform on the near bank -----------------------------------------
  put('box', cx, 0, deckZ, L.wM, L.hM, L.dM, pick(style.cedar, 0.7));
  floor(cx, deckZ, L.wM, L.dM);
  lantern(cx - L.wM / 2 - 1.3, deckZ + L.dM / 2 - 0.8);
  lantern(cx + L.wM / 2 + 1.3, deckZ + L.dM / 2 - 0.8);
  const spot = { x: cx, z: deckZ - L.dM / 2 + 1.6 };

  // --- the island and its bridge ---------------------------------------------
  const I = HEART.island;
  const ix = cx + I.x;
  const iz = cz + I.z;
  put('round', ix, 0, iz, (I.radiusM + 0.6) * 2, 0.14, (I.radiusM + 0.6) * 2, style.rim);
  put('round', ix, 0, iz, I.radiusM * 2, 0.24, I.radiusM * 2, pick(style.moss, 0.2));
  islands.push({ x: ix, z: iz, radiusM: I.radiusM });
  trees.push({ x: ix - 0.9, z: iz + 0.5, radiusM: HEART.oldTree.radiusM, heightM: HEART.oldTree.heightM, stems: false });
  lantern(ix + 2.9, iz - 2.2);
  boulder(ix - I.radiusM * 0.62, iz + I.radiusM * 0.5, 1.6);
  boulder(ix + I.radiusM * 0.4, iz + I.radiusM * 0.7, 1.2);
  const Z = HEART.zigzag;
  const outward = Math.atan2(iz - pond.z, ix - pond.x);
  const from = { x: ix + Math.cos(outward) * (I.radiusM - 0.8), z: iz + Math.sin(outward) * (I.radiusM - 0.8) };
  const to = shore(outward, 1.8);
  const run = Math.hypot(to.x - from.x, to.z - from.z);
  const ux = (to.x - from.x) / run;
  const uz = (to.z - from.z) / run;
  const off = (run / Z.planks) * Math.tan(Z.turnRad);
  const bend = (k: number): { x: number; z: number } => {
    const along = (k * run) / Z.planks;
    const aside = k % 2 === 1 ? off : 0;
    return { x: from.x + ux * along - uz * aside, z: from.z + uz * along + ux * aside };
  };
  const reedsAt: { x: number; z: number }[] = [];
  for (let k = 0; k < Z.planks; k++) {
    const a = bend(k);
    const b = bend(k + 1);
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const turn = rotYAlong(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    put('box', mx, 0, mz, length + Z.widthM, Z.hM + (k % 2) * 0.02, Z.widthM, pick(style.cedar, 0.6), turn);
    dry.push({ x: mx, z: mz, wM: length + Z.widthM, dM: Z.widthM, rotY: turn });
    reedsAt.push({ x: mx - uz * (k % 2 === 0 ? 2.2 : -2.2), z: mz + ux * (k % 2 === 0 ? 2.2 : -2.2) });
  }

  // --- the rocks with a maple on them ----------------------------------------
  const Rk = HEART.rocks;
  const rx = cx + Rk.x;
  const rz = cz + Rk.z;
  put('round', rx, 0, rz, (Rk.radiusM + 0.4) * 2, 0.12, (Rk.radiusM + 0.4) * 2, style.rim);
  put('round', rx, 0, rz, Rk.radiusM * 2, 0.2, Rk.radiusM * 2, pick(style.moss, 0.6));
  islands.push({ x: rx, z: rz, radiusM: Rk.radiusM });
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2 + range(rng, -0.4, 0.4);
    boulder(rx + Math.cos(angle) * Rk.radiusM * 0.55, rz + Math.sin(angle) * Rk.radiusM * 0.55, range(rng, 1.3, 2.3));
  }
  trees.push({ x: rx + 0.5, z: rz - 0.3, radiusM: 2.3, heightM: 4.8, stems: true, colour: style.redMaple });

  // --- in the water: lilies and reeds; at its edge, stones -------------------
  const clearOfBuildings = (x: number, z: number): boolean =>
    z > hz + B.dM / 2 + HEART.forwardM + 4 && Math.hypot(x - ix, z - iz) > I.radiusM + 2.5 && Math.hypot(x - rx, z - rz) > Rk.radiusM + 2;
  const Li = HEART.lilies;
  for (let d = 0; d < Li.drifts; d++) {
    const angle = range(rng, 0.12, 0.88) * Math.PI;
    const at = shore(angle, -range(rng, 5, 11));
    for (let i = 0; i < Li.perDrift; i++) {
      const x = at.x + range(rng, -Li.spreadM, Li.spreadM);
      const z = at.z + range(rng, -Li.spreadM, Li.spreadM);
      if (depth(x, z) < 1.5 || !clearOfBuildings(x, z)) continue;
      // Not in front of the platform, where the hall is looked at across open water.
      if (Math.abs(x - cx) < L.wM && z > deckZ - 16) continue;
      const r = range(rng, 0.4, 0.95);
      put('round', x, 0, z, r * 2, 0.115, r * 2, pick(style.moss, rng()));
    }
  }
  const Re = HEART.reeds;
  for (const at of reedsAt.slice(0, Re.clumps)) {
    for (let i = 0; i < Re.perClump; i++) {
      const x = at.x + range(rng, -1.6, 1.6);
      const z = at.z + range(rng, -1.6, 1.6);
      if (depth(x, z) < 0.6) continue;
      put('box', x, 0, z, 0.05, range(rng, 0.7, 1.4), 0.05, style.reed, range(rng, 0, Math.PI));
    }
  }
  for (let k = 0; k < 9; k++) {
    const angle = range(rng, 0, Math.PI * 2);
    // Not where the platform, the gallery in, or the bridge meets the bank.
    const gap = (a: number): number => Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a)));
    if (gap(Math.PI / 2) < 0.3 || gap(-Math.PI / 2) < 0.2 || gap(outward) < 0.2) continue;
    const at = shore(angle, 0.4);
    for (let j = 0; j < 3; j++) boulder(at.x + range(rng, -1.4, 1.4), at.z + range(rng, -1.4, 1.4), range(rng, 0.7, 1.5));
  }

  // --- trees -----------------------------------------------------------------
  const planted = (x: number, z: number, gapM: number): boolean => trees.some((t) => Math.hypot(t.x - x, t.z - z) < gapM);
  const inside = (x: number, z: number, marginM: number): boolean => Math.abs(x - cx) < halfW - marginM && Math.abs(z - cz) < halfD - marginM;
  const offPaths = (x: number, z: number): boolean =>
    Math.abs(x - cx) > HEART.pathM / 2 + 3.5 && Math.abs(z - (shore(0).z)) > HEART.pathM / 2 + 3;
  // Clear of the path round the pond, wherever it has wandered to.
  const offStroll = (x: number, z: number, marginM: number): boolean =>
    -depth(x, z) > strollOut(Math.atan2(z - pond.z, x - pond.x)) + S.widthM / 2 + marginM;
  // Red maples at the water's edge, leaning over it.
  for (const angle of [0.2, 0.85, 2.3, 2.95, -0.45, -2.7]) {
    // Between the path and the water where there is room, and past the path where there is not.
    const path = strollOut(angle);
    const at = shore(angle, path - S.widthM / 2 - 1.6 >= 2.6 ? Math.min(3, path - S.widthM / 2 - 1.6) : path + S.widthM / 2 + 2.2);
    if (planted(at.x, at.z, 3.5)) continue;
    trees.push({ x: at.x, z: at.z, radiusM: range(rng, 2.4, 3.2), heightM: range(rng, 5, 6.5), stems: true, colour: style.redMaple });
  }
  // The wood behind the hall: big, dark, close together, and all the way round
  // the back of the pond, with two ginkgos in it right behind the hall.
  const Wd = HEART.wood;
  for (const side of [-1, 1]) {
    trees.push({ x: cx + side * 11, z: tailEnd - 7, radiusM: 4.2, heightM: 13, stems: false, colour: style.gold });
  }
  for (let tries = 0; tries < Wd.tries; tries++) {
    const x = cx + range(rng, -halfW + 4, halfW - 4);
    const z = cz + range(rng, -halfD + 4, 10);
    if (depth(x, z) > -Wd.waterM || !offStroll(x, z, 2) || !offPaths(x, z) || planted(x, z, Wd.gapM)) continue;
    const red = rng() < 0.08;
    const tree: PlantedTree = {
      x,
      z,
      radiusM: range(rng, 3.6, 5.2),
      heightM: range(rng, 10.5, 15.5),
      stems: false,
      colour: red ? style.redMaple : style.wood,
    };
    trees.push(tree);
  }
  // In front, open grass: a group of trees in each front corner, and a row
  // down each side of the path in.
  for (const side of [-1, 1]) {
    const gx = cx + side * (halfW - 16);
    const gz = cz + halfD - 16;
    for (let tries = 0, placed = 0; tries < 40 && placed < 6; tries++) {
      const x = gx + range(rng, -10, 10);
      const z = gz + range(rng, -10, 10);
      if (!inside(x, z, 3) || depth(x, z) > -Wd.waterM || !offStroll(x, z, 2) || planted(x, z, 4.5) || !offPaths(x, z)) continue;
      trees.push(tree(rng, style, x, z, placed === 0));
      placed++;
    }
  }
  for (let z = south + 9; z < cz + halfD - 3; z += 9) {
    for (const side of [-1, 1]) {
      trees.push({ x: cx + side * (HEART.pathM / 2 + 3.2), z, radiusM: 2.6, heightM: 7.2, stems: true });
    }
  }

  // --- turned with the square ------------------------------------------------
  orientToFrame(structures, 0, frame);
  const turn = (p: { x: number; z: number }): { x: number; z: number } => toWorld(frame, p.x - cx, p.z - cz);
  const turnRect = (rect: OrientedRect): OrientedRect => ({ ...rect, ...turn(rect), rotY: rect.rotY + frame.rotY });
  const look = turn(spot);
  const ahead = turn({ x: spot.x, z: spot.z - 1 });
  const centre = turn(pond);
  return {
    structures,
    trees: trees.map((t) => ({ ...t, ...turn(t) })),
    lots: lots.map((lot) => ({ ...lot, ...turn(lot), rotY: lot.rotY + frame.rotY })),
    pond: {
      x: centre.x,
      z: centre.z,
      radiusM: P.radiusM,
      // A lobe's phase turns with the square: k times its turn, because the
      // world's angle is the square's own less its turn (world/frame.ts).
      lobes: P.lobes.map((lobe) => ({ ...lobe, phase: lobe.phase + lobe.k * frame.rotY })),
    },
    dry: dry.map(turnRect),
    floors: floors.map(turnRect),
    islands: islands.map((island) => ({ ...island, ...turn(island) })),
    barriers: barriers.map(turnRect),
    lookout: { x: look.x, z: look.z, faceX: ahead.x - look.x, faceZ: ahead.z - look.z },
  };
}
