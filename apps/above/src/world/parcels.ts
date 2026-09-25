import {
  createGridIndex,
  rectBounds,
  rectCorners,
  rectsOverlap,
  rotYAlong,
  segmentRectDistance,
  type OrientedRect,
} from '@/world/geometry2d';
import { toWorld } from '@/world/frame';
import { ensureTemple, pickUse, type Lot, type LotProfile, type LotUse } from '@/world/lots';
import { lakeDepthAt, type ParcelStyle, type TownPlan } from '@/world/plan';
import { PAVEMENT_M } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { waterDepthAt, type TerrainSpec } from '@/world/terrain';

/**
 * Lots along the streets, each turned to face the street it stands on.
 *
 * Lots used to be cut out of square blocks by halving them until they were
 * small enough, which only works while every block is a square on one grid.
 * The plan now has streets at every angle, curving, meeting at forty degrees,
 * stopping dead; so a lot is placed the way a real one is: along a street,
 * its front on the pavement, as deep as the street's part of town builds,
 * next to the one before it, and only where nothing else already stands.
 *
 * The rules that decide it are few. A lot must lie in a part of town that
 * builds (`TownPlan.parcelAt`), clear of every road and its pavement, clear
 * of every lot already placed and of the parks and squares kept open, and
 * clear of the water. Main roads are walked first, so their frontage is
 * taken first, the way it is. A plot that will not fit is tried shallower
 * and then narrower before the walk moves on.
 *
 * Pure. Built in steps, because a whole town of lots takes longer than one
 * frame (world/eras/index.ts EraBuild).
 */
export const PARCELS = {
  /** How far along the street to move when nothing fits. */
  stepM: 1.6,
  /** Buildings may share a wall: overlaps this small are allowed. */
  slackM: 0.15,
  /** Clear ground kept between a lot and any pavement. */
  roadClearM: 0.35,
  /** Nothing is built nearer the water than this. */
  waterClearM: 6,
  minFrontM: 3.4,
  minDepthM: 5,
  /** The last share of the town's reach, where plots start to be left empty. */
  thinFrom: 0.9,
  thinMost: 0.45,
  /** An annex: how deep, how much of the width, how tall against the main building. */
  annexDepthM: [4, 8] as const,
  annexFront: [0.45, 0.8] as const,
  annexHeight: [0.45, 0.72] as const,
  /** Gap between a lot and the one filled in behind it. */
  backGapM: [0.4, 2.2] as const,
  /** A yard wall needs this much free ground all round. */
  yardM: 1.6,
  /** How many tries at fitting a lot between one frame and the next. */
  triesPerStep: 700,
} as const;

export interface ParcelOptions {
  /** Multiplies every lot's size, for an era that builds larger on the same plan. */
  sizeScale?: number;
  /** Ground the era keeps clear of lots (walls, moats, a keep). True where a lot may stand. */
  allowed?: (x: number, z: number) => boolean;
  /** Buildings the era places by hand, which the lots must keep clear of. */
  prebuilt?: readonly OrientedRect[];
}

const RANK: Record<string, number> = { ring: 3, avenue: 2, street: 1 };

/** Places the lots in one go. For tests, and for anything with no frame to protect. */
export function placeParcels(
  rng: Rng,
  terrain: TerrainSpec,
  plan: TownPlan,
  profile: LotProfile,
  options: ParcelOptions = {},
): Lot[] {
  const steps = parcelSteps(rng, terrain, plan, profile, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* parcelSteps(
  rng: Rng,
  terrain: TerrainSpec,
  plan: TownPlan,
  profile: LotProfile,
  options: ParcelOptions = {},
): Generator<void, Lot[], void> {
  const graph = plan.roads;
  const scale = options.sizeScale ?? 1;
  const lots: Lot[] = [];
  const rects: OrientedRect[] = [];
  const occupied = createGridIndex(24);
  const roadIndex = createGridIndex(24);
  let widest = 0;
  graph.edges.forEach((edge, i) => {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) return;
    widest = Math.max(widest, edge.widthM);
    roadIndex.insert(i, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  });
  const roadPad = widest / 2 + PAVEMENT_M + PARCELS.roadClearM + 1;

  const occupy = (rect: OrientedRect): void => {
    const box = rectBounds(rect);
    occupied.insert(rects.length, box.minX, box.minZ, box.maxX, box.maxZ);
    rects.push(rect);
  };
  for (const reserve of plan.reserves) occupy(reserve);
  for (const rect of options.prebuilt ?? []) occupy(rect);

  const clearOfRoads = (rect: OrientedRect, extraM: number): boolean => {
    const box = rectBounds(rect, roadPad + extraM);
    let clear = true;
    roadIndex.query(box.minX, box.minZ, box.maxX, box.maxZ, (i) => {
      const edge = graph.edges[i];
      const a = edge ? graph.nodes[edge.a] : undefined;
      const b = edge ? graph.nodes[edge.b] : undefined;
      if (!edge || !a || !b) return;
      const need = edge.widthM / 2 + PAVEMENT_M + PARCELS.roadClearM + extraM;
      if (segmentRectDistance(a.x, a.z, b.x, b.z, rect) < need) {
        clear = false;
        return true;
      }
    });
    return clear;
  };
  const clearOfLots = (rect: OrientedRect, slackM: number, skip = -1): boolean => {
    const box = rectBounds(rect);
    let clear = true;
    occupied.query(box.minX, box.minZ, box.maxX, box.maxZ, (id) => {
      if (id === skip) return;
      const other = rects[id];
      if (other && rectsOverlap(rect, other, slackM)) {
        clear = false;
        return true;
      }
    });
    return clear;
  };
  const onGround = (rect: OrientedRect): boolean => {
    const points = [...rectCorners(rect), { x: rect.x, z: rect.z }];
    for (const p of points) {
      if (!plan.parcelAt(p.x, p.z)) return false;
      if (options.allowed && !options.allowed(p.x, p.z)) return false;
      if (waterDepthAt(terrain.water, p.x, p.z) > -PARCELS.waterClearM) return false;
      if (plan.lakes.length > 0 && lakeDepthAt(plan.lakes, p.x, p.z) > -PARCELS.waterClearM) return false;
    }
    return true;
  };
  let tries = 0;
  const fits = (rect: OrientedRect): boolean => {
    tries++;
    return onGround(rect) && clearOfLots(rect, PARCELS.slackM) && clearOfRoads(rect, 0);
  };

  const addLot = (rect: OrientedRect, use: LotUse, heightM: number, street: boolean): Lot => {
    occupy(rect);
    const lot: Lot = {
      id: lots.length,
      x: rect.x,
      z: rect.z,
      wM: rect.wM,
      dM: rect.dM,
      rotY: rect.rotY,
      use,
      heightM,
      style: profile.style(heightM),
      jitter: rng(),
      street,
    };
    lots.push(lot);
    return lot;
  };

  yield;

  // Main roads first: their frontage is taken first, as it is in a real town.
  const order = graph.edges
    .map((edge, index) => ({ index, rank: RANK[edge.kind] ?? 1, lengthM: edge.lengthM }))
    .sort((p, q) => q.rank - p.rank || q.lengthM - p.lengthM)
    .map((entry) => entry.index);

  for (const index of order) {
    if (tries > PARCELS.triesPerStep) {
      tries = 0;
      yield;
    }
    const edge = graph.edges[index];
    const a = edge ? graph.nodes[edge.a] : undefined;
    const b = edge ? graph.nodes[edge.b] : undefined;
    if (!edge || !a || !b) continue;
    const lengthM = Math.hypot(b.x - a.x, b.z - a.z);
    if (lengthM < PARCELS.minFrontM) continue;
    const dirX = (b.x - a.x) / lengthM;
    const dirZ = (b.z - a.z) / lengthM;

    for (const side of [1, -1] as const) {
      // Walk so that local +x runs along the street and local +z points away
      // from it: the street is then always on the lot's -z side.
      const start = side === 1 ? a : b;
      const alongX = dirX * side;
      const alongZ = dirZ * side;
      const awayX = -alongZ;
      const awayZ = alongX;
      const frontOf = edge.widthM / 2 + PAVEMENT_M;
      let s = 0;
      while (s < lengthM - PARCELS.minFrontM) {
        const probeX = start.x + alongX * (s + 3) + awayX * (frontOf + 5);
        const probeZ = start.z + alongZ * (s + 3) + awayZ * (frontOf + 5);
        const style = plan.parcelAt(probeX, probeZ);
        if (!style) {
          s += PARCELS.stepM * 2;
          continue;
        }
        const reach = Math.min(1, plan.reach(probeX, probeZ));
        const front = range(rng, style.frontM[0], style.frontM[1]) * scale;
        const deep = range(rng, style.depthM[0], style.depthM[1]) * scale;
        let placed: OrientedRect | null = null;
        for (const [wM, dM] of [
          [front, deep],
          [front, deep * 0.68],
          [front * 0.62, deep * 0.8],
        ] as const) {
          if (wM < PARCELS.minFrontM || dM < PARCELS.minDepthM) continue;
          if (s + wM > lengthM + wM * 0.35) continue;
          const depthAt = frontOf + style.setbackM + dM / 2;
          const rect: OrientedRect = {
            x: start.x + alongX * (s + wM / 2) + awayX * depthAt,
            z: start.z + alongZ * (s + wM / 2) + awayZ * depthAt,
            wM,
            dM,
            rotY: rotYAlong(alongX, alongZ),
          };
          if (fits(rect)) {
            placed = rect;
            break;
          }
        }
        if (!placed) {
          s += PARCELS.stepM;
          continue;
        }
        // Some plots are simply not built on: fields, yards, a gap in the row.
        // Decided only where a building would fit, or the gap is wasted on a
        // corner nothing could stand on anyway, and the plot beside it slides
        // into the middle of the block.
        const thin = reach > PARCELS.thinFrom ? ((reach - PARCELS.thinFrom) / (1 - PARCELS.thinFrom)) * PARCELS.thinMost : 0;
        if (rng() > style.fill * (1 - thin)) {
          s += placed.wM + range(rng, style.gapM[0], style.gapM[1]);
          continue;
        }
        const use = pickUse(rng, reach, profile);
        const heightM =
          use === 'park'
            ? 0
            : Math.min(profile.heightFor(rng, use, reach), Math.min(placed.wM, placed.dM) * profile.maxAspect);
        const lot = addLot(placed, use, heightM, true);
        s += placed.wM + range(rng, style.gapM[0], style.gapM[1]);
        annex(lot, style);
      }
    }
  }

  /**
   * A lower building behind the main one on the same plot: a kitchen, a
   * workshop, a garage. It is what stops every footprint in town being one
   * rectangle, and unlike a wing hung off the side it cannot land on the
   * neighbour, because it is placed like any other lot.
   */
  function annex(lot: Lot, style: ParcelStyle): void {
    if (lot.use === 'park' || lot.use === 'temple' || lot.heightM > 26) return;
    if (rng() >= style.annexChance) return;
    const wM = lot.wM * range(rng, PARCELS.annexFront[0], PARCELS.annexFront[1]);
    const dM = range(rng, PARCELS.annexDepthM[0], PARCELS.annexDepthM[1]) * scale;
    const lx = range(rng, -1, 1) * (lot.wM - wM) * 0.5;
    const lz = lot.dM / 2 + 0.5 + dM / 2;
    const centre = toWorld(lot, lx, lz);
    const rect: OrientedRect = { x: centre.x, z: centre.z, wM, dM, rotY: lot.rotY };
    if (!fits(rect)) return;
    const heightM = Math.max(3, lot.heightM * range(rng, PARCELS.annexHeight[0], PARCELS.annexHeight[1]));
    addLot(rect, lot.use, heightM, false);
  }
  yield;

  // The backs of deep blocks. A street of tube houses is built back to back
  // until the block is full; a street of detached houses keeps its gardens.
  const fronts = lots.length;
  for (let i = 0; i < fronts; i++) {
    if (tries > PARCELS.triesPerStep) {
      tries = 0;
      yield;
    }
    const lot = lots[i];
    if (!lot || !lot.street || lot.use === 'park') continue;
    const style = plan.parcelAt(lot.x, lot.z);
    if (!style || rng() >= style.backfill) continue;
    const wM = lot.wM * range(rng, 0.8, 1.05);
    const dM = range(rng, style.depthM[0], style.depthM[1]) * scale;
    for (const deep of [dM, dM * 0.7]) {
      if (deep < PARCELS.minDepthM) continue;
      const centre = toWorld(lot, range(rng, -0.08, 0.08) * lot.wM, lot.dM / 2 + range(rng, PARCELS.backGapM[0], PARCELS.backGapM[1]) + deep / 2);
      const rect: OrientedRect = { x: centre.x, z: centre.z, wM, dM: deep, rotY: lot.rotY };
      if (!fits(rect)) continue;
      const reach = Math.min(1, plan.reach(rect.x, rect.z));
      const use = pickUse(rng, reach, profile);
      const heightM =
        use === 'park' ? 0 : Math.min(profile.heightFor(rng, use, reach), Math.min(wM, deep) * profile.maxAspect);
      addLot(rect, use, heightM, false);
      break;
    }
  }
  yield;

  // Room for a yard wall, where the neighbours leave it.
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    if (!lot) continue;
    const grown: OrientedRect = {
      x: lot.x,
      z: lot.z,
      wM: lot.wM + PARCELS.yardM * 2,
      dM: lot.dM + PARCELS.yardM * 2,
      rotY: lot.rotY,
    };
    const own = plan.reserves.length + (options.prebuilt?.length ?? 0) + i;
    lot.yardM = clearOfLots(grown, 0, own) && clearOfRoads(grown, -PARCELS.roadClearM) ? PARCELS.yardM : 0;
  }

  // The parks and squares that were kept open become lots of their own.
  for (const reserve of plan.reserves) {
    if (reserve.lot !== 'park') continue;
    lots.push({
      id: lots.length,
      x: reserve.x,
      z: reserve.z,
      wM: reserve.wM,
      dM: reserve.dM,
      rotY: reserve.rotY,
      use: 'park',
      heightM: 0,
      style: profile.style(0),
      jitter: rng(),
    });
  }
  ensureTemple(rng, lots, terrain.cityRadiusM, profile);
  return lots;
}
