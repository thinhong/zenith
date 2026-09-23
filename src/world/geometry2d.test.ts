import { describe, expect, it } from 'vitest';
import {
  axesOf,
  createGridIndex,
  distanceToSegment,
  rectBounds,
  rectCorners,
  rectsOverlap,
  rotYAlong,
  segmentCrossing,
  segmentRectDistance,
  type OrientedRect,
} from '@/world/geometry2d';

const square = (x: number, z: number, sideM: number, rotY = 0): OrientedRect => ({ x, z, wM: sideM, dM: sideM, rotY });

describe('turns', () => {
  it('follows the Structure.rotY convention', () => {
    // A quarter turn puts local +x along world -z, as writeInstanceMatrix does.
    const quarter = axesOf(Math.PI / 2);
    expect(quarter.ux).toBeCloseTo(0);
    expect(quarter.uz).toBeCloseTo(-1);
    expect(quarter.vx).toBeCloseTo(1);
    expect(quarter.vz).toBeCloseTo(0);
  });

  it('points local +x along any direction asked for', () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-3, 4], [5, -12]] as const) {
      const length = Math.hypot(dx, dz);
      const { ux, uz } = axesOf(rotYAlong(dx, dz));
      expect(ux).toBeCloseTo(dx / length);
      expect(uz).toBeCloseTo(dz / length);
    }
  });
});

describe('rectangles', () => {
  it('keeps its size when turned', () => {
    const corners = rectCorners({ x: 10, z: -5, wM: 8, dM: 4, rotY: 0.7 });
    const [a, b, c] = corners;
    expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.z ?? 0) - (a?.z ?? 0))).toBeCloseTo(8);
    expect(Math.hypot((c?.x ?? 0) - (b?.x ?? 0), (c?.z ?? 0) - (b?.z ?? 0))).toBeCloseTo(4);
  });

  it('has bounds that hold every corner', () => {
    const rect: OrientedRect = { x: 3, z: 4, wM: 12, dM: 5, rotY: -1.1 };
    const box = rectBounds(rect);
    for (const corner of rectCorners(rect)) {
      expect(corner.x).toBeGreaterThanOrEqual(box.minX - 1e-9);
      expect(corner.x).toBeLessThanOrEqual(box.maxX + 1e-9);
      expect(corner.z).toBeGreaterThanOrEqual(box.minZ - 1e-9);
      expect(corner.z).toBeLessThanOrEqual(box.maxZ + 1e-9);
    }
  });

  it('tells apart two that overlap from two that only look close', () => {
    expect(rectsOverlap(square(0, 0, 10), square(8, 0, 10))).toBe(true);
    expect(rectsOverlap(square(0, 0, 10), square(11, 0, 10))).toBe(false);
    // A diamond off the corner of a square: their boxes overlap, they do not.
    expect(rectsOverlap(square(0, 0, 10), square(10.5, 10.5, 10, Math.PI / 4))).toBe(false);
  });

  it('lets two buildings share a wall inside the slack', () => {
    expect(rectsOverlap(square(0, 0, 10), square(9.9, 0, 10), 0.15)).toBe(false);
    expect(rectsOverlap(square(0, 0, 10), square(9.5, 0, 10), 0.15)).toBe(true);
  });
});

describe('segments', () => {
  it('measures to the nearest point, including past an end', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distanceToSegment(13, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('finds where two cross, and nothing for two in parallel', () => {
    const hit = segmentCrossing(0, 0, 10, 0, 4, -5, 4, 5);
    expect(hit?.t).toBeCloseTo(0.4);
    expect(hit?.u).toBeCloseTo(0.5);
    expect(segmentCrossing(0, 0, 10, 0, 0, 2, 10, 2)).toBeNull();
  });

  it('measures from a road to a building, turned or not', () => {
    // Crossing it is no distance at all.
    expect(segmentRectDistance(-10, 0, 10, 0, square(0, 0, 4))).toBe(0);
    expect(segmentRectDistance(-10, 7, 10, 7, square(0, 0, 4))).toBeCloseTo(5);
    // A diamond's point reaches out half its diagonal.
    const diamond = square(0, 0, 4, Math.PI / 4);
    expect(segmentRectDistance(-10, 5, 10, 5, diamond)).toBeCloseTo(5 - 2 * Math.SQRT2);
  });
});

describe('createGridIndex', () => {
  it('hands each id over once, however many cells it spans', () => {
    const index = createGridIndex(10);
    index.insert(0, -25, -25, 25, 25);
    index.insert(1, 100, 100, 105, 105);
    const seen: number[] = [];
    index.query(-30, -30, 30, 30, (id) => {
      seen.push(id);
    });
    expect(seen).toEqual([0]);
  });

  it('stops as soon as the visitor says so', () => {
    const index = createGridIndex(10);
    for (let i = 0; i < 5; i++) index.insert(i, i * 3, 0, i * 3 + 1, 1);
    let visits = 0;
    index.query(0, 0, 20, 1, () => {
      visits++;
      return true;
    });
    expect(visits).toBe(1);
  });
});
