import { smoothstep } from '@/state/altitude';
import { buildNodeIndex, ROADS, roadOptions, type RoadGraph, type RoadOptions } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { isBuildable, type TerrainSpec } from '@/world/terrain';

/**
 * City blocks cut into lots, each with a use and a height. Pure module: the
 * shapes are plain rectangles so the layout can be tested without a GPU
 * (AGENTS.md 3). world/buildings.ts turns these into instanced meshes.
 */
export const LOTS = {
  /** Gap between a block and the road that runs past it. */
  blockInsetM: 2,
  /**
   * Space left around a building inside its lot. Small, because this is a
   * street of tube houses: they crowd the pavement and share side walls.
   */
  setbackM: 1,
  /**
   * A tube house is about four metres across and fifteen deep, so the minimum
   * is a narrow number, not a square one. Setting it at 5.5 quietly threw away
   * the last split of every block: the splitter halves the longest side, so
   * the final parts are narrow by construction, and they were all dropped.
   */
  minLotSideM: 3.5,
  minLotsPerBlock: 6,
  maxLotsPerBlock: 14,
  /**
   * A block stops splitting once both sides are shorter than this. Keep it at
   * about twice `minLotSideM` plus the setbacks, so a split that happens is a
   * split that survives.
   */
  splitFloorM: 8,
  /** Chance a whole block is given over to a park, downtown and at the edge. */
  parkChanceCentre: 0.05,
  parkChanceEdge: 0.15,
  towerFromM: 48,
  slabFromM: 16,
} as const;

export type LotUse = 'home' | 'work' | 'market' | 'temple' | 'park' | 'water';
export type BuildingStyle = 'tower' | 'slab' | 'low';

export interface Rect {
  x: number;
  z: number;
  wM: number;
  dM: number;
}

export interface Lot extends Rect {
  id: number;
  use: LotUse;
  /** 0 for a park: nothing is built there. */
  heightM: number;
  style: BuildingStyle;
  /** 0..1 per lot. Picks the colour and seeds the window pattern. */
  jitter: number;
}

/** A strip of ground an avenue or the ring road runs through. */
export interface Corridor {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidthM: number;
}

/**
 * What an era wants its blocks cut into. The shapes stay here; the character
 * (how many lots, how tall, what they are for) lives in the era file.
 */
export interface LotProfile {
  /**
   * How many lots a block is cut into, by distance from the centre. Downtown
   * takes fewer and larger ones, so a tower has ground to stand on; the edge
   * takes many narrow ones, which is a street of houses.
   */
  lotsPerBlock: (normalisedDistance: number) => { min: number; max: number };
  /**
   * The tallest a building may be for the width of its own plot, as a
   * multiple of its shorter side. Without this the small-lot rewrite put
   * sixty-metre towers on five-metre footprints and downtown looked like a
   * pincushion.
   */
  maxAspect: number;
  minLotSideM: number;
  splitFloorM: number;
  setbackM: number;
  /** Chance a whole block is given over to a park, by distance from the centre. */
  parkChance: (normalisedDistance: number) => number;
  /** Shares of each use, by distance from the centre. */
  weights: (normalisedDistance: number) => Record<Exclude<LotUse, 'water'>, number>;
  heightFor: (rng: Rng, use: LotUse, normalisedDistance: number) => number;
  style: (heightM: number) => BuildingStyle;
}

/** One block per grid cell whose four corners are all buildable. */
export function buildBlocks(terrain: TerrainSpec, over: Partial<RoadOptions> = {}): Rect[] {
  const shape = roadOptions(terrain, over);
  const blocks: Rect[] = [];
  const pitch = shape.pitchM;
  const side = pitch - shape.streetWidthM - LOTS.blockInsetM * 2;
  const half = Math.floor(shape.cityRadiusM / pitch);
  for (let i = -half; i < half; i++) {
    for (let j = -half; j < half; j++) {
      const buildable =
        isBuildable(terrain, i * pitch, j * pitch, ROADS.bankMarginM) &&
        isBuildable(terrain, (i + 1) * pitch, j * pitch, ROADS.bankMarginM) &&
        isBuildable(terrain, i * pitch, (j + 1) * pitch, ROADS.bankMarginM) &&
        isBuildable(terrain, (i + 1) * pitch, (j + 1) * pitch, ROADS.bankMarginM);
      if (!buildable) continue;
      blocks.push({ x: (i + 0.5) * pitch, z: (j + 0.5) * pitch, wM: side, dM: side });
    }
  }
  return blocks;
}

/** The avenues and the ring road cut across the grid, so they clear their own ground. */
export function avenueCorridors(graph: RoadGraph): Corridor[] {
  const corridors: Corridor[] = [];
  for (const edge of graph.edges) {
    if (edge.kind === 'street') continue;
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    corridors.push({
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      halfWidthM: edge.widthM / 2 + LOTS.blockInsetM,
    });
  }
  return corridors;
}

export function buildLots(
  rng: Rng,
  terrain: TerrainSpec,
  blocks: readonly Rect[],
  corridors: readonly Corridor[],
  profile: LotProfile = MODERN_LOTS,
  cityRadiusM: number = terrain.cityRadiusM,
): Lot[] {
  const lots: Lot[] = [];
  for (const block of blocks) {
    const blockDistance = Math.hypot(block.x, block.z) / cityRadiusM;
    if (rng() < profile.parkChance(blockDistance)) {
      if (!crossesCorridor(corridors, block)) {
        lots.push(makeLot(lots.length, block, 'park', 0, rng(), profile));
      }
      continue;
    }

    const count = profile.lotsPerBlock(blockDistance);
    const spread = count.max - count.min + 1;
    const target = count.min + Math.floor(rng() * spread);
    for (const part of splitRect(rng, block, target, profile.splitFloorM)) {
      const wM = part.wM - profile.setbackM * 2;
      const dM = part.dM - profile.setbackM * 2;
      if (wM < profile.minLotSideM || dM < profile.minLotSideM) continue;
      if (crossesCorridor(corridors, part)) continue;
      const distance = Math.hypot(part.x, part.z) / cityRadiusM;
      const use = pickUse(rng, distance, profile);
      // A building cannot be taller than its own plot can carry.
      const heightM = Math.min(
        profile.heightFor(rng, use, distance),
        Math.min(wM, dM) * profile.maxAspect,
      );
      lots.push(makeLot(lots.length, { ...part, wM, dM }, use, heightM, rng(), profile));
    }
  }
  ensureTemple(rng, lots, cityRadiusM, profile);
  return lots;
}

/**
 * Shares of each use at a given distance from the centre, 0 at the middle and
 * 1 at the ring road. Work downtown, homes at the edge, parks throughout.
 */
export function useWeights(normalisedDistance: number): Record<Exclude<LotUse, 'water'>, number> {
  const d = Math.min(1, Math.max(0, normalisedDistance));
  return {
    work: 0.08 + 0.62 * (1 - smoothstep(0.05, 0.55, d)),
    home: 0.15 + 0.7 * smoothstep(0.1, 0.65, d),
    market: 0.03 + 0.14 * (1 - smoothstep(0.2, 0.9, d)),
    temple: 0.025,
    park: 0.05 + 0.08 * smoothstep(0.3, 1, d),
  };
}

/** The modern era's own settings, and the default for anything that does not say. */
export const MODERN_LOTS: LotProfile = {
  lotsPerBlock: (d) => {
    // Downtown blocks are cut into two or three plots; the edge into a dozen.
    const t = smoothstep(0.15, 0.55, d);
    return {
      min: Math.round(2 + (LOTS.minLotsPerBlock - 2) * t),
      max: Math.round(4 + (LOTS.maxLotsPerBlock - 4) * t),
    };
  },
  maxAspect: 4.2,
  minLotSideM: LOTS.minLotSideM,
  splitFloorM: LOTS.splitFloorM,
  setbackM: LOTS.setbackM,
  parkChance: (d) =>
    LOTS.parkChanceCentre + (LOTS.parkChanceEdge - LOTS.parkChanceCentre) * smoothstep(0.3, 1, d),
  weights: useWeights,
  heightFor: modernHeight,
  style: styleFor,
};

export function styleFor(heightM: number): BuildingStyle {
  if (heightM >= LOTS.towerFromM) return 'tower';
  if (heightM >= LOTS.slabFromM) return 'slab';
  return 'low';
}

function makeLot(
  id: number,
  rect: Rect,
  use: LotUse,
  heightM: number,
  jitter: number,
  profile: LotProfile,
): Lot {
  return {
    id,
    x: rect.x,
    z: rect.z,
    wM: rect.wM,
    dM: rect.dM,
    use,
    heightM,
    style: profile.style(heightM),
    jitter,
  };
}

function pickUse(rng: Rng, normalisedDistance: number, profile: LotProfile): LotUse {
  const weights = profile.weights(normalisedDistance);
  const entries = Object.entries(weights) as [Exclude<LotUse, 'water'>, number][];
  let total = 0;
  for (const [, weight] of entries) total += weight;
  let roll = rng() * total;
  for (const [use, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return use;
  }
  return 'home';
}

export function modernHeight(rng: Rng, use: LotUse, normalisedDistance: number): number {
  // Tall downtown, low at the edge. The square falloff gives a skyline that
  // drops quickly rather than sloping evenly across the city.
  const core = 1 - smoothstep(0, 0.62, normalisedDistance);
  switch (use) {
    case 'work':
      return clamp(10 + 150 * core ** 2 * range(rng, 0.5, 1.35), 8, 165);
    case 'home':
      return clamp(6 + 48 * core ** 2.4 * range(rng, 0.5, 1.4) + range(rng, 0, 5), 5, 72);
    case 'market':
      return range(rng, 7, 15);
    case 'temple':
      return range(rng, 13, 22);
    default:
      return 0;
  }
}

/** Every city has somewhere to go and be quiet, whatever the weights rolled. */
function ensureTemple(rng: Rng, lots: Lot[], cityRadiusM: number, profile: LotProfile): void {
  if (lots.some((lot) => lot.use === 'temple')) return;
  let chosen: Lot | undefined;
  let bestDistance = Infinity;
  for (const lot of lots) {
    if (lot.use === 'park' || lot.use === 'water') continue;
    const d = Math.hypot(lot.x, lot.z);
    if (d < bestDistance) {
      bestDistance = d;
      chosen = lot;
    }
  }
  if (!chosen) return;
  chosen.use = 'temple';
  chosen.heightM = profile.heightFor(rng, 'temple', bestDistance / cityRadiusM);
  chosen.style = profile.style(chosen.heightM);
}

/** Splits the largest part in two until there are `target` of them. */
function splitRect(rng: Rng, block: Rect, target: number, floorM: number): Rect[] {
  const parts: Rect[] = [{ ...block }];
  while (parts.length < target) {
    let index = -1;
    let biggest = -1;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || Math.min(part.wM, part.dM) < floorM) continue;
      const area = part.wM * part.dM;
      if (area > biggest) {
        biggest = area;
        index = i;
      }
    }
    const part = index >= 0 ? parts[index] : undefined;
    if (!part) break;
    const f = range(rng, 0.38, 0.62);
    if (part.wM >= part.dM) {
      const first = part.wM * f;
      const second = part.wM - first;
      parts.splice(
        index,
        1,
        { x: part.x - part.wM / 2 + first / 2, z: part.z, wM: first, dM: part.dM },
        { x: part.x + part.wM / 2 - second / 2, z: part.z, wM: second, dM: part.dM },
      );
    } else {
      const first = part.dM * f;
      const second = part.dM - first;
      parts.splice(
        index,
        1,
        { x: part.x, z: part.z - part.dM / 2 + first / 2, wM: part.wM, dM: first },
        { x: part.x, z: part.z + part.dM / 2 - second / 2, wM: part.wM, dM: second },
      );
    }
  }
  return parts;
}

function crossesCorridor(corridors: readonly Corridor[], rect: Rect): boolean {
  const reach = Math.max(rect.wM, rect.dM) * 0.5;
  for (const c of corridors) {
    if (distanceToSegment(rect.x, rect.z, c.ax, c.az, c.bx, c.bz) < c.halfWidthM + reach) return true;
  }
  return false;
}

export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Lot ids grouped by use, so a person can pick somewhere to go. */
export function lotsByUse(lots: readonly Lot[]): Record<LotUse, number[]> {
  const byUse: Record<LotUse, number[]> = {
    home: [],
    work: [],
    market: [],
    temple: [],
    park: [],
    water: [],
  };
  for (const lot of lots) byUse[lot.use].push(lot.id);
  return byUse;
}

/**
 * The road node each lot is reached from: its door, as far as the walkers are
 * concerned. Computed once at start-up.
 */
export function lotRoadNodes(lots: readonly Lot[], graph: RoadGraph): Int32Array {
  const nodes = new Int32Array(lots.length).fill(-1);
  const index = buildNodeIndex(graph);
  for (const lot of lots) nodes[lot.id] = index.nearest(lot.x, lot.z);
  return nodes;
}

/** Cell size of the lookup grid, in metres. */
export const LOT_INDEX_CELL_M = 200;

export interface LotIndex {
  /** The nearest lot of that use to a point, or -1 if there are none. */
  nearest: (use: LotUse, x: number, z: number) => number;
}

/**
 * A coarse grid for "where is the nearest market from here". People have to be
 * able to reach somewhere inside the slot of the day that sent them: a walk at
 * 1.4 m/s and a day of 15 minutes leave only a couple of hundred metres, so the
 * choice has to be the nearest one rather than a random one (PLAN.md 4.5).
 */
export function buildLotIndex(lots: readonly Lot[], cellM: number = LOT_INDEX_CELL_M): LotIndex {
  const buckets = new Map<string, number[]>();
  for (const lot of lots) {
    const key = cellKey(lot.use, Math.floor(lot.x / cellM), Math.floor(lot.z / cellM));
    const list = buckets.get(key);
    if (list) list.push(lot.id);
    else buckets.set(key, [lot.id]);
  }

  return {
    nearest: (use, x, z) => {
      const cx = Math.floor(x / cellM);
      const cz = Math.floor(z / cellM);
      let best = -1;
      let bestDistance = Infinity;
      for (let ring = 0; ring <= 192; ring++) {
        // Nothing in this ring or beyond can be nearer than its inner edge, so
        // once that edge is further than the best so far, the search is done.
        if (ring > 1 && ((ring - 1) * cellM) ** 2 > bestDistance) break;
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const list = buckets.get(cellKey(use, cx + dx, cz + dz));
            if (!list) continue;
            for (const id of list) {
              const lot = lots[id];
              if (!lot) continue;
              const distance = (lot.x - x) ** 2 + (lot.z - z) ** 2;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = id;
              }
            }
          }
        }
      }
      return best;
    },
  };
}

function cellKey(use: LotUse, cx: number, cz: number): string {
  return `${use}:${cx},${cz}`;
}
