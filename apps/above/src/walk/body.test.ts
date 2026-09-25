import { describe, expect, it } from 'vitest';
import { canStand, createGround, inSight, moveBody } from '@/walk/body';
import { pointRectDistance, type OrientedRect } from '@/world/geometry2d';

const R = 0.35;
const box: OrientedRect = { x: 10, z: 0, wM: 4, dM: 4, rotY: 0 };
const anywhere = (): boolean => true;

describe('moveBody', () => {
  it('walks freely where nothing is in the way', () => {
    const ground = createGround([], anywhere);
    const to = moveBody(ground, 0, 0, 3, 4, R);
    expect(to.x).toBeCloseTo(3);
    expect(to.z).toBeCloseTo(4);
  });

  it('stops against a wall at its own radius', () => {
    const ground = createGround([box], anywhere);
    const to = moveBody(ground, 0, 0, 20, 0, R);
    expect(to.x).toBeCloseTo(8 - R, 3);
    expect(pointRectDistance(to.x, to.z, box)).toBeGreaterThanOrEqual(R - 1e-6);
  });

  it('slides along a wall met at an angle, rather than sticking to it', () => {
    const wall: OrientedRect = { x: 0, z: 5, wM: 40, dM: 1, rotY: 0 };
    const ground = createGround([wall], anywhere);
    const to = moveBody(ground, 0, 0, 6, 8, R);
    expect(to.x).toBeGreaterThan(5.5);
    expect(to.z).toBeLessThanOrEqual(4.5 - R + 1e-6);
  });

  it('never goes through a thin wall, however fast', () => {
    // Long enough that sliding along it cannot reach its end.
    const wall: OrientedRect = { x: 5, z: 0, wM: 0.2, dM: 400, rotY: 0.3 };
    const ground = createGround([wall], anywhere);
    const to = moveBody(ground, 0, 0, 40, 0, R);
    const local = (to.x - 5) * Math.cos(0.3) - to.z * Math.sin(0.3);
    expect(local).toBeLessThan(0);
  });

  it('keeps clear of a turned building', () => {
    const turned: OrientedRect = { x: 6, z: 6, wM: 6, dM: 3, rotY: 0.7 };
    const ground = createGround([turned], anywhere);
    for (const [dx, dz] of [[12, 12], [10, 14], [14, 9]] as const) {
      const to = moveBody(ground, 0, 0, dx, dz, R);
      expect(pointRectDistance(to.x, to.z, turned)).toBeGreaterThanOrEqual(R - 1e-6);
    }
  });

  it('will not walk into the water, but will walk along the shore', () => {
    const dry = (_x: number, z: number): boolean => z < 5;
    const ground = createGround([], dry);
    const straight = moveBody(ground, 0, 0, 0, 10, R);
    expect(straight.z).toBeLessThan(5);
    const along = moveBody(ground, 0, 4.8, 10, 1, R);
    expect(along.x).toBeGreaterThan(9);
    expect(along.z).toBeLessThan(5);
  });

  it('pushes out a body that starts inside a building', () => {
    const ground = createGround([box], anywhere);
    const to = moveBody(ground, 10.5, 0.2, 0, 0, R);
    expect(pointRectDistance(to.x, to.z, box)).toBeGreaterThanOrEqual(R - 1e-6);
  });
});

describe('canStand', () => {
  it('says no inside a building, next to one or in the water, and yes in the open', () => {
    const ground = createGround([box], (x) => x > -50);
    expect(canStand(ground, 10, 0, R)).toBe(false);
    expect(canStand(ground, 8.1, 0, R)).toBe(false);
    expect(canStand(ground, -60, 0, R)).toBe(false);
    expect(canStand(ground, 0, 0, R)).toBe(true);
  });
});

describe('inSight', () => {
  it('sees past a building, and not through it', () => {
    const ground = createGround([box], anywhere);
    expect(inSight(ground, 0, 0, 20, 0)).toBe(false);
    expect(inSight(ground, 0, 5, 20, 5)).toBe(true);
    // Round the corner, over the top of nothing.
    expect(inSight(ground, 0, 0, 0, 30)).toBe(true);
  });
});
