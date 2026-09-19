import { smoothstep } from '@/state/altitude';
import { ROADS, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { isBuildable, type TerrainSpec } from '@/world/terrain';

/**
 * City blocks cut into lots, each with a use and a height. Pure module: the
 * shapes are plain rectangles so the layout can be tested without a GPU
 * (AGENTS.md 3). world/buildings.ts turns these into instanced meshes.
 */
export const LOTS = {
  /** Gap between a block and the road that runs past it. */
  blockInsetM: 6,
  /** Space left around a building inside its lot. */
  setbackM: 2.5,
  minLotSideM: 16,
  minLotsPerBlock: 2,
  maxLotsPerBlock: 6,
  /** A block stops splitting once both sides are shorter than this. */
  splitFloorM: 30,
  /** Chance a whole block is given over to a park, downtown and at the edge. */
  parkChanceCentre: 0.05,
  parkChanceEdge: 0.15,
  towerFromM: 55,
  slabFromM: 18,
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

/** One block per grid cell whose four corners are all buildable. */
export function buildBlocks(terrain: TerrainSpec): Rect[] {
  const blocks: Rect[] = [];
  const pitch = ROADS.pitchM;
  const side = pitch - ROADS.streetWidthM - LOTS.blockInsetM * 2;
  const half = Math.floor(terrain.cityRadiusM / pitch);
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
): Lot[] {
  const lots: Lot[] = [];
  for (const block of blocks) {
    const blockDistance = normalised(block, terrain);
    const parkChance =
      LOTS.parkChanceCentre +
      (LOTS.parkChanceEdge - LOTS.parkChanceCentre) * smoothstep(0.3, 1, blockDistance);
    if (rng() < parkChance) {
      if (!crossesCorridor(corridors, block)) {
        lots.push(makeLot(lots.length, block, 'park', 0, rng()));
      }
      continue;
    }

    const spread = LOTS.maxLotsPerBlock - LOTS.minLotsPerBlock + 1;
    const target = LOTS.minLotsPerBlock + Math.floor(rng() * spread);
    for (const part of splitRect(rng, block, target)) {
      const wM = part.wM - LOTS.setbackM * 2;
      const dM = part.dM - LOTS.setbackM * 2;
      if (wM < LOTS.minLotSideM || dM < LOTS.minLotSideM) continue;
      if (crossesCorridor(corridors, part)) continue;
      const distance = normalised(part, terrain);
      const use = pickUse(rng, distance);
      const heightM = heightFor(rng, use, distance);
      lots.push(makeLot(lots.length, { ...part, wM, dM }, use, heightM, rng()));
    }
  }
  ensureTemple(rng, lots, terrain.cityRadiusM);
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

export function styleFor(heightM: number): BuildingStyle {
  if (heightM >= LOTS.towerFromM) return 'tower';
  if (heightM >= LOTS.slabFromM) return 'slab';
  return 'low';
}

function makeLot(id: number, rect: Rect, use: LotUse, heightM: number, jitter: number): Lot {
  return { id, x: rect.x, z: rect.z, wM: rect.wM, dM: rect.dM, use, heightM, style: styleFor(heightM), jitter };
}

function normalised(rect: Rect, terrain: TerrainSpec): number {
  return Math.hypot(rect.x, rect.z) / terrain.cityRadiusM;
}

function pickUse(rng: Rng, normalisedDistance: number): LotUse {
  const weights = useWeights(normalisedDistance);
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

function heightFor(rng: Rng, use: LotUse, normalisedDistance: number): number {
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
function ensureTemple(rng: Rng, lots: Lot[], cityRadiusM: number): void {
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
  chosen.heightM = heightFor(rng, 'temple', bestDistance / cityRadiusM);
  chosen.style = styleFor(chosen.heightM);
}

/** Splits the largest part in two until there are `target` of them. */
function splitRect(rng: Rng, block: Rect, target: number): Rect[] {
  const parts: Rect[] = [{ ...block }];
  while (parts.length < target) {
    let index = -1;
    let biggest = -1;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || Math.min(part.wM, part.dM) < LOTS.splitFloorM) continue;
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
