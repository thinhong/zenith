/**
 * Plain geometry on the ground plane, (x, z) in metres. Pure, and shared by
 * the town planner, the lot placer and the tests.
 *
 * Rotation follows `Structure.rotY` and `writeInstanceMatrix`: a turn of
 * `rotY` puts local +x along (cos rotY, -sin rotY) and local +z along
 * (sin rotY, cos rotY). Everything that turns in the world turns this way.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** A rectangle turned about its own centre. `wM` runs along local x, `dM` along local z. */
export interface OrientedRect {
  x: number;
  z: number;
  wM: number;
  dM: number;
  rotY: number;
}

/**
 * Just the rectangle, from anything that has one: how a wall's box becomes
 * the ground nobody can walk through (EraLayout.barriers).
 */
export function rectOf(r: OrientedRect): OrientedRect {
  return { x: r.x, z: r.z, wM: r.wM, dM: r.dM, rotY: r.rotY };
}

/** The unit vectors a turn of `rotY` gives local +x (u) and local +z (v). */
export function axesOf(rotY: number): { ux: number; uz: number; vx: number; vz: number } {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { ux: c, uz: -s, vx: s, vz: c };
}

/** The turn that points local +x along a direction. */
export function rotYAlong(dirX: number, dirZ: number): number {
  return -Math.atan2(dirZ, dirX);
}

export function rectCorners(r: OrientedRect): Vec2[] {
  const { ux, uz, vx, vz } = axesOf(r.rotY);
  const hw = r.wM / 2;
  const hd = r.dM / 2;
  return [
    { x: r.x - ux * hw - vx * hd, z: r.z - uz * hw - vz * hd },
    { x: r.x + ux * hw - vx * hd, z: r.z + uz * hw - vz * hd },
    { x: r.x + ux * hw + vx * hd, z: r.z + uz * hw + vz * hd },
    { x: r.x - ux * hw + vx * hd, z: r.z - uz * hw + vz * hd },
  ];
}

/** The smallest axis-aligned box round a rectangle, padded by `padM`. */
export function rectBounds(r: OrientedRect, padM = 0): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const { ux, uz, vx, vz } = axesOf(r.rotY);
  const ex = Math.abs(ux) * r.wM * 0.5 + Math.abs(vx) * r.dM * 0.5 + padM;
  const ez = Math.abs(uz) * r.wM * 0.5 + Math.abs(vz) * r.dM * 0.5 + padM;
  return { minX: r.x - ex, minZ: r.z - ez, maxX: r.x + ex, maxZ: r.z + ez };
}

/**
 * Whether two rectangles overlap by more than `slackM`. A small slack lets
 * two buildings share a party wall, which a terrace of tube houses does,
 * without the test calling that a collision.
 */
export function rectsOverlap(a: OrientedRect, b: OrientedRect, slackM = 0): boolean {
  const A = axesOf(a.rotY);
  const B = axesOf(b.rotY);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes: [number, number][] = [
    [A.ux, A.uz],
    [A.vx, A.vz],
    [B.ux, B.uz],
    [B.vx, B.vz],
  ];
  for (const [ax, az] of axes) {
    const ra = (Math.abs(A.ux * ax + A.uz * az) * a.wM + Math.abs(A.vx * ax + A.vz * az) * a.dM) * 0.5;
    const rb = (Math.abs(B.ux * ax + B.uz * az) * b.wM + Math.abs(B.vx * ax + B.vz * az) * b.dM) * 0.5;
    if (Math.abs(dx * ax + dz * az) >= ra + rb - slackM) return false;
  }
  return true;
}

/** A point in a rectangle's own frame: offset along local x, then along local z. */
export function toRectFrame(r: OrientedRect, x: number, z: number): Vec2 {
  const { ux, uz, vx, vz } = axesOf(r.rotY);
  const dx = x - r.x;
  const dz = z - r.z;
  return { x: dx * ux + dz * uz, z: dx * vx + dz * vz };
}

export function pointRectDistance(px: number, pz: number, r: OrientedRect): number {
  const p = toRectFrame(r, px, pz);
  const ex = Math.max(Math.abs(p.x) - r.wM / 2, 0);
  const ez = Math.max(Math.abs(p.z) - r.dM / 2, 0);
  return Math.hypot(ex, ez);
}

export function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * Where two segments cross, as the share of the way along each, or null if
 * they are parallel. The shares are not clamped: the caller decides how far
 * past an end still counts, which is how a street that stops just short of a
 * road is still joined to it.
 */
export function segmentCrossing(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): { t: number; u: number } | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax;
  const qz = cz - az;
  return { t: (qx * sz - qz * sx) / den, u: (qx * rz - qz * rx) / den };
}

/**
 * The distance between a segment and a rectangle: zero if they touch. For a
 * convex shape and a segment that do not cross, the nearest pair always
 * includes an end of the segment or a corner of the shape, so those are all
 * that need checking.
 */
export function segmentRectDistance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  r: OrientedRect,
): number {
  const a = toRectFrame(r, ax, az);
  const b = toRectFrame(r, bx, bz);
  const hw = r.wM / 2;
  const hd = r.dM / 2;
  if (clipsBox(a.x, a.z, b.x, b.z, hw, hd)) return 0;
  let best = Math.min(pointBoxDistance(a.x, a.z, hw, hd), pointBoxDistance(b.x, b.z, hw, hd));
  for (const [cx, cz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ] as const) {
    best = Math.min(best, distanceToSegment(cx, cz, a.x, a.z, b.x, b.z));
  }
  return best;
}

function pointBoxDistance(x: number, z: number, hw: number, hd: number): number {
  return Math.hypot(Math.max(Math.abs(x) - hw, 0), Math.max(Math.abs(z) - hd, 0));
}

/** Liang-Barsky: does the segment pass through the box centred on the origin? */
function clipsBox(ax: number, az: number, bx: number, bz: number, hw: number, hd: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const edges: [number, number][] = [
    [-dx, ax + hw],
    [dx, hw - ax],
    [-dz, az + hd],
    [dz, hd - az],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

/**
 * A uniform grid over the ground holding ids by their bounding boxes. A query
 * hands each id over once, however many cells it spans.
 */
export interface GridIndex {
  insert: (id: number, minX: number, minZ: number, maxX: number, maxZ: number) => void;
  query: (minX: number, minZ: number, maxX: number, maxZ: number, visit: (id: number) => boolean | void) => void;
}

export function createGridIndex(cellM: number): GridIndex {
  const cells = new Map<number, number[]>();
  let seen = new Int32Array(1024);
  let stamp = 0;
  const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
  return {
    insert: (id, minX, minZ, maxX, maxZ) => {
      const x0 = Math.floor(minX / cellM);
      const x1 = Math.floor(maxX / cellM);
      const z0 = Math.floor(minZ / cellM);
      const z1 = Math.floor(maxZ / cellM);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          const list = cells.get(k);
          if (list) list.push(id);
          else cells.set(k, [id]);
        }
      }
      if (id >= seen.length) {
        const grown = new Int32Array(Math.max(id + 1, seen.length * 2));
        grown.set(seen);
        seen = grown;
      }
    },
    query: (minX, minZ, maxX, maxZ, visit) => {
      stamp++;
      const x0 = Math.floor(minX / cellM);
      const x1 = Math.floor(maxX / cellM);
      const z0 = Math.floor(minZ / cellM);
      const z1 = Math.floor(maxZ / cellM);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const list = cells.get(key(cx, cz));
          if (!list) continue;
          for (const id of list) {
            if (seen[id] === stamp) continue;
            seen[id] = stamp;
            if (visit(id) === true) return;
          }
        }
      }
    },
  };
}
