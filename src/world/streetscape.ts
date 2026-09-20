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
  return out;
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
