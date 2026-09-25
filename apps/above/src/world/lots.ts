import { smoothstep } from '@/state/altitude';
import { buildNodeIndex, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * Lots: the plots buildings stand on, and what each one is for and how tall
 * it is. Pure module: the shapes are plain rectangles so the choices can be
 * tested without a GPU (AGENTS.md 3). world/parcels.ts places them along the
 * streets the planner lays out, world/buildings.ts turns them into instanced
 * meshes, and the lookups here are what the walkers use to find them.
 */
export const LOTS = {
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
  /**
   * The lot's turn about its own centre, in the `Structure.rotY` convention.
   * 0 for one laid square to the world, as the citadel's halls are. Lots put
   * along a street are turned to face it (world/parcels.ts), and everything
   * that stands on a lot turns with it (world/frame.ts).
   */
  rotY: number;
  /** It faces a street across its local -z side: the side the door and the shopfront are on. */
  street?: boolean;
  /**
   * How far a wall round the yard may stand from the building, in metres.
   * 0 where the neighbours stand too close for a yard at all; unset means the
   * old default.
   */
  yardM?: number;
  /**
   * A walled front garden between the building and its street, for an era
   * that builds them (world/gardens.ts): how deep it is, and how far its wall
   * runs past each side of the building. Unset where there is none.
   */
  garden?: { depthM: number; sideM: number };
  /** Water in an open lot, which nobody stands in: a park's pond (world/water-gardens.ts). */
  ponds?: readonly { x: number; z: number; radiusM: number }[];
}

/**
 * What an era builds on its lots. Where the lots go and how big they are is
 * the plan's business (world/plan.ts ParcelStyle); the character (what they
 * are for, how tall, in what style) lives here, in the era file.
 */
export interface LotProfile {
  /**
   * The tallest a building may be for the width of its own plot, as a
   * multiple of its shorter side. Without this the small-lot rewrite put
   * sixty-metre towers on five-metre footprints and downtown looked like a
   * pincushion.
   */
  maxAspect: number;
  /** Shares of each use, by distance from the centre. */
  weights: (normalisedDistance: number) => Record<Exclude<LotUse, 'water'>, number>;
  heightFor: (rng: Rng, use: LotUse, normalisedDistance: number) => number;
  style: (heightM: number) => BuildingStyle;
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
  maxAspect: 4.2,
  weights: useWeights,
  heightFor: modernHeight,
  style: styleFor,
};

export function styleFor(heightM: number): BuildingStyle {
  if (heightM >= LOTS.towerFromM) return 'tower';
  if (heightM >= LOTS.slabFromM) return 'slab';
  return 'low';
}

export function pickUse(rng: Rng, normalisedDistance: number, profile: LotProfile): LotUse {
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
export function ensureTemple(rng: Rng, lots: Lot[], cityRadiusM: number, profile: LotProfile): void {
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
interface CellBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** How far out the search can possibly need to go from a given cell. */
function ringsToCover(bounds: CellBounds, cx: number, cz: number): number {
  return Math.max(
    Math.abs(cx - bounds.minX),
    Math.abs(cx - bounds.maxX),
    Math.abs(cz - bounds.minZ),
    Math.abs(cz - bounds.maxZ),
  );
}

export function buildLotIndex(lots: readonly Lot[], cellM: number = LOT_INDEX_CELL_M): LotIndex {
  const buckets = new Map<string, number[]>();
  /**
   * The cells each use actually occupies.
   *
   * Without this the search ran its full 193 rings whenever it found nothing,
   * because the early-out compares against the best distance so far and that
   * stays at infinity when there is nothing to find. That is about 9.6 million
   * iterations and 148,000 string keys, per call. It is only reachable when an
   * era has no lots of some use, and `populate` calls this once per person, so
   * a town with no market would have hung the tab for minutes at startup
   * rather than failing outright.
   */
  const bounds = new Map<LotUse, CellBounds>();
  for (const lot of lots) {
    const cx = Math.floor(lot.x / cellM);
    const cz = Math.floor(lot.z / cellM);
    const key = cellKey(lot.use, cx, cz);
    const list = buckets.get(key);
    if (list) list.push(lot.id);
    else buckets.set(key, [lot.id]);
    const box = bounds.get(lot.use);
    if (!box) bounds.set(lot.use, { minX: cx, maxX: cx, minZ: cz, maxZ: cz });
    else {
      if (cx < box.minX) box.minX = cx;
      if (cx > box.maxX) box.maxX = cx;
      if (cz < box.minZ) box.minZ = cz;
      if (cz > box.maxZ) box.maxZ = cz;
    }
  }

  return {
    nearest: (use, x, z) => {
      const box = bounds.get(use);
      // Nothing of this kind anywhere. Say so now rather than sweeping the
      // whole grid to discover it.
      if (!box) return -1;
      const cx = Math.floor(x / cellM);
      const cz = Math.floor(z / cellM);
      const maxRing = ringsToCover(box, cx, cz);
      let best = -1;
      let bestDistance = Infinity;
      for (let ring = 0; ring <= maxRing; ring++) {
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
