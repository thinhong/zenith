import { junctionClearM, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * What is painted on the road, or worn into it: lane lines, crossings and stop
 * bars in 2020, strips of light in 2300, and in the old towns the ruts that
 * cart wheels cut into a lane.
 *
 * From the roof band down, a carriageway with nothing on it is the flattest
 * surface in the frame, and it reads as a grey ribbon on a map. The markings
 * are what make it read as a road. The dashes give it a direction, a crossing
 * says people cross here, and a stop bar says which side the traffic keeps
 * to. None of it is anything an aerial photograph would not show.
 *
 * Pure: a road graph in, a list of rectangles out. `road-mesh.ts` draws all
 * of them as one mesh.
 */

export type MarkingKind = 'paint' | 'light' | 'ruts';

export interface MarkingStyle {
  /**
   * `paint`: a dashed line down a street; a double line down an avenue with a
   * line along each kerb; zebra crossings and stop bars at the junctions.
   * `light`: the same plan drawn as lit strips, with a band of light where
   * people cross and no stop bars, because nothing here needs telling to stop.
   * `ruts`: wheel tracks worn into the lane, in broken runs.
   */
  kind: MarkingKind;
  /** Lane lines, crossings and bars. For `ruts`, the ruts. */
  line: number;
  /** The middle of an avenue. For `ruts`, the strip left between the wheels. */
  centre: number;
  /** How solid the marks are, 0 to 1. Nothing laid on a road stays fresh. */
  ink: number;
  /** The same for `centre`. Zero leaves the strip between the ruts out. */
  centreInk: number;
  /**
   * Share of ordinary junctions given a crossing on every arm. A junction on
   * an avenue or the ring always has them: those are the ones with lights.
   */
  crossingShare: number;
}

/** One painted or worn rectangle, lying flat on the road. */
export interface Mark {
  /** Centre, in metres. */
  x: number;
  z: number;
  /** Unit vector along its length. */
  dirX: number;
  dirZ: number;
  lengthM: number;
  widthM: number;
  colour: number;
  /** How solid, 0 to 1. */
  ink: number;
}

export const MARKINGS = {
  /** A lane line. Real ones are 10 to 15 cm wide; this is the top of that. */
  lineM: 0.15,
  /** Town dashes: short lines, longer gaps. */
  dashM: 3,
  dashGapM: 5,
  /** The space between the two lines down the middle of an avenue. */
  doubleGapM: 0.2,
  /** Narrower than this, a street has no line down it: it is one lane, or none. */
  twoLaneM: 6,
  /** How far an edge line sits in from the kerb. */
  kerbInsetM: 0.5,
  /** A crossing, measured along the road. */
  crossingDepthM: 3.2,
  stripeM: 0.5,
  stripeGapM: 0.5,
  /** Room left between the junction and the first stripe. */
  crossingSetbackM: 0.8,
  /** How far the stripes stop short of each kerb. */
  crossingMarginM: 0.5,
  stopBarM: 0.45,
  /** Between the crossing and the bar the traffic waits at. */
  stopGapM: 1.2,
  /** A run shorter than this is not worth a mark. */
  minRunM: 2,

  rutM: 0.3,
  /** Half the distance between a cart's wheels. */
  rutHalfTrackM: 0.7,
  rutRunMinM: 3,
  rutRunMaxM: 9,
  rutBreakMinM: 0.3,
  rutBreakMaxM: 2.4,
  /** How far a run strays from its line, either way. */
  rutWanderM: 0.12,
  /** The strip between the wheels. */
  humpM: 0.5,
  /** A lane this wide takes carts both ways, so it has two sets of tracks. */
  twoTrackM: 8,

  lightM: 0.18,
  lightDashM: 8,
  lightGapM: 2.5,
  /** A band of light where people cross is fainter than a line. */
  lightBandInk: 0.32,
} as const;

/** One road edge, laid out as a start point, a direction and a length. */
interface Run {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  lengthM: number;
  widthM: number;
  major: boolean;
}

/**
 * A point `alongM` down the road from its start and `acrossM` to the right of
 * its centreline. Right is the side traffic keeps to (agents/traffic.ts).
 */
function at(run: Run, alongM: number, acrossM: number): { x: number; z: number } {
  return {
    x: run.x + run.dirX * alongM - run.dirZ * acrossM,
    z: run.z + run.dirZ * alongM + run.dirX * acrossM,
  };
}

/** A mark lying along the road, from `fromM` to `toM`, `acrossM` off centre. */
function along(
  out: Mark[],
  run: Run,
  fromM: number,
  toM: number,
  acrossM: number,
  widthM: number,
  colour: number,
  ink: number,
): void {
  const lengthM = toM - fromM;
  if (lengthM < MARKINGS.minRunM * 0.5) return;
  const centre = at(run, (fromM + toM) / 2, acrossM);
  out.push({ x: centre.x, z: centre.z, dirX: run.dirX, dirZ: run.dirZ, lengthM, widthM, colour, ink });
}

/** A mark lying across the road at `alongM`, reaching from `leftM` to `rightM`. */
function across(
  out: Mark[],
  run: Run,
  alongM: number,
  leftM: number,
  rightM: number,
  depthM: number,
  colour: number,
  ink: number,
): void {
  const centre = at(run, alongM, (leftM + rightM) / 2);
  out.push({
    x: centre.x,
    z: centre.z,
    dirX: -run.dirZ,
    dirZ: run.dirX,
    lengthM: rightM - leftM,
    widthM: depthM,
    colour,
    ink,
  });
}

/** Dashes centred in the span, so both ends of a street look the same. */
function dashes(
  out: Mark[],
  run: Run,
  fromM: number,
  toM: number,
  acrossM: number,
  dashM: number,
  gapM: number,
  widthM: number,
  colour: number,
  ink: number,
): void {
  const spanM = toM - fromM;
  const count = Math.floor((spanM + gapM) / (dashM + gapM));
  if (count < 1) return;
  const usedM = count * dashM + (count - 1) * gapM;
  let s = fromM + (spanM - usedM) / 2;
  for (let i = 0; i < count; i++) {
    along(out, run, s, s + dashM, acrossM, widthM, colour, ink);
    s += dashM + gapM;
  }
}

/**
 * Junctions that get a crossing on every arm. Decided per junction rather
 * than per arm, because that is how they are built: a junction with lights
 * has a crossing on each side of it, and one without has none.
 */
function crossedJunctions(rng: Rng, graph: RoadGraph, share: number): Uint8Array {
  const crossed = new Uint8Array(graph.nodes.length);
  for (const node of graph.nodes) {
    const touching = graph.adjacency[node.id] ?? [];
    if (touching.length < 3) continue;
    const major = touching.some((index) => {
      const edge = graph.edges[index];
      return edge !== undefined && edge.kind !== 'street';
    });
    if (major || rng() < share) crossed[node.id] = 1;
  }
  return crossed;
}

/** How much road one crossing, with its stop bar, takes up. */
function crossingSpanM(style: MarkingStyle): number {
  const bar = style.kind === 'paint' ? MARKINGS.stopGapM + MARKINGS.stopBarM : 0;
  return MARKINGS.crossingSetbackM + MARKINGS.crossingDepthM + bar;
}

export function buildMarkings(rng: Rng, graph: RoadGraph, style: MarkingStyle): Mark[] {
  const out: Mark[] = [];
  const crossed =
    style.kind === 'ruts' ? new Uint8Array(graph.nodes.length) : crossedJunctions(rng, graph, style.crossingShare);

  for (const [index, edge] of graph.edges.entries()) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthM = Math.hypot(dx, dz);
    if (lengthM < 1e-6) continue;
    const run: Run = {
      x: a.x,
      z: a.z,
      dirX: dx / lengthM,
      dirZ: dz / lengthM,
      lengthM,
      widthM: edge.widthM,
      major: edge.kind !== 'street',
    };
    // A bend in one road runs straight through; only a real junction stops
    // it, and then at the edge of the road it meets, however obliquely.
    const startM = junctionClearM(graph, index, edge.a);
    const endM = lengthM - junctionClearM(graph, index, edge.b);
    if (endM - startM < MARKINGS.minRunM) continue;

    if (style.kind === 'ruts') {
      ruts(out, rng, run, startM, endM, style);
      continue;
    }

    // A crossing at each crossed end, if the road is long enough to hold both.
    const spanM = crossingSpanM(style);
    let crossA = crossed[edge.a] === 1;
    let crossB = crossed[edge.b] === 1;
    const needM = (crossA ? spanM : 0) + (crossB ? spanM : 0) + MARKINGS.minRunM;
    if (endM - startM < needM) {
      crossA = false;
      crossB = false;
    }
    let fromM = startM;
    let toM = endM;
    if (crossA) {
      crossing(out, run, startM, 1, style);
      fromM += spanM;
    }
    if (crossB) {
      crossing(out, run, endM, -1, style);
      toM -= spanM;
    }
    if (style.kind === 'paint') paintLines(out, run, fromM, toM, style);
    else lightLines(out, run, fromM, toM, style);
  }
  return out;
}

/**
 * A crossing just outside the junction at `edgeM`, reaching into the road in
 * direction `inward` (+1 from the start, -1 from the end), and the bar the
 * incoming traffic stops at.
 */
function crossing(out: Mark[], run: Run, edgeM: number, inward: 1 | -1, style: MarkingStyle): void {
  const nearM = edgeM + inward * MARKINGS.crossingSetbackM;
  const farM = nearM + inward * MARKINGS.crossingDepthM;
  const midM = (nearM + farM) / 2;
  const halfM = run.widthM / 2 - MARKINGS.crossingMarginM;
  if (halfM <= MARKINGS.stripeM) return;

  if (style.kind === 'light') {
    across(out, run, midM, -halfM, halfM, MARKINGS.crossingDepthM, style.line, style.ink * MARKINGS.lightBandInk);
    across(out, run, nearM, -halfM, halfM, MARKINGS.lightM, style.line, style.ink);
    across(out, run, farM, -halfM, halfM, MARKINGS.lightM, style.line, style.ink);
    return;
  }

  // Stripes run with the traffic, spaced evenly across the road.
  const pitchM = MARKINGS.stripeM + MARKINGS.stripeGapM;
  const count = Math.floor((halfM * 2 + MARKINGS.stripeGapM) / pitchM);
  const usedM = count * pitchM - MARKINGS.stripeGapM;
  for (let i = 0; i < count; i++) {
    const acrossM = -usedM / 2 + MARKINGS.stripeM / 2 + i * pitchM;
    const lo = Math.min(nearM, farM);
    along(out, run, lo, lo + MARKINGS.crossingDepthM, acrossM, MARKINGS.stripeM, style.line, style.ink);
  }

  // Traffic keeps right, so what arrives at this end does so on the side to
  // the right of its own heading: the left of the edge's, at the start.
  const barM = farM + inward * (MARKINGS.stopGapM + MARKINGS.stopBarM / 2);
  const kerbM = run.widthM / 2 - MARKINGS.crossingMarginM;
  if (inward === 1) across(out, run, barM, -kerbM, 0, MARKINGS.stopBarM, style.line, style.ink);
  else across(out, run, barM, 0, kerbM, MARKINGS.stopBarM, style.line, style.ink);
}

function paintLines(out: Mark[], run: Run, fromM: number, toM: number, style: MarkingStyle): void {
  if (run.major) {
    // A double line down the middle, and a line along each kerb.
    const offM = (MARKINGS.doubleGapM + MARKINGS.lineM) / 2;
    along(out, run, fromM, toM, -offM, MARKINGS.lineM, style.centre, style.ink);
    along(out, run, fromM, toM, offM, MARKINGS.lineM, style.centre, style.ink);
    const edgeM = run.widthM / 2 - MARKINGS.kerbInsetM;
    along(out, run, fromM, toM, -edgeM, MARKINGS.lineM, style.line, style.ink);
    along(out, run, fromM, toM, edgeM, MARKINGS.lineM, style.line, style.ink);
    return;
  }
  if (run.widthM < MARKINGS.twoLaneM) return;
  dashes(out, run, fromM, toM, 0, MARKINGS.dashM, MARKINGS.dashGapM, MARKINGS.lineM, style.line, style.ink);
}

function lightLines(out: Mark[], run: Run, fromM: number, toM: number, style: MarkingStyle): void {
  const edgeM = run.widthM / 2 - MARKINGS.kerbInsetM;
  along(out, run, fromM, toM, -edgeM, MARKINGS.lightM, style.line, style.ink);
  along(out, run, fromM, toM, edgeM, MARKINGS.lightM, style.line, style.ink);
  dashes(
    out,
    run,
    fromM,
    toM,
    0,
    MARKINGS.lightDashM,
    MARKINGS.lightGapM,
    MARKINGS.lightM,
    style.centre,
    style.ink,
  );
}

/**
 * Wheel tracks: a pair for each way the lane carries carts, in broken runs
 * that wander a little, and between each pair, where the wheels never go, a
 * strip of whatever grows there.
 */
function ruts(out: Mark[], rng: Rng, run: Run, fromM: number, toM: number, style: MarkingStyle): void {
  const tracks = run.widthM >= MARKINGS.twoTrackM ? [-run.widthM / 4, run.widthM / 4] : [0];
  for (const trackM of tracks) {
    for (const side of [-1, 1]) {
      let s = fromM + range(rng, 0, MARKINGS.rutBreakMaxM);
      while (s < toM - MARKINGS.minRunM) {
        const lengthM = Math.min(range(rng, MARKINGS.rutRunMinM, MARKINGS.rutRunMaxM), toM - s);
        const wanderM = range(rng, -MARKINGS.rutWanderM, MARKINGS.rutWanderM);
        const ink = style.ink * range(rng, 0.65, 1);
        if (lengthM >= MARKINGS.minRunM) {
          along(out, run, s, s + lengthM, trackM + side * MARKINGS.rutHalfTrackM + wanderM, MARKINGS.rutM, style.line, ink);
        }
        s += lengthM + range(rng, MARKINGS.rutBreakMinM, MARKINGS.rutBreakMaxM);
      }
    }
    if (style.centreInk > 0) {
      let s = fromM;
      while (s < toM - MARKINGS.minRunM) {
        const lengthM = Math.min(range(rng, MARKINGS.rutRunMaxM, MARKINGS.rutRunMaxM * 2.5), toM - s);
        if (lengthM >= MARKINGS.minRunM) {
          along(out, run, s, s + lengthM, trackM, MARKINGS.humpM, style.centre, style.centreInk * range(rng, 0.5, 1));
        }
        s += lengthM + range(rng, MARKINGS.rutBreakMaxM, MARKINGS.rutBreakMaxM * 3);
      }
    }
  }
}
