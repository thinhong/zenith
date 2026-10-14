import { describe, expect, it } from 'vitest';
import { MODERN_PLAN } from '@/world/eras/modern';
import { toWorld } from '@/world/frame';
import { rectCorners, rectsOverlap, segmentRectDistance, type OrientedRect } from '@/world/geometry2d';
import { MODERN_LOTS, type Lot } from '@/world/lots';
import { PARCELS, placeParcels } from '@/world/parcels';
import { planTown, type TownPlan } from '@/world/plan';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain, waterDepthAt, type TerrainSpec } from '@/world/terrain';

function townOf(seed: number): { terrain: TerrainSpec; plan: TownPlan; lots: Lot[] } {
  const terrain = buildTerrain(mulberry32(seed));
  const rng = mulberry32(seed);
  const plan = planTown(rng, terrain, MODERN_PLAN);
  return { terrain, plan, lots: placeParcels(rng, terrain, plan, MODERN_LOTS) };
}

/** The nearest any road's carriageway and pavement come to a rectangle. */
function roadGap(graph: RoadGraph, rect: OrientedRect): number {
  let best = Infinity;
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    best = Math.min(best, segmentRectDistance(a.x, a.z, b.x, b.z, rect) - edge.widthM / 2 - PAVEMENT_M);
  }
  return best;
}

describe('placeParcels', () => {
  const { terrain, plan, lots } = townOf(1);
  const built = lots.filter((lot) => lot.use !== 'park');

  it('places the same lots twice from the same seed', () => {
    expect(townOf(1).lots).toEqual(lots);
  });

  it('never stands one building on another', () => {
    for (let i = 0; i < built.length; i++) {
      const a = built[i];
      if (!a) continue;
      for (let j = i + 1; j < built.length; j++) {
        const b = built[j];
        if (!b || Math.abs(a.x - b.x) > 60 || Math.abs(a.z - b.z) > 60) continue;
        // A shared wall is allowed; anything more is two buildings in one place.
        expect(rectsOverlap(a, b, PARCELS.slackM + 1e-6)).toBe(false);
      }
    }
  });

  it('keeps every building off the roads and their pavements', () => {
    for (const lot of built) expect(roadGap(plan.roads, lot)).toBeGreaterThan(-1e-6);
  });

  it('builds nothing in the water or on its edge', () => {
    for (const lot of lots) {
      for (const corner of rectCorners(lot)) {
        expect(waterDepthAt(terrain.water, corner.x, corner.z)).toBeLessThan(-PARCELS.waterClearM + 1e-6);
      }
    }
  });

  it('turns each lot on a street to face it', () => {
    const fronts = built.filter((lot) => lot.street);
    expect(fronts.length).toBeGreaterThan(built.length * 0.5);
    const styles = [MODERN_PLAN.core.parcel, ...MODERN_PLAN.districts.map((d) => d.parcel)];
    if (MODERN_PLAN.ribbon) styles.push(MODERN_PLAN.ribbon.parcel);
    const setbackM = Math.max(...styles.map((style) => style.setbackM));
    for (const lot of fronts) {
      // The door side is local -z: its middle stands one setback back from
      // the pavement. A lot squeezed between two streets may have one at its
      // back as well, which is why this is not a comparison with the back.
      const front = toWorld(lot, 0, -lot.dM / 2);
      expect(roadGap(plan.roads, { x: front.x, z: front.z, wM: 0.01, dM: 0.01, rotY: 0 })).toBeLessThan(setbackM + 0.5);
    }
  });

  it('turns the lots every way the streets run, not all one way', () => {
    const quarter = Math.PI / 2;
    const bands = new Set(
      built.map((lot) => Math.floor(((((lot.rotY % quarter) + quarter) % quarter) / quarter) * 18)),
    );
    expect(bands.size).toBeGreaterThanOrEqual(10);
  });

  it('keeps the ground the plan left open, and makes it the park', () => {
    const open = plan.reserves.filter((reserve) => reserve.lot === 'park');
    expect(open.length).toBeGreaterThan(0);
    for (const reserve of open) {
      const park = lots.find((lot) => lot.use === 'park' && Math.hypot(lot.x - reserve.x, lot.z - reserve.z) < 1e-6);
      expect(park).toBeDefined();
      for (const lot of built) expect(rectsOverlap(reserve, lot, PARCELS.slackM)).toBe(false);
    }
  });

  it('leaves parks empty and gives every other use a building', () => {
    for (const lot of lots) {
      if (lot.use === 'park') expect(lot.heightM).toBe(0);
      else expect(lot.heightM).toBeGreaterThan(0);
    }
  });

  it('always has at least one temple and some parks', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const town = townOf(seed).lots;
      expect(town.filter((lot) => lot.use === 'temple').length).toBeGreaterThan(0);
      expect(town.filter((lot) => lot.use === 'park').length).toBeGreaterThan(3);
    }
  });

  it('builds a downtown: taller and more workplaces near the centre', () => {
    const near = lots.filter((lot) => Math.hypot(lot.x, lot.z) < terrain.cityRadiusM * 0.3);
    const far = lots.filter((lot) => Math.hypot(lot.x, lot.z) > terrain.cityRadiusM * 0.7);
    const mean = (xs: Lot[]): number => xs.reduce((sum, lot) => sum + lot.heightM, 0) / Math.max(xs.length, 1);
    const share = (xs: Lot[], use: string): number => xs.filter((lot) => lot.use === use).length / Math.max(xs.length, 1);
    expect(mean(near)).toBeGreaterThan(mean(far) * 2);
    expect(share(near, 'work')).toBeGreaterThan(share(far, 'work'));
    expect(share(far, 'home')).toBeGreaterThan(share(near, 'home'));
  });

  it('stays off ground the era keeps clear, and out of buildings it placed by hand', () => {
    const hall: OrientedRect = { x: 150, z: -150, wM: 40, dM: 30, rotY: 0.4 };
    const kept = placeParcels(mulberry32(2), terrain, plan, MODERN_LOTS, {
      allowed: (x) => x < 250,
      prebuilt: [hall],
    });
    expect(kept.length).toBeGreaterThan(200);
    for (const lot of kept) {
      if (lot.use === 'park') continue;
      for (const corner of rectCorners(lot)) expect(corner.x).toBeLessThan(250);
      expect(rectsOverlap(hall, lot, PARCELS.slackM)).toBe(false);
    }
  });
});
