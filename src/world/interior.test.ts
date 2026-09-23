import { describe, expect, it } from 'vitest';
import { INTERIOR, OUTDOOR_SPREAD, spotInside, spotOutside, storeysIn } from '@/world/interior';
import type { Lot } from '@/world/lots';
describe('spotInside', () => {
  const lot: Lot = {
    id: 3,
    rotY: 0,
    x: 40,
    z: -20,
    wM: 12,
    dM: 9,
    heightM: 20,
    use: 'work',
    jitter: 0.4,
    style: 'slab',
  };

  it('keeps everybody off the walls', () => {
    for (let i = 0; i < 400; i++) {
      const spot = spotInside(lot, i * 0.137);
      expect(Math.abs(spot.x - lot.x)).toBeLessThan(lot.wM / 2 - INTERIOR.wallM);
      expect(Math.abs(spot.z - lot.z)).toBeLessThan(lot.dM / 2 - INTERIOR.wallM);
    }
  });

  it('puts people on floors that exist', () => {
    const floors = storeysIn(lot.heightM);
    for (let i = 0; i < 400; i++) {
      const spot = spotInside(lot, i * 0.137);
      expect(spot.storey).toBeGreaterThanOrEqual(0);
      expect(spot.storey).toBeLessThan(floors);
    }
  });

  it('gives the same person the same desk every time', () => {
    expect(spotInside(lot, 2.5)).toEqual(spotInside(lot, 2.5));
  });

  it('spreads a crowd out instead of piling it on the centre', () => {
    // The bug this replaces: sixty-four people on one spot. Check they land
    // in most of the quadrants and that hardly any sit on the centre.
    const quadrants = new Set<string>();
    let onCentre = 0;
    for (let i = 0; i < 64; i++) {
      const spot = spotInside(lot, i * 0.6180339887);
      quadrants.add(`${spot.x > lot.x}${spot.z > lot.z}`);
      if (Math.hypot(spot.x - lot.x, spot.z - lot.z) < 0.4) onCentre++;
    }
    expect(quadrants.size).toBe(4);
    expect(onCentre).toBeLessThan(4);
  });

  it('handles a building too short to have a second floor', () => {
    const hut: Lot = { ...lot, heightM: 2 };
    expect(spotInside(hut, 0.9).storey).toBe(0);
  });
});

describe('spotOutside', () => {
  const square: Lot = {
    id: 9,
    rotY: 0,
    x: -30,
    z: 15,
    wM: 20,
    dM: 16,
    heightM: 0,
    use: 'park',
    jitter: 0.2,
    style: 'low',
  };

  it('keeps everybody on the lot', () => {
    for (let i = 0; i < 400; i++) {
      const spot = spotOutside(square, i * 0.137, OUTDOOR_SPREAD.park);
      expect(Math.abs(spot.x - square.x)).toBeLessThan(square.wM / 2);
      expect(Math.abs(spot.z - square.z)).toBeLessThan(square.dM / 2);
    }
  });

  it('spreads a crowd round the lot instead of onto its centre', () => {
    const quadrants = new Set<string>();
    let onCentre = 0;
    for (let i = 0; i < 64; i++) {
      const spot = spotOutside(square, i * 0.6180339887, OUTDOOR_SPREAD.market);
      quadrants.add(`${spot.x > square.x}${spot.z > square.z}`);
      if (Math.hypot(spot.x - square.x, spot.z - square.z) < 0.3) onCentre++;
    }
    expect(quadrants.size).toBe(4);
    expect(onCentre).toBe(0);
  });

  it('presses a market crowd closer in than a park crowd', () => {
    const reach = (spread: number) => {
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const spot = spotOutside(square, i * 0.137, spread);
        total += Math.hypot(spot.x - square.x, spot.z - square.z);
      }
      return total / 200;
    };
    expect(reach(OUTDOOR_SPREAD.market)).toBeLessThan(reach(OUTDOOR_SPREAD.park));
  });

  it('gives the same person the same spot every time', () => {
    expect(spotOutside(square, 1.25, 0.3)).toEqual(spotOutside(square, 1.25, 0.3));
  });

  it('leaves everyone at ground level', () => {
    expect(spotOutside(square, 0.4, 0.3).storey).toBe(0);
  });
});
