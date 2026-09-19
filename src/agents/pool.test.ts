import { describe, expect, it } from 'vitest';
import {
  advanceAgent,
  agentX,
  agentZ,
  createAgentPool,
  createVehiclePool,
  POOL,
  populate,
  setPath,
  STATE,
} from './pool';
import { ROLES } from './schedule';
import { avenueCorridors, buildBlocks, buildLots, lotsByUse } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

function city(seed: number) {
  const terrain = buildTerrain(mulberry32(seed));
  const graph = buildRoadGraph(mulberry32(seed), terrain);
  const lots = buildLots(mulberry32(seed), terrain, buildBlocks(terrain), avenueCorridors(graph));
  return { terrain, graph, lots, byUse: lotsByUse(lots) };
}

describe('createAgentPool', () => {
  it('allocates one slot per agent in every array', () => {
    const pool = createAgentPool(10);
    expect(pool.position).toHaveLength(30);
    expect(pool.pathX).toHaveLength(10 * POOL.maxWaypoints);
    expect(pool.count).toBe(0);
  });
});

describe('populate', () => {
  it('gives everyone a home, a workplace and a role', () => {
    const { lots, byUse } = city(1);
    const pool = createAgentPool(2000);
    const placed = populate(mulberry32(1), pool, { lots, byUse, clothesCount: 6, wanted: 2000 });

    expect(placed).toBeGreaterThan(500);
    expect(pool.count).toBe(placed);
    for (let i = 0; i < placed; i++) {
      expect(byUse.home).toContain(pool.homeLot[i]);
      expect(byUse.work).toContain(pool.workLot[i]);
      expect(pool.role[i]).toBeLessThan(ROLES.length);
      expect(pool.clothes[i]).toBeLessThan(6);
      expect(pool.state[i]).toBe(STATE.inside);
      expect(pool.speedMS[i]).toBeGreaterThanOrEqual(POOL.walkSpeedMS.min);
      expect(pool.speedMS[i]).toBeLessThanOrEqual(POOL.walkSpeedMS.max);
    }
  });

  it('stands each person in their own doorway', () => {
    const { lots, byUse } = city(2);
    const pool = createAgentPool(300);
    const placed = populate(mulberry32(2), pool, { lots, byUse, clothesCount: 6, wanted: 300 });
    for (let i = 0; i < placed; i++) {
      const home = lots[pool.homeLot[i] ?? 0];
      expect(home).toBeDefined();
      // Positions live in a Float32Array, so a centimetre is the honest tolerance
      // at the far edge of a 1.4 km city.
      const gap = Math.hypot(agentX(pool, i) - (home?.x ?? 0), agentZ(pool, i) - (home?.z ?? 0));
      expect(gap).toBeLessThan(0.01);
    }
  });

  it('spreads the schedule offsets so the city does not move as one', () => {
    const { lots, byUse } = city(3);
    const pool = createAgentPool(500);
    const placed = populate(mulberry32(3), pool, { lots, byUse, clothesCount: 6, wanted: 500 });
    const offsets = Array.from(pool.hourOffset.subarray(0, placed));
    expect(Math.min(...offsets)).toBeLessThan(-0.4);
    expect(Math.max(...offsets)).toBeGreaterThan(0.4);
  });

  it('refuses to place anyone with nowhere to live', () => {
    const pool = createAgentPool(10);
    const empty = { home: [], work: [], market: [], temple: [], park: [], water: [] };
    expect(populate(mulberry32(1), pool, { lots: [], byUse: empty, clothesCount: 4, wanted: 10 })).toBe(0);
  });
});

describe('advanceAgent', () => {
  it('walks a straight path at the agent speed', () => {
    const pool = createAgentPool(1);
    pool.speedMS[0] = 2;
    setPath(pool, 0, [0, 100], [0, 0]);
    expect(advanceAgent(pool, 0, 10)).toBe(false);
    expect(agentX(pool, 0)).toBeCloseTo(20, 5);
    expect(agentZ(pool, 0)).toBeCloseTo(0, 5);
    expect(pool.heading[0]).toBeCloseTo(0, 5);
  });

  it('turns the corner and reports arrival at the last waypoint', () => {
    const pool = createAgentPool(1);
    pool.speedMS[0] = 10;
    setPath(pool, 0, [0, 100, 100], [0, 0, 100]);
    expect(advanceAgent(pool, 0, 12)).toBe(false);
    // 120 m walked: 100 east then 20 north
    expect(agentX(pool, 0)).toBeCloseTo(100, 4);
    expect(agentZ(pool, 0)).toBeCloseTo(20, 4);
    expect(pool.heading[0]).toBeCloseTo(Math.PI / 2, 4);
    expect(advanceAgent(pool, 0, 20)).toBe(true);
    expect(agentX(pool, 0)).toBeCloseTo(100, 4);
    expect(agentZ(pool, 0)).toBeCloseTo(100, 4);
  });

  it('adds up the same however the time is sliced', () => {
    const fine = createAgentPool(1);
    const coarse = createAgentPool(1);
    for (const pool of [fine, coarse]) {
      pool.speedMS[0] = 1.4;
      setPath(pool, 0, [0, 60, 60, 200], [0, 0, 80, 80]);
    }
    for (let i = 0; i < 64; i++) advanceAgent(fine, 0, 1 / 8);
    for (let i = 0; i < 8; i++) advanceAgent(coarse, 0, 1);
    expect(agentX(fine, 0)).toBeCloseTo(agentX(coarse, 0), 3);
    expect(agentZ(fine, 0)).toBeCloseTo(agentZ(coarse, 0), 3);
  });

  it('treats a path of fewer than two points as already arrived', () => {
    const pool = createAgentPool(1);
    setPath(pool, 0, [5], [5]);
    expect(advanceAgent(pool, 0, 1)).toBe(true);
  });
});

describe('createVehiclePool', () => {
  it('starts every vehicle off the road, facing forward', () => {
    const pool = createVehiclePool(5);
    expect(Array.from(pool.edge)).toEqual([-1, -1, -1, -1, -1]);
    expect(Array.from(pool.forward)).toEqual([1, 1, 1, 1, 1]);
  });
});
