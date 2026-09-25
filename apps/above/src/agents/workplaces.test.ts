import { describe, expect, it } from 'vitest';
import { buildWorkplaces, nearestWithRoom, WORK, type Workplace } from '@/agents/workplaces';
import type { Lot } from '@/world/lots';

let nextId = 0;
function lot(x: number, z: number, wM: number, dM: number, heightM: number): Lot {
  return {
    id: nextId++,
    rotY: 0,
    x,
    z,
    wM,
    dM,
    heightM,
    use: 'work',
    jitter: 0,
    style: 'low',
  };
}

describe('buildWorkplaces', () => {
  it('gives a taller building more desks than a shed of the same plan', () => {
    const lots = [lot(0, 0, 10, 10, 40), lot(50, 0, 10, 10, 4)];
    const places = buildWorkplaces(lots, [0, 1], 200);
    expect(places[0]?.capacity).toBeGreaterThan(places[1]?.capacity ?? 0);
  });

  it('seats everybody, with room to spare', () => {
    const lots = [lot(0, 0, 20, 20, 20), lot(60, 0, 14, 14, 12), lot(0, 60, 10, 10, 8)];
    const places = buildWorkplaces(lots, [0, 1, 2], 300);
    const total = places.reduce((sum, p) => sum + p.capacity, 0);
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it('never crowds a building past its floor area', () => {
    // One tiny plot and a town that wants far more desks than it can hold.
    const lots = [lot(0, 0, 3, 3, 3)];
    const places = buildWorkplaces(lots, [0], 5000);
    const areaM2 = 3 * 3 * 1;
    expect(places[0]?.capacity).toBeLessThanOrEqual(
      Math.max(WORK.minCapacity, Math.floor(areaM2 / WORK.minPerPersonM2)),
    );
  });

  it('always leaves room for at least two', () => {
    const places = buildWorkplaces([lot(0, 0, 1, 1, 2)], [0], 0);
    expect(places[0]?.capacity).toBeGreaterThanOrEqual(WORK.minCapacity);
  });

  it('returns nothing when the town has no workplaces', () => {
    expect(buildWorkplaces([], [], 100)).toEqual([]);
  });
});

describe('nearestWithRoom', () => {
  const places: Workplace[] = [
    { lot: 0, x: 0, z: 0, capacity: 2 },
    { lot: 1, x: 100, z: 0, capacity: 2 },
    { lot: 2, x: 300, z: 0, capacity: 50 },
  ];

  it('picks the nearest while it has room', () => {
    expect(nearestWithRoom(places, [0, 0, 0], 10, 0)).toBe(0);
  });

  it('walks past a full building to the next one', () => {
    expect(nearestWithRoom(places, [2, 0, 0], 10, 0)).toBe(1);
  });

  it('walks past two full buildings', () => {
    expect(nearestWithRoom(places, [2, 2, 0], 10, 0)).toBe(2);
  });

  it('spreads the overflow by how full each building is, not by distance', () => {
    // Every desk taken. The least crowded relative to its size wins, which is
    // the big one, even though it is furthest away.
    expect(nearestWithRoom(places, [4, 4, 50], 10, 0)).toBe(2);
    expect(nearestWithRoom(places, [4, 4, 200], 10, 0)).toBe(0);
  });

  it('returns -1 when the town has no workplaces', () => {
    expect(nearestWithRoom([], [], 0, 0)).toBe(-1);
  });

  it('fills a town evenly instead of piling everyone into one building', () => {
    const used = [0, 0, 0];
    for (let i = 0; i < 54; i++) {
      const pick = nearestWithRoom(places, used, 10, 0);
      used[pick] = (used[pick] ?? 0) + 1;
    }
    expect(used).toEqual([2, 2, 50]);
  });
});
