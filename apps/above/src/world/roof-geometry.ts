import { BufferAttribute, BufferGeometry } from 'three';

/**
 * The roof of a Hue hall, as one instanced geometry.
 *
 * The citadel's roofs are the reason to look at it, and until now every one
 * was a flattened pyramid of ten triangles: a tent. What actually makes one of
 * these roofs is three things, and none of them are the tiles.
 *
 * The first is that the slope is **concave**. It leaves the ridge steeply and
 * flattens as it falls, so the surface sags below the straight line a plain
 * gable draws. The second is that the corners **turn up**: the eave is lowest
 * at the middle of each side and sweeps up to a flick at each of the four
 * corners. The third is the **ridge**, a heavy capped bar along the top with
 * the barge ridges running down the two ends to meet the corners.
 *
 * This is one geometry, shared by every roof in the town and scaled per
 * building. That is the whole reason it can afford to be this detailed: a
 * hundred and eighty triangles times nineteen hundred buildings is still one
 * draw call, because they are all the same shape.
 *
 * Unit space, like the other structure geometries: x and z run -0.5 to 0.5 and
 * y runs 0 to 1, so `wM`, `hM` and `dM` scale it to a building. x is the ridge
 * direction; the caller's `rotY` turns it onto the long side.
 */

export const HUE_ROOF = {
  /**
   * How the slope falls, as an exponent. Above 1 the surface sags below the
   * straight line, which is the concave sweep; at 1 it is a plain gable.
   */
  sag: 1.22,
  /**
   * How far a corner lifts above the eave line, in unit heights.
   *
   * This was 0.3 with a sag of 1.62 and the roofs read as scrolls: the
   * surface dropped so far below the straight line, and the ends curled so
   * far above it, that a hall looked like a saddle. A real one of these is
   * subtle. The eye reads the corner flick from the silhouette, not from how
   * far it travels.
   */
  cornerLiftM: 0.17,
  /** How sharply the lift is confined to the corners. Higher is tighter. */
  cornerFalloff: 3,
  /** Where along the slope the lift starts, 0 at the ridge and 1 at the eave. */
  liftFromU: 0.62,
  /** Segments down the slope. This is what makes the sweep a curve. */
  downSlope: 5,
  /** Segments along the ridge. This is what lets the corners lift. */
  alongRidge: 6,
  /**
   * The capping bar along the top. Heavier than it looks like it should be,
   * because from directly above it is the only part of the roof with a hard
   * edge on it, and it is what tells you which way a building faces.
   */
  ridgeHalfDepth: 0.075,
  ridgeRise: 0.14,
  ridgeOverhang: 0.04,
  /** The ridges running down the two ends, from the peak to the corners. */
  bargeRise: 0.035,
  bargeHalfDepth: 0.03,
} as const;

/** Height of the roof surface, given the slope position and the place along it. */
function surfaceY(u: number, x: number): number {
  const fall = Math.pow(1 - u, HUE_ROOF.sag);
  // The lift belongs to the corners: it only happens near the eave, and only
  // near the ends. Multiplying the two weights is what confines it to the four
  // corners rather than raising the whole eave or the whole end.
  const nearEave = Math.max(0, (u - HUE_ROOF.liftFromU) / (1 - HUE_ROOF.liftFromU));
  const nearEnd = Math.pow(Math.min(1, Math.abs(x) * 2), HUE_ROOF.cornerFalloff);
  return fall + HUE_ROOF.cornerLiftM * nearEave * nearEave * nearEnd;
}

/** A point on the roof surface. `side` is which slope, -1 or 1. */
function surface(u: number, x: number, side: number): [number, number, number] {
  return [x, surfaceY(u, x), side * 0.5 * u];
}

export function hueRoofGeometry(): BufferGeometry {
  const tris: [number, number, number][] = [];
  const push = (...points: [number, number, number][]): void => {
    for (const p of points) tris.push(p);
  };
  const { downSlope: N, alongRidge: M } = HUE_ROOF;
  const xAt = (j: number): number => -0.5 + j / M;

  // --- the two slopes ------------------------------------------------------
  for (const side of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const u0 = i / N;
      const u1 = (i + 1) / N;
      for (let j = 0; j < M; j++) {
        const x0 = xAt(j);
        const x1 = xAt(j + 1);
        const a = surface(u0, x0, side);
        const b = surface(u0, x1, side);
        const c = surface(u1, x1, side);
        const d = surface(u1, x0, side);
        // Wound so the face looks up and outwards on each slope.
        if (side > 0) push(a, d, c, a, c, b);
        else push(a, b, c, a, c, d);
      }
    }
  }

  // --- the two ends --------------------------------------------------------
  // The wall under the roof at each end, bounded above by the two slope curves
  // and below by the eave line. Fanned from the middle of the bottom edge.
  for (const end of [0.5, -0.5]) {
    const centre: [number, number, number] = [end, 0, 0];
    const edge: [number, number, number][] = [];
    for (let i = N; i >= 0; i--) edge.push(surface(i / N, end, -1));
    for (let i = 1; i <= N; i++) edge.push(surface(i / N, end, 1));
    // Down to the eave line at each corner, so the wall is closed.
    edge.unshift([end, 0, -0.5]);
    edge.push([end, 0, 0.5]);
    for (let i = 0; i + 1 < edge.length; i++) {
      const p = edge[i];
      const q = edge[i + 1];
      if (!p || !q) continue;
      if (end > 0) push(centre, p, q);
      else push(centre, q, p);
    }
  }

  // --- the ridge bar -------------------------------------------------------
  const rx = 0.5 + HUE_ROOF.ridgeOverhang;
  const rz = HUE_ROOF.ridgeHalfDepth;
  const top = 1 + HUE_ROOF.ridgeRise;
  box(push, -rx, 1 - 0.06, -rz, rx, top, rz);

  // --- the barge ridges ----------------------------------------------------
  // A raised strip down each end of each slope, from the peak to the corner
  // flick. These are what read as the heavy ceramic edge of a real roof.
  for (const end of [0.5, -0.5]) {
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i++) {
        const u0 = i / N;
        const u1 = (i + 1) / N;
        const inner = end > 0 ? end - HUE_ROOF.bargeHalfDepth * 2 : end + HUE_ROOF.bargeHalfDepth * 2;
        const a = surface(u0, end, side);
        const b = surface(u1, end, side);
        const c = surface(u1, inner, side);
        const d = surface(u0, inner, side);
        const lift = HUE_ROOF.bargeRise;
        const A: [number, number, number] = [a[0], a[1] + lift, a[2]];
        const B: [number, number, number] = [b[0], b[1] + lift, b[2]];
        const C: [number, number, number] = [c[0], c[1] + lift, c[2]];
        const D: [number, number, number] = [d[0], d[1] + lift, d[2]];
        // Wound to face up. Both of these were the other way round at first,
        // which put every barge ridge in the town face down: from overhead,
        // the one angle they are ever seen from, they lit as if they were the
        // underside of something. A geometry test is the only thing that
        // catches that, because a downward face still draws.
        if ((side > 0) === (end > 0)) push(A, D, C, A, C, B);
        else push(A, B, C, A, C, D);
      }
    }
  }

  // --- the underside -------------------------------------------------------
  // Only ever seen from below the eaves, so it is one quad.
  push(
    [-0.5, 0, -0.5],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, 0.5],
  );

  const positions = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const p = tris[i];
    if (!p) continue;
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  // Non-indexed, so this gives one normal per face: the slope reads as courses
  // of tile rather than as a smooth shell, which is what is wanted.
  geometry.computeVertexNormals();
  return geometry;
}

/** Six quads, wound outwards. */
function box(
  push: (...points: [number, number, number][]) => void,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const p: [number, number, number][] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const quad = (a: number, b: number, c: number, d: number): void => {
    const pa = p[a];
    const pb = p[b];
    const pc = p[c];
    const pd = p[d];
    if (!pa || !pb || !pc || !pd) return;
    push(pa, pb, pc, pa, pc, pd);
  };
  quad(4, 7, 6, 5); // top
  quad(0, 1, 2, 3); // bottom
  quad(0, 4, 5, 1); // -z
  quad(3, 2, 6, 7); // +z
  quad(0, 3, 7, 4); // -x
  quad(1, 5, 6, 2); // +x
}
