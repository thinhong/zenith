import { describe, expect, it } from 'vitest';
import { buildWalkPath, offsetPolyline, pathLengthM, PATHS, simplifyCorners } from './paths';
import { buildRoadGraph, createGraph, nearestNode, type DraftEdge, type Point } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

/** A 4 x 4 grid of nodes 100 m apart, fully linked north-south and east-west. */
function grid(): ReturnType<typeof createGraph> {
  const points: Point[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) points.push({ x: i * 100, z: j * 100 });
  const edges: DraftEdge[] = [];
  const id = (i: number, j: number): number => j * 4 + i;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      if (i < 3) edges.push({ a: id(i, j), b: id(i + 1, j), kind: 'street', widthM: 12 });
      if (j < 3) edges.push({ a: id(i, j), b: id(i, j + 1), kind: 'street', widthM: 12 });
    }
  }
  return createGraph(points, edges);
}

describe('simplifyCorners', () => {
  it('drops the middle of a straight run but keeps the turn', () => {
    const x = [0, 10, 20, 30, 30, 30];
    const z = [0, 0, 0, 0, 10, 20];
    const out = simplifyCorners(x, z, 0.06);
    expect(out.x).toEqual([0, 30, 30]);
    expect(out.z).toEqual([0, 0, 20]);
  });

  it('leaves two points alone', () => {
    const out = simplifyCorners([0, 5], [0, 5], 0.06);
    expect(out.x).toEqual([0, 5]);
  });
});

describe('offsetPolyline', () => {
  it('shifts a line heading east towards positive z, which is its right', () => {
    const out = offsetPolyline([0, 100], [0, 0], 5);
    expect(out.x).toEqual([0, 100]);
    expect(out.z[0]).toBeCloseTo(5, 6);
    expect(out.z[1]).toBeCloseTo(5, 6);
  });

  it('mirrors for a negative lane', () => {
    const out = offsetPolyline([0, 100], [0, 0], -5);
    expect(out.z[0]).toBeCloseTo(-5, 6);
  });

  it('keeps a corner continuous instead of stepping sideways', () => {
    // east, then north: the corner point must move diagonally, not jump
    const out = offsetPolyline([0, 100, 100], [0, 0, 100], 5);
    const cornerX = out.x[1] ?? 0;
    const cornerZ = out.z[1] ?? 0;
    expect(cornerX).toBeLessThan(100);
    expect(cornerZ).toBeGreaterThan(0);
    // and no waypoint is further than the lane width from where it started
    for (let i = 0; i < 3; i++) {
      const dx = (out.x[i] ?? 0) - [0, 100, 100][i]!;
      const dz = (out.z[i] ?? 0) - [0, 0, 100][i]!;
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(5.001);
    }
  });
});

describe('buildWalkPath', () => {
  const graph = grid();

  it('starts at the door it left and ends at the door it is going to', () => {
    const path = buildWalkPath(graph, {
      fromX: -40,
      fromZ: -40,
      toX: 340,
      toZ: 340,
      fromNode: 0,
      toNode: 15,
      laneM: 5,
    });
    expect(path.x[0]).toBe(-40);
    expect(path.z[0]).toBe(-40);
    expect(path.x[path.x.length - 1]).toBe(340);
    expect(path.z[path.z.length - 1]).toBe(340);
    expect(path.x.length).toBe(path.z.length);
  });

  it('stays under the waypoint cap', () => {
    const terrain = buildTerrain(mulberry32(1));
    const city = buildRoadGraph(mulberry32(1), terrain);
    const a = nearestNode(city, -1200, -1200);
    const b = nearestNode(city, 1200, 1200);
    const path = buildWalkPath(city, {
      fromX: -1210,
      fromZ: -1210,
      toX: 1210,
      toZ: 1210,
      fromNode: a,
      toNode: b,
      laneM: 5,
    });
    expect(path.x.length).toBeLessThanOrEqual(PATHS.maxWaypoints);
    expect(path.x.length).toBeGreaterThan(2);
    // a real route across the city, not a straight line through the buildings
    expect(pathLengthM(path)).toBeGreaterThan(Math.hypot(2420, 2420) * 0.95);
  });

  it('falls back to a straight line when the two ends are the same node', () => {
    const path = buildWalkPath(graph, {
      fromX: 0,
      fromZ: 0,
      toX: 20,
      toZ: 20,
      fromNode: 5,
      toNode: 5,
      laneM: 5,
    });
    expect(path.x.length).toBeGreaterThanOrEqual(2);
    expect(path.x[0]).toBe(0);
    expect(path.x[path.x.length - 1]).toBe(20);
  });

  it('is deterministic', () => {
    const request = { fromX: 0, fromZ: 0, toX: 300, toZ: 300, fromNode: 0, toNode: 15, laneM: 4 };
    expect(buildWalkPath(graph, request)).toEqual(buildWalkPath(graph, request));
  });
});
