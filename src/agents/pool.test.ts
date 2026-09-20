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
import { avenueCorridors, buildBlocks, buildLotIndex, buildLots, lotsByUse } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

function city(seed: number) {
  const terrain = buildTerrain(mulberry32(seed));
  const graph = buildRoadGraph(mulberry32(seed), terrain);
  const lots = buildLots(mulberry32(seed), terrain, buildBlocks(terrain), avenueCorridors(graph));
  return { terrain, graph, lots, byUse: lotsByUse(lots), lotIndex: buildLotIndex(lots) };
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
    const { lots, byUse, lotIndex } = city(1);
    const pool = createAgentPool(2000);
    const placed = populate(mulberry32(1), pool, { lots, byUse, lotIndex, clothesCount: 6, wanted: 2000, startHour: 3 });

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

  it('starts everyone where the opening hour puts them', () => {
    const { lots, byUse, lotIndex } = city(2);
    const pool = createAgentPool(400);
    // 03:00: everyone but the night workers is asleep at home
    const placed = populate(mulberry32(2), pool, {
      lots,
      byUse,
      lotIndex,
      clothesCount: 6,
      wanted: 400,
      startHour: 3,
    });
    let atHome = 0;
    for (let i = 0; i < placed; i++) if (pool.targetLot[i] === pool.homeLot[i]) atHome++;
    expect(atHome / placed).toBeGreaterThan(0.7);

    // 12:00: most of them are out at work or at a market instead
    const midday = createAgentPool(400);
    const middayPlaced = populate(mulberry32(2), midday, {
      lots,
      byUse,
      lotIndex,
      clothesCount: 6,
      wanted: 400,
      startHour: 12,
    });
    let elsewhere = 0;
    for (let i = 0; i < middayPlaced; i++) {
      if (midday.targetLot[i] !== midday.homeLot[i]) elsewhere++;
    }
    expect(elsewhere / middayPlaced).toBeGreaterThan(0.6);
  });

  it('stands each person inside the lot they were placed in', () => {
    const { lots, byUse, lotIndex } = city(2);
    const pool = createAgentPool(300);
    const placed = populate(mulberry32(2), pool, { lots, byUse, lotIndex, clothesCount: 6, wanted: 300, startHour: 3 });
    let offCentre = 0;
    for (let i = 0; i < placed; i++) {
      // Not always home: a night worker starts their shift at 03:00.
      const where = lots[pool.targetLot[i] ?? 0];
      expect(where).toBeDefined();
      if (!where) continue;
      // Inside the footprint, wherever in it they are. Positions live in a
      // Float32Array, so a centimetre is the honest tolerance at the far edge
      // of the city.
      expect(Math.abs(agentX(pool, i) - where.x)).toBeLessThan(where.wM / 2 + 0.01);
      expect(Math.abs(agentZ(pool, i) - where.z)).toBeLessThan(where.dM / 2 + 0.01);
      if (Math.hypot(agentX(pool, i) - where.x, agentZ(pool, i) - where.z) > 0.4) offCentre++;
    }
    // And spread across the floor rather than stacked on its centre, which is
    // what an opened building used to show: one column of people.
    expect(offCentre).toBeGreaterThan(placed * 0.8);
  });

  it('spreads the schedule offsets so the city does not move as one', () => {
    const { lots, byUse, lotIndex } = city(3);
    const pool = createAgentPool(500);
    const placed = populate(mulberry32(3), pool, { lots, byUse, lotIndex, clothesCount: 6, wanted: 500, startHour: 3 });
    const offsets = Array.from(pool.hourOffset.subarray(0, placed));
    expect(Math.min(...offsets)).toBeLessThan(-0.4);
    expect(Math.max(...offsets)).toBeGreaterThan(0.4);
  });

  it('refuses to place anyone with nowhere to live', () => {
    const pool = createAgentPool(10);
    const empty = { home: [], work: [], market: [], temple: [], park: [], water: [] };
    const lotIndex = buildLotIndex([]);
    expect(
      populate(mulberry32(1), pool, { lots: [], byUse: empty, lotIndex, clothesCount: 4, wanted: 10, startHour: 3 }),
    ).toBe(0);
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
