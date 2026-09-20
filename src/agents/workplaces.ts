import { storeysIn } from '@/world/interior';
import type { Lot } from '@/world/lots';

/**
 * Which building a person works in.
 *
 * Everybody used to walk to the work lot nearest their own front door, which
 * sounds reasonable and produces a town nobody would recognise. Homes sit in
 * the outskirts and workplaces in the middle, so the nearest workplace to a
 * home is always another outskirt one: seventy of the citadel's hundred and
 * sixty-four workplaces were never chosen at all, the whole centre of town
 * stood empty at midday, and one shed on the edge held two hundred and ten
 * people. Open a building anywhere near the middle and you got furniture.
 *
 * So a workplace has a size now. Its share of the town's desks is its share of
 * the town's floor area, which is what makes the tall building in the centre
 * worth walking to, and people fill the nearest one with a desk left in it.
 *
 * Pure module: no three.js, no pool (AGENTS.md 3).
 */

export const WORK = {
  /**
   * The share of the population at a workplace at the busiest hour. Office and
   * student roles together, rounded up a little (agents/schedule.ts).
   */
  workingShare: 0.6,
  /** Spare desks, so the last person still finds one near home. */
  headroom: 1.3,
  /** No workplace holds fewer than this, however small the plot. */
  minCapacity: 2,
  /**
   * Floor area per person, at the most crowded a building may get. This is
   * what stops a small shed being handed hundreds of people because the town
   * is short of workplaces; the overflow spreads out instead.
   */
  minPerPersonM2: 6,
} as const;

export interface Workplace {
  /** Index into the era's lots. */
  lot: number;
  x: number;
  z: number;
  /** How many people this building holds before it counts as full. */
  capacity: number;
}

/**
 * Sizes every workplace in the town. `workLots` are indices into `lots`;
 * `workers` is how many people will want a desk at the busiest hour.
 */
export function buildWorkplaces(
  lots: readonly Lot[],
  workLots: readonly number[],
  workers: number,
): Workplace[] {
  const places: Workplace[] = [];
  const areas: number[] = [];
  let totalArea = 0;
  for (const index of workLots) {
    const lot = lots[index];
    if (!lot) continue;
    // Floor area, not footprint: a tower is worth more desks than a shed of
    // the same plan, and that is the whole reason the centre fills up.
    const area = lot.wM * lot.dM * Math.max(1, storeysIn(lot.heightM));
    areas.push(area);
    totalArea += area;
    places.push({ lot: index, x: lot.x, z: lot.z, capacity: 0 });
  }
  if (places.length === 0) return places;

  const target = Math.max(places.length * WORK.minCapacity, workers * WORK.headroom);
  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const area = areas[i] ?? 0;
    if (!place) continue;
    const share = totalArea > 0 ? area / totalArea : 1 / places.length;
    const crowded = Math.max(WORK.minCapacity, Math.floor(area / WORK.minPerPersonM2));
    place.capacity = Math.min(crowded, Math.max(WORK.minCapacity, Math.round(share * target)));
  }
  return places;
}

/**
 * The nearest workplace to a point that still has a desk free, or, when the
 * town has run out of desks, the emptiest one relative to its size. Returns an
 * index into `places`, or -1 when there are none. `used` is read, not written:
 * the caller counts the person in.
 */
export function nearestWithRoom(
  places: readonly Workplace[],
  used: readonly number[],
  x: number,
  z: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  let fallback = -1;
  let fallbackLoad = Infinity;
  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    if (!place) continue;
    const dx = place.x - x;
    const dz = place.z - z;
    const distance = dx * dx + dz * dz;
    const taken = used[i] ?? 0;
    if (taken < place.capacity) {
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    } else {
      // Every desk in town is taken. Spread the overflow by how full each
      // building already is, so nobody rebuilds the two-hundred-person shed.
      const load = place.capacity > 0 ? taken / place.capacity : Infinity;
      if (load < fallbackLoad) {
        fallbackLoad = load;
        fallback = i;
      }
    }
  }
  return best >= 0 ? best : fallback;
}
