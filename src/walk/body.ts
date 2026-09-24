import {
  axesOf,
  createGridIndex,
  rectBounds,
  segmentRectDistance,
  toRectFrame,
  type GridIndex,
  type OrientedRect,
} from '@/world/geometry2d';

/**
 * Where a person on foot can go, and moving one about in it. Pure, so the
 * collisions can be tested without a browser (AGENTS.md 3).
 *
 * The body is a disc on the ground. Buildings and walls are turned
 * rectangles it cannot enter; water and the edge of the plain are a test it
 * cannot fail. Walking into a wall at an angle slides along it, which is
 * what makes a town walkable rather than sticky.
 */
export interface Ground {
  solids: readonly OrientedRect[];
  index: GridIndex;
  /** False where a body may not stand whatever else is there: water, the hills. */
  open: (x: number, z: number) => boolean;
}

export const BODY = {
  /** Cell size of the lookup grid, in metres. */
  cellM: 20,
  /** A step never goes further than this share of the radius, so nothing thin is walked through. */
  stepShare: 0.5,
  /** Rounds of pushing out, for a body wedged into a corner between two solids. */
  settleRounds: 3,
} as const;

export function createGround(solids: readonly OrientedRect[], open: (x: number, z: number) => boolean): Ground {
  const index = createGridIndex(BODY.cellM);
  solids.forEach((solid, id) => {
    const box = rectBounds(solid);
    index.insert(id, box.minX, box.minZ, box.maxX, box.maxZ);
  });
  return { solids, index, open };
}

/** A point pushed out of every solid near it, to at least `radiusM` from each. */
function settle(ground: Ground, x: number, z: number, radiusM: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let round = 0; round < BODY.settleRounds; round++) {
    let moved = false;
    ground.index.query(px - radiusM, pz - radiusM, px + radiusM, pz + radiusM, (id) => {
      const solid = ground.solids[id];
      if (!solid) return;
      const local = toRectFrame(solid, px, pz);
      const hw = solid.wM / 2;
      const hd = solid.dM / 2;
      let lx = local.x;
      let lz = local.z;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        // Inside: out through the nearer side.
        if (hw - Math.abs(lx) < hd - Math.abs(lz)) lx = Math.sign(lx || 1) * (hw + radiusM);
        else lz = Math.sign(lz || 1) * (hd + radiusM);
      } else {
        const cx = Math.min(hw, Math.max(-hw, lx));
        const cz = Math.min(hd, Math.max(-hd, lz));
        const gap = Math.hypot(lx - cx, lz - cz);
        if (gap >= radiusM || gap < 1e-9) return;
        lx = cx + ((lx - cx) * radiusM) / gap;
        lz = cz + ((lz - cz) * radiusM) / gap;
      }
      const { ux, uz, vx, vz } = axesOf(solid.rotY);
      px = solid.x + ux * lx + vx * lz;
      pz = solid.z + uz * lx + vz * lz;
      moved = true;
    });
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/** Whether a body of this radius can stand here: in the open and in no solid. */
export function canStand(ground: Ground, x: number, z: number, radiusM: number): boolean {
  if (!ground.open(x, z)) return false;
  const settled = settle(ground, x, z, radiusM);
  return Math.hypot(settled.x - x, settled.z - z) < 1e-6;
}

/** Whether a straight line along the ground from one point to another passes through no solid. */
export function inSight(ground: Ground, ax: number, az: number, bx: number, bz: number): boolean {
  let clear = true;
  ground.index.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (id) => {
    const solid = ground.solids[id];
    if (clear && solid && segmentRectDistance(ax, az, bx, bz, solid) <= 0) clear = false;
  });
  return clear;
}

/**
 * Moves a body by (dx, dz), sliding along anything it meets. Returns where it
 * ends up. A body that starts somewhere it should not be is pushed out first.
 */
export function moveBody(
  ground: Ground,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radiusM: number,
): { x: number; z: number } {
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / (radiusM * BODY.stepShare)));
  const sx = dx / steps;
  const sz = dz / steps;
  let px = x;
  let pz = z;
  for (let i = 0; i < steps; i++) {
    let next = settle(ground, px + sx, pz + sz, radiusM);
    if (!ground.open(next.x, next.z)) {
      // Along the shore rather than into the water: one axis at a time.
      const alongX = settle(ground, px + sx, pz, radiusM);
      const alongZ = settle(ground, px, pz + sz, radiusM);
      if (Math.abs(sx) > 1e-9 && ground.open(alongX.x, alongX.z)) next = alongX;
      else if (Math.abs(sz) > 1e-9 && ground.open(alongZ.x, alongZ.z)) next = alongZ;
      else break;
    }
    px = next.x;
    pz = next.z;
  }
  return { x: px, z: pz };
}
