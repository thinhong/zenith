import { describe, expect, it } from 'vitest';
import { availableEras, buildLayout } from '@/world/eras';
import { buildMarkings, MARKINGS, type Mark, type MarkingStyle } from './markings';
import { createGraph, type RoadGraph, type RoadKind } from './roads';
import { mulberry32 } from './seed';
import { buildTerrain } from './terrain';

const PAINT: MarkingStyle = {
  kind: 'paint',
  line: 0xffffff,
  centre: 0xffcc00,
  ink: 0.9,
  centreInk: 0,
  crossingShare: 1,
};
const LIGHT: MarkingStyle = { ...PAINT, kind: 'light' };
const RUTS: MarkingStyle = { ...PAINT, kind: 'ruts', ink: 0.5, centreInk: 0.3 };

/** One junction at the origin with four 40 m arms, each ending in a dead end. */
function plus(kind: RoadKind = 'street', widthM = 8): RoadGraph {
  return createGraph(
    [
      { x: 0, z: 0 },
      { x: 40, z: 0 },
      { x: -40, z: 0 },
      { x: 0, z: 40 },
      { x: 0, z: -40 },
    ],
    [1, 2, 3, 4].map((b) => ({ a: 0, b, kind, widthM })),
  );
}

function corners(mark: Mark): { x: number; z: number }[] {
  const acrossX = -mark.dirZ;
  const acrossZ = mark.dirX;
  const out: { x: number; z: number }[] = [];
  for (const sL of [-1, 1]) {
    for (const sW of [-1, 1]) {
      out.push({
        x: mark.x + (mark.dirX * mark.lengthM * sL) / 2 + (acrossX * mark.widthM * sW) / 2,
        z: mark.z + (mark.dirZ * mark.lengthM * sL) / 2 + (acrossZ * mark.widthM * sW) / 2,
      });
    }
  }
  return out;
}

const EPS = 1e-6;
const stripes = (marks: readonly Mark[]) => marks.filter((m) => m.widthM === MARKINGS.stripeM);
const bars = (marks: readonly Mark[]) => marks.filter((m) => m.widthM === MARKINGS.stopBarM);

describe('road markings', () => {
  it('paints a crossing on every arm of a crossed junction, and none at the dead ends', () => {
    const marks = buildMarkings(mulberry32(1), plus(), PAINT);
    // An 8 m street leaves 7 m between the margins: seven stripes on a 1 m pitch.
    expect(stripes(marks)).toHaveLength(4 * 7);
    for (const stripe of stripes(marks)) {
      const out = Math.max(Math.abs(stripe.x), Math.abs(stripe.z));
      const fromM = 4 + MARKINGS.crossingSetbackM;
      expect(out).toBeGreaterThan(fromM);
      expect(out).toBeLessThan(fromM + MARKINGS.crossingDepthM);
    }
  });

  it('leaves the junction itself clear, and keeps every mark on the road', () => {
    for (const style of [PAINT, LIGHT, RUTS]) {
      const marks = buildMarkings(mulberry32(2), plus(), style);
      let inside = 0;
      let off = 0;
      for (const mark of marks) {
        for (const c of corners(mark)) {
          if (Math.abs(c.x) < 4 - EPS && Math.abs(c.z) < 4 - EPS) inside++;
          if (Math.min(Math.abs(c.x), Math.abs(c.z)) > 4 + EPS) off++;
        }
      }
      expect({ kind: style.kind, inside, off }).toEqual({ kind: style.kind, inside: 0, off: 0 });
    }
  });

  it('puts each stop bar on the side the traffic arrives on', () => {
    // Traffic keeps right (agents/traffic.ts puts a vehicle at (-dz, dx) from
    // its heading). Arriving at the junction along an arm pointing out in
    // direction o, the heading is -o, so its right-hand side is (o.z, -o.x).
    const marks = bars(buildMarkings(mulberry32(3), plus(), PAINT));
    expect(marks).toHaveLength(4);
    for (const bar of marks) {
      const east = Math.abs(bar.x) > Math.abs(bar.z);
      const ox = east ? Math.sign(bar.x) : 0;
      const oz = east ? 0 : Math.sign(bar.z);
      expect(bar.x * oz - bar.z * ox).toBeGreaterThan(0);
    }
  });

  it('crosses no ordinary junction when the share is zero, but always an avenue', () => {
    const quiet = { ...PAINT, crossingShare: 0 };
    expect(stripes(buildMarkings(mulberry32(4), plus('street'), quiet))).toHaveLength(0);
    expect(stripes(buildMarkings(mulberry32(4), plus('avenue', 14), quiet)).length).toBeGreaterThan(0);
  });

  it('dashes a two-lane street and leaves a narrow lane bare', () => {
    const quiet = { ...PAINT, crossingShare: 0 };
    const wide = buildMarkings(mulberry32(5), plus('street', 8), quiet);
    expect(wide.length).toBeGreaterThan(8);
    expect(wide.every((m) => m.lengthM === MARKINGS.dashM && m.widthM === MARKINGS.lineM)).toBe(true);
    expect(buildMarkings(mulberry32(5), plus('street', 5), quiet)).toHaveLength(0);
  });

  it('wears ruts in broken runs, with no crossings and no bars', () => {
    const marks = buildMarkings(mulberry32(6), plus('street', 6.5), RUTS);
    const ruts = marks.filter((m) => m.widthM === MARKINGS.rutM);
    const humps = marks.filter((m) => m.widthM === MARKINGS.humpM);
    expect(ruts.length + humps.length).toBe(marks.length);
    // Two wheel lines on each of four arms, each broken into several runs.
    expect(ruts.length).toBeGreaterThan(4 * 2 * 2);
    expect(humps.length).toBeGreaterThan(0);
    expect(ruts.every((m) => m.ink <= RUTS.ink && m.ink > 0)).toBe(true);
  });

  it('draws light as a faint band where people cross, and no stop bars', () => {
    const marks = buildMarkings(mulberry32(7), plus(), LIGHT);
    expect(bars(marks)).toHaveLength(0);
    const bands = marks.filter((m) => m.widthM === MARKINGS.crossingDepthM);
    expect(bands).toHaveLength(4);
    expect(bands.every((m) => m.ink < LIGHT.ink)).toBe(true);
  });

  it('is the same every time for the same seed', () => {
    const one = buildMarkings(mulberry32(8), plus(), RUTS);
    const two = buildMarkings(mulberry32(8), plus(), RUTS);
    expect(two).toEqual(one);
  });

  it('gives every era something, inside the budget', () => {
    const terrain = buildTerrain(mulberry32(1));
    for (const era of availableEras()) {
      const layout = buildLayout(era, mulberry32(1), terrain);
      const started = performance.now();
      const marks = buildMarkings(mulberry32(29), layout.roads, era.palette.marks);
      const tookMs = performance.now() - started;
      expect(marks.length, era.name).toBeGreaterThan(layout.roads.edges.length);
      // Four vertices each, in one mesh: 40k marks is 160k vertices.
      expect(marks.length, era.name).toBeLessThan(40_000);
      expect(tookMs, era.name).toBeLessThan(200);
      for (const mark of marks) {
        const dirLength = Math.hypot(mark.dirX, mark.dirZ);
        if (Math.abs(dirLength - 1) > 1e-6 || !(mark.lengthM > 0) || !(mark.widthM > 0)) {
          throw new Error(`${era.name}: a bad mark ${JSON.stringify(mark)}`);
        }
      }
    }
  });
});
