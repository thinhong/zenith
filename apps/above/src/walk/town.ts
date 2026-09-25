import { WALK } from '@/state/altitude';
import { createGround, type Ground } from '@/walk/body';
import type { EraLayout } from '@/world/eras';
import { distanceToSegment, rectOf, type OrientedRect } from '@/world/geometry2d';
import { PLAN } from '@/world/plan';
import { waterDepthAt, type TerrainSpec } from '@/world/terrain';

/**
 * The ground of one era's town, for walking on: every building, whatever
 * the era says cannot be walked through (walls, a moat), the water and the
 * town's own ponds, and the edge of the plain where the hills begin. The bridges over a river are the
 * roads that cross it, and they can be walked.
 */
export function townGround(layout: EraLayout, terrain: TerrainSpec): Ground {
  const solids: OrientedRect[] = [];
  for (const lot of layout.lots) {
    // A park is walked through. Everything else with a height is a building.
    if (lot.use === 'park' || lot.heightM <= 0) continue;
    solids.push(rectOf(lot));
  }
  for (const barrier of layout.barriers ?? []) solids.push(rectOf(barrier));

  // A road whose middle is in the water is a bridge.
  const bridges: { ax: number; az: number; bx: number; bz: number; halfM: number }[] = [];
  const { nodes, edges } = layout.roads;
  for (const edge of edges) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    if (!a || !b) continue;
    if (waterDepthAt(terrain.water, (a.x + b.x) / 2, (a.z + b.z) / 2) < -WALK.shoreM) continue;
    bridges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, halfM: edge.widthM / 2 });
  }

  // Past here the roads have stopped and the land starts to climb.
  const edgeM = PLAN.countryStopM + 30;
  const wet = layout.wet;
  const open = (x: number, z: number): boolean => {
    if (Math.hypot(x, z) > edgeM) return false;
    // The town's own ponds, less their bridges and islands.
    if (wet?.(x, z)) return false;
    if (waterDepthAt(terrain.water, x, z) < -WALK.shoreM) return true;
    return bridges.some((bridge) => distanceToSegment(x, z, bridge.ax, bridge.az, bridge.bx, bridge.bz) < bridge.halfM);
  };
  return createGround(solids, open);
}
