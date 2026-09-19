import { describe, expect, it } from 'vitest';
import {
  avenueCorridors,
  buildBlocks,
  buildLots,
  distanceToSegment,
  LOTS,
  styleFor,
  useWeights,
  type Lot,
  type Rect,
} from './lots';
import { buildRoadGraph } from './roads';
import { mulberry32 } from './seed';
import { buildTerrain, type TerrainSpec } from './terrain';

function cityOf(seed: number): { terrain: TerrainSpec; blocks: Rect[]; lots: Lot[] } {
  const terrain = buildTerrain(mulberry32(seed));
  const graph = buildRoadGraph(mulberry32(seed), terrain);
  const blocks = buildBlocks(terrain);
  const lots = buildLots(mulberry32(seed), terrain, blocks, avenueCorridors(graph));
  return { terrain, blocks, lots };
}

describe('buildBlocks', () => {
  it('fills the city with blocks and keeps them out of the water', () => {
    const { terrain, blocks } = cityOf(1);
    expect(blocks.length).toBeGreaterThan(150);
    for (const block of blocks) {
      expect(Math.hypot(block.x, block.z)).toBeLessThan(terrain.cityRadiusM);
    }
  });
});

describe('buildLots', () => {
  it('is deterministic for the same seed', () => {
    expect(cityOf(3).lots).toEqual(cityOf(3).lots);
  });

  it('keeps every lot inside its block', () => {
    const { blocks, lots } = cityOf(2);
    const halfBlock = (blocks[0]?.wM ?? 0) / 2;
    for (const lot of lots) {
      // the lot centre must sit within half a block of some block centre
      const inside = blocks.some(
        (b) =>
          Math.abs(lot.x - b.x) <= halfBlock + 1e-6 && Math.abs(lot.z - b.z) <= halfBlock + 1e-6,
      );
      expect(inside).toBe(true);
      expect(lot.wM).toBeGreaterThanOrEqual(LOTS.minLotSideM);
      expect(lot.dM).toBeGreaterThanOrEqual(LOTS.minLotSideM);
    }
  });

  it('never puts more than the cap in one block', () => {
    const { blocks, lots } = cityOf(5);
    const halfBlock = (blocks[0]?.wM ?? 0) / 2 + 1e-6;
    for (const block of blocks) {
      const inBlock = lots.filter(
        (l) => Math.abs(l.x - block.x) <= halfBlock && Math.abs(l.z - block.z) <= halfBlock,
      );
      expect(inBlock.length).toBeLessThanOrEqual(LOTS.maxLotsPerBlock);
    }
  });

  it('leaves parks empty and gives every other use a building', () => {
    const { lots } = cityOf(4);
    for (const lot of lots) {
      if (lot.use === 'park') expect(lot.heightM).toBe(0);
      else expect(lot.heightM).toBeGreaterThan(0);
    }
  });

  it('always has at least one temple and some parks', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { lots } = cityOf(seed);
      expect(lots.filter((l) => l.use === 'temple').length).toBeGreaterThan(0);
      expect(lots.filter((l) => l.use === 'park').length).toBeGreaterThan(3);
    }
  });

  it('builds a downtown: taller and more workplaces near the centre', () => {
    const { terrain, lots } = cityOf(1);
    const near = lots.filter((l) => Math.hypot(l.x, l.z) < terrain.cityRadiusM * 0.3);
    const far = lots.filter((l) => Math.hypot(l.x, l.z) > terrain.cityRadiusM * 0.7);
    const mean = (xs: Lot[]): number => xs.reduce((s, l) => s + l.heightM, 0) / Math.max(xs.length, 1);
    const share = (xs: Lot[], use: string): number =>
      xs.filter((l) => l.use === use).length / Math.max(xs.length, 1);
    expect(mean(near)).toBeGreaterThan(mean(far) * 2);
    expect(share(near, 'work')).toBeGreaterThan(share(far, 'work'));
    expect(share(far, 'home')).toBeGreaterThan(share(near, 'home'));
  });

  it('keeps the avenues and the ring road clear of buildings', () => {
    const terrain = buildTerrain(mulberry32(6));
    const graph = buildRoadGraph(mulberry32(6), terrain);
    const corridors = avenueCorridors(graph);
    const lots = buildLots(mulberry32(6), terrain, buildBlocks(terrain), corridors);
    expect(corridors.length).toBeGreaterThan(20);
    for (const lot of lots) {
      for (const c of corridors) {
        const gap = distanceToSegment(lot.x, lot.z, c.ax, c.az, c.bx, c.bz);
        expect(gap).toBeGreaterThanOrEqual(c.halfWidthM);
      }
    }
  });
});

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
