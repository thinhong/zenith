import { describe, expect, it } from 'vitest';
import { MODERN_PLAN } from './eras/modern';
import { buildLotIndex, MODERN_LOTS, styleFor, useWeights, type Lot } from './lots';
import { placeParcels } from './parcels';
import { planTown } from './plan';
import { mulberry32, range } from './seed';
import { buildTerrain } from './terrain';

/** The lots of a town as the modern era lays one out. */
function lotsOf(seed: number): Lot[] {
  const terrain = buildTerrain(mulberry32(seed));
  const rng = mulberry32(seed);
  return placeParcels(rng, terrain, planTown(rng, terrain, MODERN_PLAN), MODERN_LOTS);
}

describe('useWeights', () => {
  it('shifts from work downtown to homes at the edge', () => {
    const centre = useWeights(0);
    const edge = useWeights(1);
    expect(centre.work).toBeGreaterThan(edge.work);
    expect(edge.home).toBeGreaterThan(centre.home);
    for (const w of [centre, edge]) {
      for (const value of Object.values(w)) expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('styleFor', () => {
  it('splits heights into three styles', () => {
    expect(styleFor(120)).toBe('tower');
    expect(styleFor(30)).toBe('slab');
    expect(styleFor(9)).toBe('low');
  });
});

describe('buildLotIndex', () => {
  it('finds the truly nearest lot of a use', () => {
    const lots = lotsOf(1);
    const index = buildLotIndex(lots);
    const markets = lots.filter((l) => l.use === 'market');
    expect(markets.length).toBeGreaterThan(10);
    for (const probe of [
      { x: 0, z: 0 },
      { x: 600, z: -400 },
      { x: -900, z: 700 },
      { x: 1300, z: 0 },
    ]) {
      const found = index.nearest('market', probe.x, probe.z);
      const lot = lots[found];
      expect(lot).toBeDefined();
      const best = Math.min(
        ...markets.map((m) => Math.hypot(m.x - probe.x, m.z - probe.z)),
      );
      expect(Math.hypot((lot?.x ?? 0) - probe.x, (lot?.z ?? 0) - probe.z)).toBeCloseTo(best, 3);
    }
  });

  it('keeps everyday errands short enough to finish', () => {
    const lots = lotsOf(4);
    const index = buildLotIndex(lots);
    const homes = lots.filter((l) => l.use === 'home');
    let worst = 0;
    let total = 0;
    for (const home of homes) {
      const id = index.nearest('market', home.x, home.z);
      const market = lots[id];
      if (!market) continue;
      const distance = Math.hypot(market.x - home.x, market.z - home.z);
      worst = Math.max(worst, distance);
      total += distance;
    }
    // at 1.4 m/s a 150 m walk takes under two minutes of real time
    expect(total / homes.length).toBeLessThan(150);
    expect(worst).toBeLessThan(600);
  });

  it('returns -1 when nothing of that use exists', () => {
    const lots = lotsOf(2);
    expect(buildLotIndex(lots).nearest('water', 0, 0)).toBe(-1);
  });
});

describe('buildLotIndex', () => {
  it('agrees with a full scan, including from outside the city', () => {
    const lots = lotsOf(6);
    const index = buildLotIndex(lots);
    const rng = mulberry32(31);
    for (let i = 0; i < 300; i++) {
      const x = range(rng, -4000, 4000);
      const z = range(rng, -4000, 4000);
      let scanned = Infinity;
      for (const lot of lots) {
        if (lot.use !== 'market') continue;
        scanned = Math.min(scanned, (lot.x - x) ** 2 + (lot.z - z) ** 2);
      }
      const found = lots[index.nearest('market', x, z)];
      if (!found) throw new Error('no market found');
      expect((found.x - x) ** 2 + (found.z - z) ** 2).toBeCloseTo(scanned, 6);
    }
  });
});

describe('buildLotIndex on a town missing a use', () => {
  const lots: Lot[] = [
    { id: 0, x: 10, z: 10, wM: 8, dM: 8, heightM: 6, use: 'home', jitter: 0.1, style: 'low', rotY: 0 },
    { id: 1, x: 90, z: -40, wM: 8, dM: 8, heightM: 6, use: 'home', jitter: 0.2, style: 'low', rotY: 0 },
  ];

  it('says at once that there are none, rather than sweeping the grid', () => {
    const index = buildLotIndex(lots);
    const started = performance.now();
    for (let i = 0; i < 2000; i++) expect(index.nearest('market', i, -i)).toBe(-1);
    // The unbounded version ran 193 rings and 9.6 million iterations for every
    // one of these, which is minutes. Anything near instant proves the guard.
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('still finds a use that does exist', () => {
    const index = buildLotIndex(lots);
    expect(index.nearest('home', 12, 12)).toBe(0);
    expect(index.nearest('home', 88, -38)).toBe(1);
  });

  it('finds the nearest from far outside the town', () => {
    const index = buildLotIndex(lots);
    expect(index.nearest('home', 5000, 5000)).toBe(1);
    expect(index.nearest('home', -5000, 5000)).toBe(0);
  });

  it('copes with no lots at all', () => {
    const index = buildLotIndex([]);
    expect(index.nearest('home', 0, 0)).toBe(-1);
  });
});
