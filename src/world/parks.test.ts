import { describe, expect, it } from 'vitest';
import type { Lot } from '@/world/lots';
import { buildParks, onParkPlan, parkPlan, PARKS, type ParkStyle } from './parks';

const STYLE: ParkStyle = {
  lawn: [0x70a050],
  path: 0xccbbaa,
  centre: 'fountain',
  stone: 0xbbbbbb,
  water: 0x3388cc,
  flowers: [0xdd4466, 0xeecc44],
  bench: 0x775533,
};

function park(wM: number, dM: number, jitter: number, over: Partial<Lot> = {}): Lot {
  return { id: 1, x: 100, z: -40, wM, dM, use: 'park', heightM: 0, style: 'low', jitter, ...over };
}

/** Corners of a structure's footprint in the ground plane. */
function footprint(s: { x: number; z: number; wM: number; dM: number; rotY: number }): [number, number][] {
  const c = Math.cos(s.rotY);
  const n = Math.sin(s.rotY);
  const out: [number, number][] = [];
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const lx = (u * s.wM) / 2;
    const lz = (v * s.dM) / 2;
    // Local +x goes to (cos, -sin) and local +z to (sin, cos).
    out.push([s.x + lx * c + lz * n, s.z - lx * n + lz * c]);
  }
  return out;
}

describe('parks', () => {
  it('grasses a park and leaves every other lot alone', () => {
    const built = buildParks(
      [park(50, 40, 0.3), park(50, 40, 0.3, { use: 'home', heightM: 8 }), park(50, 40, 0.3, { heightM: 4 })],
      STYLE,
    );
    const lawns = built.filter((s) => s.kind === 'flat' && s.colour === 0x70a050);
    expect(lawns).toHaveLength(1);
  });

  it('keeps everything inside its own lot', () => {
    for (const jitter of [0.1, 0.4, 0.6, 0.9]) {
      for (const [w, d] of [
        [20, 18],
        [36, 30],
        [60, 48],
      ] as const) {
        const lot = park(w, d, jitter);
        for (const s of buildParks([lot], STYLE)) {
          for (const [x, z] of footprint(s)) {
            expect(Math.abs(x - lot.x)).toBeLessThanOrEqual(w / 2 + 1e-6);
            expect(Math.abs(z - lot.z)).toBeLessThanOrEqual(d / 2 + 1e-6);
          }
        }
      }
    }
  });

  it('gives a small park grass and nothing else', () => {
    const side = PARKS.minPlanM + PARKS.edgeM * 2 - 0.5;
    const built = buildParks([park(side, side, 0.2)], STYLE);
    expect(built).toHaveLength(1);
    expect(parkPlan(park(side, side, 0.2))).toEqual({ paths: [], plaza: null });
  });

  it('lays a cross or a diagonal by the lot jitter, and a loop round a big one', () => {
    expect(parkPlan(park(36, 30, 0.2)).paths.map((p) => p.rotY)).toEqual([0, Math.PI / 2]);
    const diagonal = parkPlan(park(36, 30, 0.8)).paths;
    expect(diagonal).toHaveLength(2);
    expect(diagonal.every((p) => p.rotY !== 0 && Math.abs(p.rotY) < Math.PI / 2)).toBe(true);
    expect(parkPlan(park(60, 52, 0.2)).paths).toHaveLength(6);
  });

  it('knows where its own paths are, so trees can keep off them', () => {
    const plan = parkPlan(park(40, 40, 0.2));
    // Dead centre is the plaza; a point on the east arm is path; a corner is grass.
    expect(onParkPlan(plan, 100, -40, 0)).toBe(true);
    expect(onParkPlan(plan, 115, -40, 0)).toBe(true);
    expect(onParkPlan(plan, 115, -28, 0)).toBe(false);
    const diagonal = parkPlan(park(40, 40, 0.8));
    // On the diagonal, off the axes.
    expect(onParkPlan(diagonal, 110, -30, 0)).toBe(true);
    expect(onParkPlan(diagonal, 115, -40, 0)).toBe(false);
  });

  it('puts water above its basin, where it can be seen', () => {
    const built = buildParks([park(40, 36, 0.3)], STYLE);
    const basin = built.find((s) => s.kind === 'round' && s.colour === STYLE.stone);
    const water = built.find((s) => s.kind === 'round' && s.colour === STYLE.water);
    expect(basin).toBeDefined();
    expect(water).toBeDefined();
    if (!basin || !water) return;
    expect(water.y).toBeGreaterThanOrEqual(basin.y + basin.hM - 1e-9);
    expect(water.wM).toBeLessThan(basin.wM);
  });

  it('builds each centre piece an era asks for', () => {
    for (const centre of ['fountain', 'pond', 'well', 'pool', 'none'] as const) {
      const built = buildParks([park(40, 36, 0.3)], { ...STYLE, centre });
      const water = built.filter((s) => s.colour === STYLE.water);
      expect(water.length > 0, centre).toBe(centre !== 'none');
    }
  });
});
