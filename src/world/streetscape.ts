import type { Structure } from '@/world/eras';
import type { Lot } from '@/world/lots';
import type { RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * What stands on the ground rather than on a roof: the wall round a yard, the
 * vehicles left at the kerb, the poles along a lane.
 *
 * The buildings were never the reason the place looked bare. It was the ground
 * between them: a flat colour with nothing standing on it. From above, a low
 * garden wall is a line and a parked van is a dash, and a few thousand of those
 * are most of what a real town's texture is made of.
 *
 * Pure, like `roofscape.ts`: roads and lots in, `Structure[]` out, drawn by
 * `world/structures.ts` as one instanced mesh per shape.
 */

export interface StreetStyle {
  /** Share of houses and shops that have a wall or fence round the yard. */
  wallShare: number;
  wallHeightM: number;
  wallColours: readonly number[];
  /** Share of street edges with something left standing at the kerb. */
  parkedShare: number;
  parked: {
    lengthM: number;
    widthM: number;
    heightM: number;
    colours: readonly number[];
  };
  /** Share of junctions with a pole beside them. A pole is an era that has them. */
  poleShare: number;
  poleColour: number;
  /**
   * What stands on the pavement: benches, planters, and the posts that keep
   * vehicles off it. The pavement is the largest empty surface in a street
   * view, and a bench on it is what says people come here.
   *
   * All of it is the `trim` kind, so it goes away above `DETAIL.trimMaxM`
   * along with the balconies. A 0.5 m bollard is not visible from the roof
   * band and there are thousands of them.
   */
  furniture: {
    /** Share of street edges given a run of furniture. */
    share: number;
    /** Roughly how far apart along the kerb, in metres. */
    stepM: number;
    benchColours: readonly number[];
    planterColours: readonly number[];
    /** The green in a planter. Empty for an era that plants nothing. */
    plantColours: readonly number[];
    bollardColour: number;
  };
}

const STREET = {
  /** How far a yard wall stands outside the building, in metres. */
  yardM: 1.6,
  wallThicknessM: 0.35,
  /** A gap is left in the wall, so a yard is not a sealed box. */
  gateShare: 0.55,
  /** Nothing is walled below this footprint: there is no yard to wall. */
  minYardSideM: 5,
  /** How far from a junction a vehicle may stand. */
  junctionClearM: 7,
  /** Spacing of parked vehicles along a kerb. */
  parkStepM: 7.5,
  poleHeightM: 7,
  poleWidthM: 0.28,
  /** How far out from the road centre the furniture sits, past the kerb. */
  furnitureOffsetM: 3.4,
  benchLengthM: 1.8,
  benchWidthM: 0.5,
  benchSeatM: 0.44,
  benchBackM: 0.42,
  planterSideM: 1.1,
  planterHeightM: 0.55,
  bollardWidthM: 0.16,
  bollardHeightM: 0.62,
  /** Bollards come in a short row, because one on its own looks like a mistake. */
  bollardRun: 4,
  bollardStepM: 1.5,
} as const;

function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.floor(roll * colours.length));
  return colours[index] ?? 0x808080;
}

export function buildStreetscape(
  rng: Rng,
  graph: RoadGraph,
  lots: readonly Lot[],
  style: StreetStyle,
): Structure[] {
  const out: Structure[] = [];
  for (const lot of lots) yardWall(out, rng, lot, style);
  kerb(out, rng, graph, style);
  furniture(out, rng, graph, style);
  return out;
}

/**
 * Benches, planters and bollards along the pavement.
 *
 * Spaced along a street edge rather than placed per lot, because that is how
 * they actually occur: a run of three planters and a bench outside one shop,
 * and then forty metres of nothing.
 */
function furniture(out: Structure[], rng: Rng, graph: RoadGraph, style: StreetStyle): void {
  const kit = style.furniture;
  if (kit.share <= 0) return;
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const lengthM = Math.hypot(b.x - a.x, b.z - a.z);
    if (lengthM < STREET.junctionClearM * 2 + kit.stepM) continue;
    if (rng() >= kit.share) continue;

    const dirX = (b.x - a.x) / lengthM;
    const dirZ = (b.z - a.z) / lengthM;
    const rotY = -Math.atan2(dirZ, dirX);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = edge.widthM / 2 + STREET.furnitureOffsetM;
    const first = STREET.junctionClearM + range(rng, 0, kit.stepM);
    const last = lengthM - STREET.junctionClearM;

    for (let t = first; t < last; t += kit.stepM) {
      const x = a.x + dirX * t - dirZ * offset * side;
      const z = a.z + dirZ * t + dirX * offset * side;
      const roll = rng();
      if (roll < 0.34) bench(out, x, z, rotY, kit);
      else if (roll < 0.62) planter(out, rng, x, z, rotY, kit);
      else if (roll < 0.74) bollards(out, x, z, dirX, dirZ, rotY, kit);
      // The rest of the time, nothing. An unbroken parade of benches is worse
      // than a bare pavement: it reads as wallpaper.
    }
  }
}

/** A seat and a back, which is the least that reads as a bench from above. */
function bench(out: Structure[], x: number, z: number, rotY: number, kit: StreetStyle['furniture']): void {
  const colour = pick(kit.benchColours, (x * 0.37 + z * 0.11) % 1);
  out.push({
    kind: 'trim',
    x,
    y: STREET.benchSeatM - 0.08,
    z,
    wM: STREET.benchLengthM,
    hM: 0.08,
    dM: STREET.benchWidthM,
    rotY,
    colour,
  });
  // The back sits along the bench's own local z, which the rotation carries.
  out.push({
    kind: 'trim',
    x: x - Math.sin(rotY) * (STREET.benchWidthM * 0.42),
    y: STREET.benchSeatM,
    z: z - Math.cos(rotY) * (STREET.benchWidthM * 0.42),
    wM: STREET.benchLengthM,
    hM: STREET.benchBackM,
    dM: 0.08,
    rotY,
    colour,
  });
}

/** A box with something growing out of it. */
function planter(
  out: Structure[],
  rng: Rng,
  x: number,
  z: number,
  rotY: number,
  kit: StreetStyle['furniture'],
): void {
  out.push({
    kind: 'trim',
    x,
    y: 0,
    z,
    wM: STREET.planterSideM,
    hM: STREET.planterHeightM,
    dM: STREET.planterSideM,
    rotY,
    colour: pick(kit.planterColours, rng()),
  });
  if (kit.plantColours.length === 0) return;
  out.push({
    kind: 'trim',
    x,
    y: STREET.planterHeightM,
    z,
    wM: STREET.planterSideM * 0.82,
    hM: range(rng, 0.4, 0.9),
    dM: STREET.planterSideM * 0.82,
    rotY,
    colour: pick(kit.plantColours, rng()),
  });
}

/** A short row of posts, which is how bollards come. */
function bollards(
  out: Structure[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  rotY: number,
  kit: StreetStyle['furniture'],
): void {
  for (let i = 0; i < STREET.bollardRun; i++) {
    const along = (i - (STREET.bollardRun - 1) / 2) * STREET.bollardStepM;
    out.push({
      kind: 'trim',
      x: x + dirX * along,
      y: 0,
      z: z + dirZ * along,
      wM: STREET.bollardWidthM,
      hM: STREET.bollardHeightM,
      dM: STREET.bollardWidthM,
      rotY,
      colour: kit.bollardColour,
    });
  }
}

/**
 * Four low walls round the yard, usually with one side left open for the gate.
 * The lot is the building's own footprint, so the wall stands a yard outside it.
 */
function yardWall(out: Structure[], rng: Rng, lot: Lot, style: StreetStyle): void {
  if (lot.heightM <= 0) return;
  if (lot.use !== 'home' && lot.use !== 'market' && lot.use !== 'temple') return;
  if (Math.min(lot.wM, lot.dM) < STREET.minYardSideM) return;
  if (rng() >= style.wallShare) return;

  const wM = lot.wM + STREET.yardM * 2;
  const dM = lot.dM + STREET.yardM * 2;
  const colour = pick(style.wallColours, lot.jitter);
  const open = rng() < STREET.gateShare ? Math.floor(rng() * 4) : -1;
  const sides = [
    { x: lot.x, z: lot.z - dM / 2, wM, dM: STREET.wallThicknessM },
    { x: lot.x, z: lot.z + dM / 2, wM, dM: STREET.wallThicknessM },
    { x: lot.x - wM / 2, z: lot.z, wM: STREET.wallThicknessM, dM },
    { x: lot.x + wM / 2, z: lot.z, wM: STREET.wallThicknessM, dM },
  ];
  for (let i = 0; i < sides.length; i++) {
    if (i === open) continue;
    const side = sides[i];
    if (!side) continue;
    out.push({
      kind: 'box',
      x: side.x,
      y: 0,
      z: side.z,
      wM: side.wM,
      hM: style.wallHeightM,
      dM: side.dM,
      rotY: 0,
      colour,
    });
  }
}

/** Vehicles standing along the kerb, and a pole here and there. */
function kerb(out: Structure[], rng: Rng, graph: RoadGraph, style: StreetStyle): void {
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const lengthM = Math.hypot(b.x - a.x, b.z - a.z);
    if (lengthM < STREET.junctionClearM * 2 + STREET.parkStepM) continue;

    if (rng() < style.poleShare) {
      const t = range(rng, 0.2, 0.8);
      const offset = edge.widthM / 2 + 1.1;
      const dirX = (b.x - a.x) / lengthM;
      const dirZ = (b.z - a.z) / lengthM;
      const side = rng() < 0.5 ? -1 : 1;
      out.push({
        kind: 'box',
        x: a.x + dirX * lengthM * t - dirZ * offset * side,
        y: 0,
        z: a.z + dirZ * lengthM * t + dirX * offset * side,
        wM: STREET.poleWidthM,
        hM: STREET.poleHeightM,
        dM: STREET.poleWidthM,
        rotY: 0,
        colour: style.poleColour,
      });
    }

    if (rng() >= style.parkedShare) continue;
    const dirX = (b.x - a.x) / lengthM;
    const dirZ = (b.z - a.z) / lengthM;
    // Local +x runs along the vehicle, so the heading is negated the same way
    // world/instanced.ts does it for the moving ones.
    const rotY = -Math.atan2(dirZ, dirX);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = edge.widthM / 2 - style.parked.widthM * 0.6;
    const first = STREET.junctionClearM + range(rng, 0, STREET.parkStepM);
    const last = lengthM - STREET.junctionClearM;
    for (let t = first; t < last; t += STREET.parkStepM) {
      if (rng() < 0.45) continue;
      out.push({
        kind: 'box',
        x: a.x + dirX * t - dirZ * offset * side,
        y: 0,
        z: a.z + dirZ * t + dirX * offset * side,
        wM: style.parked.lengthM,
        hM: style.parked.heightM,
        dM: style.parked.widthM,
        rotY,
        colour: pick(style.parked.colours, rng()),
      });
    }
  }
}
