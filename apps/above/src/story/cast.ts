import { buildWalkPath } from '@/agents/paths';
import { WALK } from '@/state/altitude';
import type { DayScript, PlaceSpec } from '@/story/script';
import { canStand, inSight, type Ground } from '@/walk/body';
import type { EraLayout } from '@/world/eras';
import { toWorld } from '@/world/frame';
import { gateApproach } from '@/world/gardens';
import type { Lot } from '@/world/lots';
import { nearestNode, type RoadGraph } from '@/world/roads';
import { mulberry32, range } from '@/world/seed';
import { centrelinePoint, type TerrainSpec } from '@/world/terrain';

/**
 * Which building is home, which market is the market: a day's places are
 * roles, and the town is laid out from a seed, so they are cast when the day
 * starts. Pure and seeded, so the same town gives the same day.
 *
 * A place is a spot on the ground where somebody can stand and wait: in
 * front of a building's door, on the pavement it faces; inside a park; at
 * one of the era's landmarks; on the bank of the water.
 */
export interface Spot {
  x: number;
  z: number;
  /** Which way somebody standing here faces, as a direction on the ground. */
  faceX: number;
  faceZ: number;
  /** The building this is the door of, or -1. */
  lotId: number;
  /**
   * Where the way in starts, on the road: outside the gate of a door behind a
   * garden wall (world/gardens.ts), or at the edge of a park. The light goes
   * through here, not over a wall or round a pond.
   */
  approach?: { x: number; z: number };
}

export const CAST = {
  /** How far out from the front wall the door spot is tried, in turn. */
  doorM: [1.4, 2.4, 3.4],
  /** Parks: this far in from the edge the lot is entered by, at most. */
  parkInM: 6,
  /** And that edge no further than this from a road: a park behind houses is not one to meet in. */
  parkRoadM: 7,
  /** Wobble in the choice, so two seeds do not always pick the same kind of spot. */
  jitterM: 18,
  /** Search for somewhere to stand round a landmark, out to this far. */
  nudgeM: 10,
} as const;

function enclosed(layout: EraLayout, x: number, z: number): boolean {
  const wall = layout.enclosure;
  if (!wall) return true;
  return wall.shape === 'square' ? Math.max(Math.abs(x), Math.abs(z)) < wall.halfM : Math.hypot(x, z) < wall.halfM;
}

/** The nearest spot to (x, z) a person can stand on, searching outwards. */
function nudge(ground: Ground, x: number, z: number): { x: number; z: number } | null {
  if (canStand(ground, x, z, WALK.radiusM)) return { x, z };
  for (let r = 0.5; r <= CAST.nudgeM; r += 0.5) {
    const steps = Math.max(8, Math.round((Math.PI * 2 * r) / 0.6));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (canStand(ground, px, pz, WALK.radiusM)) return { x: px, z: pz };
    }
  }
  return null;
}

/** The nearest point on any road to (x, z), pulled back to the road's edge on that side. */
function roadEdgeNear(roads: RoadGraph, x: number, z: number): { x: number; z: number; distanceM: number } | null {
  let best: { x: number; z: number; distanceM: number } | null = null;
  for (const edge of roads.edges) {
    const a = roads.nodes[edge.a];
    const b = roads.nodes[edge.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    const toEdge = d - edge.widthM / 2;
    if (best && toEdge >= best.distanceM) continue;
    // On the road, a metre in from its edge, on the side the point is.
    const k = d > 1e-6 ? Math.max(0, d - (edge.widthM / 2 - 1)) / d : 0;
    best = { x: x + (px - x) * k, z: z + (pz - z) * k, distanceM: toEdge };
  }
  return best;
}

/** Where somebody waits for you at this lot: at its door, or inside it if it is a park. */
function spotAt(lot: Lot, ground: Ground, roads: RoadGraph): Spot | null {
  if (lot.use === 'park') {
    // In from whichever side of it is nearest a road, not from its middle:
    // the middle of a garden may be a pond, and its other sides may be the
    // backs of houses.
    const sides = [
      { mx: 0, mz: -lot.dM / 2, nx: 0, nz: 1, depth: lot.dM },
      { mx: 0, mz: lot.dM / 2, nx: 0, nz: -1, depth: lot.dM },
      { mx: -lot.wM / 2, mz: 0, nx: 1, nz: 0, depth: lot.wM },
      { mx: lot.wM / 2, mz: 0, nx: -1, nz: 0, depth: lot.wM },
    ];
    let chosen: { side: (typeof sides)[number]; road: { x: number; z: number; distanceM: number } } | null = null;
    for (const side of sides) {
      const mid = toWorld(lot, side.mx, side.mz);
      const road = roadEdgeNear(roads, mid.x, mid.z);
      if (road && (!chosen || road.distanceM < chosen.road.distanceM)) chosen = { side, road };
    }
    // A park with houses between it and every road is not somewhere to meet.
    if (!chosen || chosen.road.distanceM > CAST.parkRoadM) return null;
    const { side, road } = chosen;
    const inM = Math.min(side.depth / 2, CAST.parkInM);
    const at = toWorld(lot, side.mx + side.nx * inM, side.mz + side.nz * inM);
    const ahead = toWorld(lot, side.mx + side.nx * (inM + 1), side.mz + side.nz * (inM + 1));
    const found = nudge(ground, at.x, at.z);
    if (!found) return null;
    // The way in is from that road, straight across the edge of the park:
    // nothing in the way, and no water.
    if (!canStand(ground, road.x, road.z, WALK.radiusM) || !inSight(ground, road.x, road.z, found.x, found.z)) return null;
    const steps = Math.ceil(Math.hypot(found.x - road.x, found.z - road.z) / 0.8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!ground.open(road.x + (found.x - road.x) * t, road.z + (found.z - road.z) * t)) return null;
    }
    return {
      x: found.x,
      z: found.z,
      faceX: ahead.x - at.x,
      faceZ: ahead.z - at.z,
      lotId: lot.id,
      approach: { x: road.x, z: road.z },
    };
  }
  const approach = gateApproach(lot);
  for (const out of CAST.doorM) {
    // Inside the garden, when there is one: never on the far side of its wall.
    if (lot.garden && out > lot.garden.depthM - 0.5) continue;
    const at = toWorld(lot, 0, -(lot.dM / 2 + out));
    if (!canStand(ground, at.x, at.z, WALK.radiusM)) continue;
    const faceX = at.x - lot.x;
    const faceZ = at.z - lot.z;
    const length = Math.hypot(faceX, faceZ) || 1;
    const spot: Spot = { x: at.x, z: at.z, faceX: faceX / length, faceZ: faceZ / length, lotId: lot.id };
    if (approach) spot.approach = approach;
    return spot;
  }
  return null;
}

/**
 * The way from one place to another the way the light leads (story/guide.ts):
 * out through a garden gate if the start is behind one, along the roads, and
 * in through the gate at the far end. Waypoints on the ground.
 */
export function wayBetween(
  graph: RoadGraph,
  from: { x: number; z: number; approach?: { x: number; z: number } },
  to: { x: number; z: number; approach?: { x: number; z: number } },
): { x: number[]; z: number[] } {
  const start = from.approach ?? from;
  const end = to.approach ?? to;
  const road = buildWalkPath(graph, {
    fromX: start.x,
    fromZ: start.z,
    toX: end.x,
    toZ: end.z,
    fromNode: nearestNode(graph, start.x, start.z),
    toNode: nearestNode(graph, end.x, end.z),
    laneM: 0,
  });
  const x = [...road.x];
  const z = [...road.z];
  if (from.approach) {
    x.unshift(from.x);
    z.unshift(from.z);
  }
  if (to.approach) {
    x.push(to.x);
    z.push(to.z);
  }
  return { x, z };
}

interface Candidate {
  spot: Spot;
  score: number;
}

/** Ways to loosen a place's rules, in order, when nothing in town fits them. */
const RELAX: readonly ((spec: PlaceSpec) => PlaceSpec)[] = [
  (spec) => spec,
  (spec) => ({ ...spec, minM: (spec.minM ?? 0) * 0.5, maxM: (spec.maxM ?? 1e9) * 1.8 }),
  (spec) => ({ ...spec, minM: undefined, maxM: undefined }),
  (spec) => ({ ...spec, minM: undefined, maxM: undefined, reach: undefined }),
  (spec) => ({ ...spec, minM: undefined, maxM: undefined, reach: undefined, zone: undefined, big: undefined }),
];

export function castPlaces(
  day: DayScript,
  layout: EraLayout,
  terrain: TerrainSpec,
  ground: Ground,
  seed: number,
): Record<string, Spot> {
  const rng = mulberry32(seed ^ 0x5a17);
  const spots: Record<string, Spot> = {};
  const used = new Set<number>();

  const fits = (spec: PlaceSpec, x: number, z: number): boolean => {
    if (spec.zone && enclosed(layout, x, z) !== (spec.zone === 'inside')) return false;
    if (spec.reach) {
      const reach = Math.hypot(x, z) / Math.max(1, layout.cityRadiusM);
      if (reach < spec.reach[0] || reach > spec.reach[1]) return false;
    }
    const from = spec.from ? spots[spec.from] : undefined;
    if (from) {
      const d = Math.hypot(x - from.x, z - from.z);
      if (spec.minM !== undefined && d < spec.minM) return false;
      if (spec.maxM !== undefined && d > spec.maxM) return false;
    }
    return true;
  };

  const scoreOf = (spec: PlaceSpec, spot: Spot, lot: Lot | null): number => {
    const from = spec.from ? spots[spec.from] : undefined;
    let score = range(rng, 0, CAST.jitterM);
    if (from) {
      const d = Math.hypot(spot.x - from.x, spot.z - from.z);
      const middle = ((spec.minM ?? 0) + (spec.maxM ?? d)) / 2;
      score += Math.abs(d - middle);
    }
    if (spec.big && lot) score -= Math.sqrt(lot.wM * lot.dM);
    return score;
  };

  for (const id of Object.keys(day.places)) {
    const base = day.places[id];
    if (!base) continue;
    let chosen: Spot | null = null;

    if (base.kind === 'landmark') {
      const mark = base.landmark ? layout.landmarks?.[base.landmark] : undefined;
      const at = mark ? nudge(ground, mark.x, mark.z) : null;
      if (mark && at) chosen = { x: at.x, z: at.z, faceX: mark.faceX, faceZ: mark.faceZ, lotId: -1 };
    }

    for (const relax of RELAX) {
      if (chosen) break;
      const spec = relax(base);
      const candidates: Candidate[] = [];
      if (spec.kind === 'shore') {
        const water = terrain.water;
        const sides = water.kind === 'river' ? [-1, 1] : [-1];
        const outM = water.kind === 'river' ? water.halfWidthM + WALK.shoreM + 5 : WALK.shoreM + 5;
        for (let i = 0; i < water.offsetsM.length; i++) {
          const c = centrelinePoint(water, i);
          for (const side of sides) {
            const x = c.x + water.nrmX * outM * side;
            const z = c.z + water.nrmZ * outM * side;
            if (!fits(spec, x, z) || !canStand(ground, x, z, WALK.radiusM)) continue;
            const spot = { x, z, faceX: -water.nrmX * side, faceZ: -water.nrmZ * side, lotId: -1 };
            candidates.push({ spot, score: scoreOf(spec, spot, null) });
          }
        }
      } else {
        // A landmark this era does not have stands in for the middle of town.
        const use = spec.kind === 'landmark' ? 'market' : spec.kind;
        for (const lot of layout.lots) {
          if (lot.use !== use || used.has(lot.id)) continue;
          if (use !== 'park' && (!lot.street || lot.heightM <= 0)) continue;
          if (!fits(spec, lot.x, lot.z)) continue;
          const spot = spotAt(lot, ground, layout.roads);
          if (!spot || !fits(spec, spot.x, spot.z)) continue;
          candidates.push({ spot, score: scoreOf(spec, spot, lot) });
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      chosen = candidates[0]?.spot ?? null;
    }

    if (!chosen) {
      // Nowhere at all: the middle of town, which always has a street.
      const at = nudge(ground, 0, 0) ?? { x: 0, z: 0 };
      chosen = { x: at.x, z: at.z, faceX: 0, faceZ: 1, lotId: -1 };
    }
    if (chosen.lotId >= 0) used.add(chosen.lotId);
    spots[id] = chosen;
  }
  return spots;
}
