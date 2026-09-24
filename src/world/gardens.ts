import type { Structure } from '@/world/eras';
import { orientToFrame, toWorld } from '@/world/frame';
import {
  createGridIndex,
  distanceToSegment,
  pointRectDistance,
  rectBounds,
  rectOf,
  type OrientedRect,
} from '@/world/geometry2d';
import type { Lot } from '@/world/lots';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * Front gardens, for an era that keeps them (2300). Pure: lots and roads in,
 * structures and the walls somebody on foot cannot pass out (AGENTS.md 3).
 *
 * Every house on a street keeps a garden between its door and the pavement:
 * a bed of planting with a few stepping stones across it from the gate to
 * the door, and a tree or two (world/props.ts plants those). Most are behind
 * a wall of pale plaster or dark boards with a gap in the middle for the
 * gate; some behind a clipped hedge; a few are left open to the street.
 *
 * The garden is measured against the pavement and every other lot before
 * anything is put there, and steps back from its deepest until it fits, or
 * there is no garden. What stands on the lot itself is world/houses.ts.
 */
export interface GardenStyle {
  /** The deepest a front garden may be, and the least worth making, in metres. */
  depthM: readonly [number, number];
  /** How far the garden runs past each side of the house, at most. */
  sideM: number;
  wall: {
    heightM: number;
    /** A workplace keeps a planter wall you can see over, not a wall. */
    lowM: number;
    thicknessM: number;
    /** The gap in the middle of the front, in line with the door. */
    gateM: number;
    plaster: readonly number[];
    /** Dark boards with gaps between them, instead of plaster, on this share of walled gardens. */
    boards: readonly number[];
    boardShare: number;
  };
  /** Some gardens are kept by a clipped hedge instead of a wall, and some are left open to the street. */
  hedge: { share: number; heightM: number; thicknessM: number; colours: readonly number[] };
  openShare: number;
  /** The planting bed that fills the garden, and the stones across it. */
  bed: readonly number[];
  stone: readonly number[];
}

export const GARDEN = {
  /** Kept clear between a garden wall and the pavement. */
  roadClearM: 0.3,
  /** And between a garden and any other lot. */
  lotClearM: 0.35,
  /** How far apart the checks along a wall line are. */
  sampleM: 0.8,
  /** How much shallower to try when a garden does not fit. */
  depthStepM: 0.2,
  /** The side reach to fall back to when the full one does not fit. */
  narrowSideM: 0.3,
  /** Nothing is gardened in front of a building narrower than this. */
  minFrontM: 5,
  /** Heights of the flat pieces, a layer apart as the ground's are (world/ground.ts LAYER_Y). */
  bedY: 0.04,
  stoneY: 0.07,
  /** A stepping stone, across and along, and the pitch between them. */
  stoneM: [0.95, 0.5] as const,
  stonePitchM: 0.72,
  /** A board, its height and thickness, and the pitch up the fence; and the posts. */
  boardM: [0.13, 0.05] as const,
  boardPitchM: 0.21,
  postM: 0.09,
  /** Where somebody coming to a garden from the street stands: just outside its gate. */
  approachM: 1.1,
  /**
   * Lots handled between one frame and the next during a change of era. The
   * whole town takes about a hundred milliseconds each way (world/world.ts
   * runs one step a frame).
   */
  lotsPerStep: 120,
} as const;

/** Runs a generator of steps to its end, for a caller with no frame to protect. */
function finish<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Picks from a list by a 0..1 roll. */
function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.max(0, Math.floor(roll * colours.length)));
  return colours[index] ?? 0x808080;
}

/** Where to stand, just outside a lot's garden gate, in the world. Null for a lot with no garden. */
export function gateApproach(lot: Lot): { x: number; z: number } | null {
  if (!lot.garden) return null;
  return toWorld(lot, 0, -(lot.dM / 2 + lot.garden.depthM + GARDEN.approachM));
}

/**
 * Gives every building on a street room for a front garden where there is
 * room for one, by setting `lot.garden`. Lots are checked in order, and each
 * garden once placed is kept clear of by the ones after it.
 */
export function measureGardens(lots: readonly Lot[], roads: RoadGraph, style: GardenStyle): void {
  finish(measureGardenSteps(lots, roads, style));
}

/** `measureGardens` a few lots a frame. */
export function* measureGardenSteps(lots: readonly Lot[], roads: RoadGraph, style: GardenStyle): Generator<void, void, void> {
  const edges = createGridIndex(24);
  roads.edges.forEach((edge, i) => {
    const a = roads.nodes[edge.a];
    const b = roads.nodes[edge.b];
    if (!a || !b) return;
    const pad = edge.widthM / 2 + PAVEMENT_M + GARDEN.roadClearM;
    edges.insert(i, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
  });
  // Every lot, parks included: a garden wall does not belong in a park.
  const taken: OrientedRect[] = lots.map((lot) => rectOf(lot));
  const owners: (Lot | null)[] = [...lots];
  const occupied = createGridIndex(24);
  taken.forEach((rect, i) => {
    const box = rectBounds(rect, GARDEN.lotClearM);
    occupied.insert(i, box.minX, box.minZ, box.maxX, box.maxZ);
  });

  const clearOfRoads = (x: number, z: number): boolean => {
    let clear = true;
    edges.query(x, z, x, z, (i) => {
      if (!clear) return;
      const edge = roads.edges[i];
      const a = edge ? roads.nodes[edge.a] : undefined;
      const b = edge ? roads.nodes[edge.b] : undefined;
      if (!edge || !a || !b) return;
      if (distanceToSegment(x, z, a.x, a.z, b.x, b.z) < edge.widthM / 2 + PAVEMENT_M + GARDEN.roadClearM) clear = false;
    });
    return clear;
  };
  const clearOfOthers = (x: number, z: number, own: Lot): boolean => {
    let clear = true;
    occupied.query(x, z, x, z, (i) => {
      if (!clear || owners[i] === own) return;
      const rect = taken[i];
      if (rect && pointRectDistance(x, z, rect) < GARDEN.lotClearM) clear = false;
    });
    return clear;
  };

  const fits = (lot: Lot, sideM: number, depthM: number): boolean => {
    const halfW = lot.wM / 2 + sideM;
    const front = -(lot.dM / 2 + depthM);
    const back = -lot.dM / 2;
    // The front wall, and both returns back to the house.
    const lines: readonly (readonly [number, number, number, number])[] = [
      [-halfW, front, halfW, front],
      [-halfW, front, -halfW, back],
      [halfW, front, halfW, back],
    ];
    for (const [ax, az, bx, bz] of lines) {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / GARDEN.sampleM));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = toWorld(lot, ax + (bx - ax) * t, az + (bz - az) * t);
        if (!clearOfRoads(p.x, p.z) || !clearOfOthers(p.x, p.z, lot)) return false;
      }
    }
    return true;
  };

  let done = 0;
  for (const lot of lots) {
    if (++done % GARDEN.lotsPerStep === 0) yield;
    lot.garden = undefined;
    if (lot.heightM <= 0 || lot.street !== true || lot.use === 'market' || lot.use === 'park') continue;
    if (lot.wM < GARDEN.minFrontM) continue;
    let found: { depthM: number; sideM: number } | undefined;
    for (const sideM of [style.sideM, GARDEN.narrowSideM]) {
      for (let depthM = style.depthM[1]; depthM >= style.depthM[0] - 1e-6; depthM -= GARDEN.depthStepM) {
        if (fits(lot, sideM, depthM)) {
          found = { depthM, sideM };
          break;
        }
      }
      if (found) break;
    }
    if (!found) continue;
    lot.garden = found;
    // Kept clear of by the gardens after it.
    const halfW = lot.wM / 2 + found.sideM;
    const centre = toWorld(lot, 0, -(lot.dM / 2 + found.depthM / 2));
    const rect: OrientedRect = { x: centre.x, z: centre.z, wM: halfW * 2, dM: found.depthM, rotY: lot.rotY };
    const box = rectBounds(rect, GARDEN.lotClearM);
    occupied.insert(taken.length, box.minX, box.minZ, box.maxX, box.maxZ);
    taken.push(rect);
    owners.push(lot);
  }
}

export interface Gardens {
  structures: Structure[];
  /** What somebody on foot cannot walk through: the garden walls and hedges (walk/town.ts). */
  barriers: OrientedRect[];
}

/** The front gardens, for lots `measureGardens` has been over. */
export function buildGardens(rng: Rng, lots: readonly Lot[], style: GardenStyle): Gardens {
  return finish(buildGardenSteps(rng, lots, style));
}

/** `buildGardens` a few lots a frame. */
export function* buildGardenSteps(rng: Rng, lots: readonly Lot[], style: GardenStyle): Generator<void, Gardens, void> {
  const structures: Structure[] = [];
  const barriers: OrientedRect[] = [];
  let done = 0;
  for (const lot of lots) {
    if (++done % GARDEN.lotsPerStep === 0) yield;
    const garden = lot.garden;
    if (!garden || lot.heightM <= 0) continue;
    const from = structures.length;
    const halfW = lot.wM / 2 + garden.sideM;
    const houseFront = lot.z - lot.dM / 2;
    const roll = rng();
    const open = roll < style.openShare;
    const hedge = !open && roll < style.openShare + style.hedge.share;
    const t = hedge ? style.hedge.thicknessM : style.wall.thicknessM;
    const wallZ = houseFront - garden.depthM;

    if (!open) {
      const heightM = hedge ? style.hedge.heightM : lot.use === 'work' ? style.wall.lowM : style.wall.heightM;
      const boards = !hedge && lot.use !== 'work' && rng() < style.wall.boardShare;
      const colour = hedge
        ? pick(style.hedge.colours, rng())
        : boards
          ? pick(style.wall.boards, rng())
          : pick(style.wall.plaster, (lot.jitter * 3.1) % 1);
      const gate = style.wall.gateM / 2;
      // Each run: centre, length along it, and whether it runs along x.
      const runs: { x: number; z: number; lengthM: number; alongX: boolean }[] = [
        { x: lot.x - (halfW + gate) / 2, z: wallZ + t / 2, lengthM: halfW - gate, alongX: true },
        { x: lot.x + (halfW + gate) / 2, z: wallZ + t / 2, lengthM: halfW - gate, alongX: true },
        { x: lot.x - halfW + t / 2, z: houseFront - garden.depthM / 2, lengthM: garden.depthM, alongX: false },
        { x: lot.x + halfW - t / 2, z: houseFront - garden.depthM / 2, lengthM: garden.depthM, alongX: false },
      ];
      for (const run of runs) {
        if (run.lengthM < 0.2) continue;
        if (!boards) {
          structures.push({
            kind: 'box',
            x: run.x,
            y: 0,
            z: run.z,
            wM: run.alongX ? run.lengthM : t,
            hM: heightM,
            dM: run.alongX ? t : run.lengthM,
            rotY: 0,
            colour,
          });
        } else {
          // Boards with a gap between each, held by a post at either end.
          for (let y = 0.12; y + GARDEN.boardM[0] <= heightM; y += GARDEN.boardPitchM) {
            structures.push({
              kind: 'box',
              x: run.x,
              y,
              z: run.z,
              wM: run.alongX ? run.lengthM : GARDEN.boardM[1],
              hM: GARDEN.boardM[0],
              dM: run.alongX ? GARDEN.boardM[1] : run.lengthM,
              rotY: 0,
              colour,
            });
          }
          for (const end of [-1, 1]) {
            const along = end * (run.lengthM / 2 - GARDEN.postM / 2);
            structures.push({
              kind: 'box',
              x: run.x + (run.alongX ? along : 0),
              y: 0,
              z: run.z + (run.alongX ? 0 : along),
              wM: GARDEN.postM,
              hM: heightM,
              dM: GARDEN.postM,
              rotY: 0,
              colour,
            });
          }
        }
        // The outline for the walker, one rectangle a run, whatever it is built of.
        const centre = toWorld(lot, run.x - lot.x, run.z - lot.z);
        barriers.push({
          x: centre.x,
          z: centre.z,
          wM: run.alongX ? run.lengthM : t,
          dM: run.alongX ? t : run.lengthM,
          rotY: lot.rotY,
        });
      }
    }

    // The bed fills the garden; the stones cross it from the gate to the door.
    const inner = open ? 0.1 : t;
    const bedDepth = garden.depthM - inner - 0.05;
    structures.push({
      kind: 'flat',
      x: lot.x,
      y: GARDEN.bedY,
      z: wallZ + inner + bedDepth / 2,
      wM: (halfW - inner) * 2,
      hM: 1,
      dM: bedDepth,
      rotY: 0,
      colour: pick(style.bed, (lot.jitter * 5.7) % 1),
    });
    const stone = pick(style.stone, rng());
    const stones = Math.floor((bedDepth - 0.2) / GARDEN.stonePitchM);
    for (let i = 0; i < stones; i++) {
      structures.push({
        kind: 'flat',
        x: lot.x + range(rng, -0.06, 0.06),
        y: GARDEN.stoneY,
        z: wallZ + inner + 0.1 + GARDEN.stoneM[1] / 2 + i * GARDEN.stonePitchM,
        wM: GARDEN.stoneM[0],
        hM: 1,
        dM: GARDEN.stoneM[1],
        rotY: range(rng, -0.05, 0.05),
        colour: stone,
      });
    }
    orientToFrame(structures, from, lot);
  }
  return { structures, barriers };
}
