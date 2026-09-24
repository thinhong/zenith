import { WALK } from '@/state/altitude';
import type { DayScript, PlaceSpec } from '@/story/script';
import { canStand, type Ground } from '@/walk/body';
import type { EraLayout } from '@/world/eras';
import { toWorld } from '@/world/frame';
import type { Lot } from '@/world/lots';
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
}

export const CAST = {
  /** How far out from the front wall the door spot is tried, in turn. */
  doorM: [1.4, 2.4, 3.4],
  /** Parks: this far in from the edge the lot is entered by, at most. */
  parkInM: 6,
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

/** Where somebody waits for you at this lot: at its door, or inside it if it is a park. */
function spotAt(lot: Lot, ground: Ground): Spot | null {
  if (lot.use === 'park') {
    const inM = Math.min(lot.dM / 2 - 2, CAST.parkInM);
    const at = toWorld(lot, 0, -Math.max(0, inM));
    const centre = { x: lot.x - at.x, z: lot.z - at.z };
    const length = Math.hypot(centre.x, centre.z) || 1;
    const found = nudge(ground, at.x, at.z);
    if (!found) return null;
    return { x: found.x, z: found.z, faceX: centre.x / length, faceZ: centre.z / length, lotId: lot.id };
  }
  for (const out of CAST.doorM) {
    const at = toWorld(lot, 0, -(lot.dM / 2 + out));
    if (!canStand(ground, at.x, at.z, WALK.radiusM)) continue;
    const faceX = at.x - lot.x;
    const faceZ = at.z - lot.z;
    const length = Math.hypot(faceX, faceZ) || 1;
    return { x: at.x, z: at.z, faceX: faceX / length, faceZ: faceZ / length, lotId: lot.id };
  }
  return null;
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
          const spot = spotAt(lot, ground);
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
