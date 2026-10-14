import { describe, expect, it } from 'vitest';
import { CITADEL, CITADEL_PLAN } from '@/world/eras/citadel';
import { MODERN_PLAN } from '@/world/eras/modern';
import { mythPlan } from '@/world/eras/myth';
import { segmentRectDistance } from '@/world/geometry2d';
import { planarize, planTown, PLAN, type RoadPiece, type TownPlan } from '@/world/plan';
import { ROADS, type RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain, waterDepthAt, type TerrainSpec } from '@/world/terrain';

function townOf(seed: number): { plan: TownPlan; terrain: TerrainSpec } {
  const terrain = buildTerrain(mulberry32(seed));
  return { plan: planTown(mulberry32(seed), terrain, MODERN_PLAN), terrain };
}

/** How many nodes a walk from node 0 reaches. */
function reached(graph: RoadGraph): number {
  const seen = new Uint8Array(graph.nodes.length);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length > 0) {
    const node = stack.pop() ?? 0;
    for (const index of graph.adjacency[node] ?? []) {
      const edge = graph.edges[index];
      if (!edge) continue;
      const other = edge.a === node ? edge.b : edge.a;
      if (seen[other]) continue;
      seen[other] = 1;
      count++;
      stack.push(other);
    }
  }
  return count;
}

function piece(ax: number, az: number, bx: number, bz: number, rank = 1): RoadPiece {
  return { ax, az, bx, bz, kind: 'street', widthM: 8, rank, main: false };
}

describe('planTown', () => {
  it('lays out the same town twice from the same seed', () => {
    const a = townOf(3).plan;
    const b = townOf(3).plan;
    expect(a.roads).toEqual(b.roads);
    expect(a.reserves).toEqual(b.reserves);
  });

  it('hands over one connected network for every seed tried', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { roads } = townOf(seed).plan;
      expect(roads.nodes.length).toBeGreaterThan(300);
      expect(reached(roads)).toBe(roads.nodes.length);
    }
  });

  it('keeps the roads out of the water, bar a bridge or two', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { plan, terrain } = townOf(seed);
      const { nodes, edges } = plan.roads;
      for (const node of nodes) expect(waterDepthAt(terrain.water, node.x, node.z)).toBeLessThan(0);
      const wet = edges.filter((edge) => {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        if (!a || !b) return false;
        return waterDepthAt(terrain.water, (a.x + b.x) / 2, (a.z + b.z) / 2) > 0;
      });
      expect(wet.length).toBeLessThanOrEqual(ROADS.maxBridges);
    }
  });

  // The complaint this planner answers: a round town on one grid, every
  // street north-south or east-west. A grid puts nearly all of its length in
  // one ten-degree band of direction; this spreads it over most of them.
  it('runs its streets in many directions, not along one grid', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { roads } = townOf(seed).plan;
      const bands = new Array<number>(9).fill(0);
      let total = 0;
      for (const edge of roads.edges) {
        const a = roads.nodes[edge.a];
        const b = roads.nodes[edge.b];
        if (!a || !b) continue;
        const quarter = Math.PI / 2;
        const angle = ((Math.atan2(b.z - a.z, b.x - a.x) % quarter) + quarter) % quarter;
        const band = Math.min(8, Math.floor(angle / (quarter / 9)));
        bands[band] = (bands[band] ?? 0) + edge.lengthM;
        total += edge.lengthM;
      }
      const shares = bands.map((length) => length / total);
      expect(Math.max(...shares)).toBeLessThan(0.45);
      expect(shares.filter((share) => share > 0.03).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('has an edge that wanders in and out rather than a circle', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { plan } = townOf(seed);
      const radii: number[] = [];
      for (let i = 0; i < 72; i++) {
        const angle = (i / 72) * Math.PI * 2;
        radii.push(100 / plan.reach(100 * Math.cos(angle), 100 * Math.sin(angle)));
      }
      expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.15);
    }
  });

  it('mixes several kinds of district round the core', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { plan } = townOf(seed);
      const names = new Set<string>();
      for (let r = 20; r < 600; r += 15) {
        for (let i = 0; i < 90; i++) {
          const angle = (i / 90) * Math.PI * 2;
          const name = plan.districtAt(r * Math.cos(angle), r * Math.sin(angle));
          if (name) names.add(name);
        }
      }
      expect(names.has('core')).toBe(true);
      expect(names.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps a square open in the middle, with nothing laid across it', () => {
    const { plan } = townOf(1);
    const square = plan.reserves.find((reserve) => Math.hypot(reserve.x, reserve.z) < 1);
    expect(square?.lot).toBe('park');
    const halfM = Math.min(square?.wM ?? 0, square?.dM ?? 0) / 2;
    for (const node of plan.roads.nodes) expect(Math.hypot(node.x, node.z)).toBeGreaterThan(halfM);
  });

  it('builds nothing on the square or out on the open plain', () => {
    const { plan } = townOf(2);
    expect(plan.parcelAt(0, 0)).toBeNull();
    // Far out on the plain there is nothing to build along.
    expect(plan.parcelAt(2000, 2000)).toBeNull();
    expect(plan.reach(0, 1)).toBeLessThan(0.05);
  });
});

describe('the citadel plan', () => {
  const terrain = buildTerrain(mulberry32(1));
  const plan = planTown(mulberry32(1), terrain, CITADEL_PLAN);
  const edge = (x: number, z: number): number => Math.max(Math.abs(x), Math.abs(z));

  it('lays its lanes inside the walls, joined to the town outside', () => {
    // The lanes inside are only joined to the rest through the gates. When a
    // gate road ran beside the lane through a gate, the lane was dropped as a
    // parallel street, the inside became a separate piece, and the whole
    // walled city was thrown away as not connected to anything.
    const inside = plan.roads.edges.filter((e) => {
      const a = plan.roads.nodes[e.a];
      const b = plan.roads.nodes[e.b];
      return a && b && edge((a.x + b.x) / 2, (a.z + b.z) / 2) < CITADEL.wallHalfM - 10;
    });
    expect(inside.length).toBeGreaterThan(100);
    expect(reached(plan.roads)).toBe(plan.roads.nodes.length);
  });

  it('crosses the wall only at the gates', () => {
    const gateM = CITADEL.gateWidthM / 2 + 1;
    for (const e of plan.roads.edges) {
      const a = plan.roads.nodes[e.a];
      const b = plan.roads.nodes[e.b];
      if (!a || !b) continue;
      const inA = edge(a.x, a.z) < CITADEL.wallHalfM;
      const inB = edge(b.x, b.z) < CITADEL.wallHalfM;
      if (inA === inB) continue;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      expect(Math.min(Math.abs(mx), Math.abs(mz))).toBeLessThan(gateM);
    }
  });
});

describe('a town round a market square', () => {
  const terrain = buildTerrain(mulberry32(1));
  // Wyrmrest's wall stands at 0.54 of the settlement (eras/myth.ts MYTH.wallShare).
  const plan = planTown(mulberry32(1), terrain, mythPlan(terrain.cityRadiusM * 0.54));

  it('keeps a few greens open between its rings, and no lane crosses one', () => {
    // A radial town has no blocks to leave empty, so without these it had
    // no open ground at all.
    const greens = plan.reserves.filter((reserve) => reserve.lot === 'park');
    expect(greens.length).toBeGreaterThanOrEqual(2);
    for (const green of greens) {
      for (const e of plan.roads.edges) {
        const a = plan.roads.nodes[e.a];
        const b = plan.roads.nodes[e.b];
        if (!a || !b) continue;
        expect(segmentRectDistance(a.x, a.z, b.x, b.z, green)).toBeGreaterThan(e.widthM / 2);
      }
    }
  });
});

describe('planarize', () => {
  it('joins two crossing streets at one junction', () => {
    const { points, edges } = planarize([piece(-50, 0, 50, 0), piece(0, -50, 0, 50)]);
    expect(edges).toHaveLength(4);
    const middle = points.findIndex((p) => Math.hypot(p.x, p.z) < 1e-6);
    expect(middle).toBeGreaterThanOrEqual(0);
    expect(edges.filter((e) => e.a === middle || e.b === middle)).toHaveLength(4);
  });

  it('joins a street that stops just short of another', () => {
    // A T: the stem ends a metre shy of the bar, inside the snap distance.
    const gap = PLAN.snapM * 0.8;
    const { points, edges } = planarize([piece(-50, 0, 50, 0), piece(0, 60, 0, gap)]);
    expect(edges).toHaveLength(3);
    const junction = points.findIndex((p) => Math.hypot(p.x, p.z) < gap + 1e-6);
    expect(edges.filter((e) => e.a === junction || e.b === junction)).toHaveLength(3);
  });

  it('keeps one road where two are drawn over each other, the higher rank', () => {
    const low = piece(0, 0, 100, 0, 1);
    const high = { ...piece(0, 0, 100, 0, 3), kind: 'avenue' as const, widthM: 14 };
    const { edges } = planarize([low, high]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('avenue');
  });

  it('leaves two streets that miss each other apart', () => {
    const { points, edges } = planarize([piece(0, 0, 100, 0), piece(0, 20, 100, 20)]);
    expect(points).toHaveLength(4);
    expect(edges).toHaveLength(2);
  });
});
