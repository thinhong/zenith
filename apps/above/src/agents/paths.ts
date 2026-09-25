import { shortestPath, type RoadGraph } from '@/world/roads';

/**
 * Turning a trip into a list of points to walk. Pure: the road graph and a few
 * numbers in, plain coordinates out, so corners and lanes can be tested without
 * a GPU (AGENTS.md 3).
 *
 * The lane offset is baked into the waypoints rather than applied while
 * walking. That keeps the per-frame work to a lerp, and it makes corners behave:
 * a node's offset uses the average of the directions either side of it, so the
 * walker cuts the corner instead of stepping sideways at the junction.
 */
export const PATHS = {
  /** Most waypoints one trip may hold. Longer routes are thinned. */
  maxWaypoints: 40,
  /** Two segments within this angle of each other count as one straight run. */
  straightRad: 0.06,
} as const;

export interface Waypoints {
  x: number[];
  z: number[];
}

export interface WalkRequest {
  /** Where the walk starts: the doorway of the lot being left. */
  fromX: number;
  fromZ: number;
  /** Where it ends: the doorway of the lot being entered. */
  toX: number;
  toZ: number;
  fromNode: number;
  toNode: number;
  /** Offset from the road centreline in metres, positive to the right of travel. */
  laneM: number;
}

export function buildWalkPath(graph: RoadGraph, request: WalkRequest): Waypoints {
  const road = nodePositions(graph, shortestPath(graph, request.fromNode, request.toNode));
  if (road.x.length === 0) {
    return { x: [request.fromX, request.toX], z: [request.fromZ, request.toZ] };
  }
  const straight = simplifyCorners(road.x, road.z, PATHS.straightRad);
  const lane = offsetPolyline(straight.x, straight.z, request.laneM);
  const x = [request.fromX, ...lane.x, request.toX];
  const z = [request.fromZ, ...lane.z, request.toZ];
  return thin({ x, z }, PATHS.maxWaypoints);
}

/** Drops points that sit on a straight run between their neighbours. */
export function simplifyCorners(
  x: readonly number[],
  z: readonly number[],
  straightRad: number,
): Waypoints {
  const count = Math.min(x.length, z.length);
  if (count <= 2) return { x: [...x], z: [...z] };
  const outX: number[] = [x[0] ?? 0];
  const outZ: number[] = [z[0] ?? 0];
  for (let i = 1; i < count - 1; i++) {
    const before = heading(x[i - 1], z[i - 1], x[i], z[i]);
    const after = heading(x[i], z[i], x[i + 1], z[i + 1]);
    if (before === null || after === null) continue;
    if (Math.abs(angleBetween(before, after)) < straightRad) continue;
    outX.push(x[i] ?? 0);
    outZ.push(z[i] ?? 0);
  }
  outX.push(x[count - 1] ?? 0);
  outZ.push(z[count - 1] ?? 0);
  return { x: outX, z: outZ };
}

/**
 * Shifts a polyline sideways by `laneM`, positive to the right of travel. At a
 * corner the shift uses the mean of the directions either side, so the line
 * stays continuous.
 */
export function offsetPolyline(
  x: readonly number[],
  z: readonly number[],
  laneM: number,
): Waypoints {
  const count = Math.min(x.length, z.length);
  const outX: number[] = [];
  const outZ: number[] = [];
  for (let i = 0; i < count; i++) {
    let dx = 0;
    let dz = 0;
    if (i > 0) {
      const d = direction(x[i - 1], z[i - 1], x[i], z[i]);
      dx += d.x;
      dz += d.z;
    }
    if (i < count - 1) {
      const d = direction(x[i], z[i], x[i + 1], z[i + 1]);
      dx += d.x;
      dz += d.z;
    }
    const length = Math.hypot(dx, dz);
    // Right of travel, with y up, is the direction rotated a quarter turn: (-dz, dx).
    const nx = length > 1e-6 ? -dz / length : 0;
    const nz = length > 1e-6 ? dx / length : 0;
    outX.push((x[i] ?? 0) + nx * laneM);
    outZ.push((z[i] ?? 0) + nz * laneM);
  }
  return { x: outX, z: outZ };
}

export function pathLengthM(points: Waypoints): number {
  let total = 0;
  for (let i = 0; i + 1 < points.x.length; i++) {
    total += Math.hypot(
      (points.x[i + 1] ?? 0) - (points.x[i] ?? 0),
      (points.z[i + 1] ?? 0) - (points.z[i] ?? 0),
    );
  }
  return total;
}

function nodePositions(graph: RoadGraph, ids: readonly number[]): Waypoints {
  const x: number[] = [];
  const z: number[] = [];
  for (const id of ids) {
    const node = graph.nodes[id];
    if (!node) continue;
    x.push(node.x);
    z.push(node.z);
  }
  return { x, z };
}

/** Keeps the ends and evenly drops the middle when a route is too long to store. */
function thin(points: Waypoints, limit: number): Waypoints {
  const count = points.x.length;
  if (count <= limit) return points;
  const x: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < limit - 1; i++) {
    const source = Math.round((i * (count - 1)) / (limit - 1));
    x.push(points.x[source] ?? 0);
    z.push(points.z[source] ?? 0);
  }
  x.push(points.x[count - 1] ?? 0);
  z.push(points.z[count - 1] ?? 0);
  return { x, z };
}

function direction(
  ax: number | undefined,
  az: number | undefined,
  bx: number | undefined,
  bz: number | undefined,
): { x: number; z: number } {
  const dx = (bx ?? 0) - (ax ?? 0);
  const dz = (bz ?? 0) - (az ?? 0);
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 0 };
}

function heading(
  ax: number | undefined,
  az: number | undefined,
  bx: number | undefined,
  bz: number | undefined,
): number | null {
  const dx = (bx ?? 0) - (ax ?? 0);
  const dz = (bz ?? 0) - (az ?? 0);
  return Math.hypot(dx, dz) < 1e-6 ? null : Math.atan2(dz, dx);
}

function angleBetween(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
