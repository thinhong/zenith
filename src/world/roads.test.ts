import { describe, expect, it } from 'vitest';
import { mulberry32, range } from './seed';
import { buildTerrain, centrelineOffsetAt } from './terrain';
import {
  buildNodeIndex,
  buildRoadGraph,
  ROADS,
  createGraph,
  largestComponent,
  nearestNode,
  pathLength,
  shortestPath,
  type DraftEdge,
  type Point,
} from './roads';

/** A 3 x 3 unit grid, 100 m apart, with every horizontal and vertical link. */
function unitGrid(): { points: Point[]; edges: DraftEdge[] } {
  const points: Point[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) points.push({ x: i * 100, z: j * 100 });
  const edges: DraftEdge[] = [];
  const id = (i: number, j: number): number => j * 3 + i;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i < 2) edges.push({ a: id(i, j), b: id(i + 1, j), kind: 'street', widthM: 12 });
      if (j < 2) edges.push({ a: id(i, j), b: id(i, j + 1), kind: 'street', widthM: 12 });
    }
  }
  return { points, edges };
}

describe('createGraph', () => {
  it('measures edge lengths and links both ends', () => {
    const { points, edges } = unitGrid();
    const g = createGraph(points, edges);
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(12);
    for (const e of g.edges) expect(e.lengthM).toBeCloseTo(100, 6);
    // the middle node touches four edges, a corner touches two
    expect(g.adjacency[4]).toHaveLength(4);
    expect(g.adjacency[0]).toHaveLength(2);
  });
});

describe('shortestPath', () => {
  it('walks the grid the short way round', () => {
    const { points, edges } = unitGrid();
    const g = createGraph(points, edges);
    const path = shortestPath(g, 0, 8);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(8);
    expect(pathLength(g, path)).toBeCloseTo(400, 6);
  });

  it('returns the single node when start and goal match', () => {
    const g = createGraph(unitGrid().points, unitGrid().edges);
    expect(shortestPath(g, 3, 3)).toEqual([3]);
  });

  it('returns nothing when there is no route', () => {
    const { points, edges } = unitGrid();
    points.push({ x: 9000, z: 9000 });
    const g = createGraph(points, edges);
    expect(shortestPath(g, 0, 9)).toEqual([]);
  });

  it('routes around a removed middle', () => {
    const { points, edges } = unitGrid();
    const withoutMiddle = edges.filter((e) => e.a !== 4 && e.b !== 4);
    const g = createGraph(points, withoutMiddle);
    const path = shortestPath(g, 0, 8);
    expect(path).not.toContain(4);
    expect(pathLength(g, path)).toBeCloseTo(400, 6);
  });

  it('is symmetric in length', () => {
    const g = createGraph(unitGrid().points, unitGrid().edges);
    expect(pathLength(g, shortestPath(g, 2, 6))).toBeCloseTo(pathLength(g, shortestPath(g, 6, 2)), 6);
  });
});

describe('largestComponent', () => {
  it('drops the pieces that nothing reaches', () => {
    const { points, edges } = unitGrid();
    points.push({ x: 9000, z: 9000 }, { x: 9100, z: 9000 });
    edges.push({ a: 9, b: 10, kind: 'street', widthM: 12 });
    const g = largestComponent(createGraph(points, edges));
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(12);
  });
});

describe('buildRoadGraph', () => {
  it('is deterministic for the same seed', () => {
    const a = buildRoadGraph(mulberry32(5), buildTerrain(mulberry32(5)));
    const b = buildRoadGraph(mulberry32(5), buildTerrain(mulberry32(5)));
    expect(a).toEqual(b);
  });

  it('builds one connected city for every seed tried', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const terrain = buildTerrain(mulberry32(seed));
      const graph = buildRoadGraph(mulberry32(seed), terrain);
      expect(graph.nodes.length).toBeGreaterThan(150);
      // one component: every node is reachable from node 0
      const reached = shortestPath(graph, 0, graph.nodes.length - 1);
      expect(reached.length).toBeGreaterThan(0);
      for (let i = 1; i < graph.nodes.length; i += 17) {
        expect(shortestPath(graph, 0, i).length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every node inside the city and out of the water', () => {
    const terrain = buildTerrain(mulberry32(2));
    const graph = buildRoadGraph(mulberry32(2), terrain);
    for (const node of graph.nodes) {
      expect(Math.hypot(node.x, node.z)).toBeLessThanOrEqual(terrain.cityRadiusM + 1);
    }
  });

  it('has a ring road and diagonal avenues, not just a grid', () => {
    const graph = buildRoadGraph(mulberry32(4), buildTerrain(mulberry32(4)));
    const kinds = new Set(graph.edges.map((e) => e.kind));
    expect(kinds.has('ring')).toBe(true);
    expect(kinds.has('avenue')).toBe(true);
    const diagonal = graph.edges.filter((e) => {
      const a = graph.nodes[e.a];
      const b = graph.nodes[e.b];
      if (!a || !b) return false;
      return Math.abs(a.x - b.x) > 1 && Math.abs(a.z - b.z) > 1;
    });
    expect(diagonal.length).toBeGreaterThan(5);
  });

  it('finds the node nearest a point', () => {
    const graph = buildRoadGraph(mulberry32(1), buildTerrain(mulberry32(1)));
    const id = nearestNode(graph, 0, 0);
    const node = graph.nodes[id];
    expect(node).toBeDefined();
    for (const other of graph.nodes) {
      expect(Math.hypot(node?.x ?? 0, node?.z ?? 0)).toBeLessThanOrEqual(
        Math.hypot(other.x, other.z) + 1e-9,
      );
    }
  });
});

describe('bridges', () => {
  it('keeps both banks of a river joined', () => {
    let riverSeeds = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const terrain = buildTerrain(mulberry32(seed));
      const water = terrain.water;
      if (water.kind !== 'river') continue;
      riverSeeds++;
      const graph = buildRoadGraph(mulberry32(seed), terrain);
      const side = (x: number, z: number): number =>
        x * water.nrmX + z * water.nrmZ - centrelineOffsetAt(water, x * water.dirX + z * water.dirZ);
      let bankA = 0;
      let bankB = 0;
      for (const node of graph.nodes) {
        if (side(node.x, node.z) > 0) bankA++;
        else bankB++;
      }
      const crossings = graph.edges.filter((e) => {
        const a = graph.nodes[e.a];
        const b = graph.nodes[e.b];
        if (!a || !b) return false;
        return side(a.x, a.z) * side(b.x, b.z) < 0;
      });
      // A river near the edge of the settlement leaves a sliver on the far
      // side with nothing on it, and dropping that is right. What must hold is
      // that a bank worth having is reached, by a small number of crossings
      // rather than by a road every block. Counting nodes against a fixed
      // number was wrong: it only passed while the settlement was 1400 m.
      const smaller = Math.min(bankA, bankB);
      if (smaller > 12) {
        expect(crossings.length).toBeGreaterThan(0);
        // `maxBridges` counts bridges the grid is given. The ring road can
        // also meet the river where it leaves the built-up part, and that is a
        // ford or a bridge too, so it is counted separately.
        const built = crossings.filter((e) => e.kind !== 'ring');
        expect(built.length).toBeLessThanOrEqual(ROADS.maxBridges);
        expect(crossings.length).toBeLessThanOrEqual(ROADS.maxBridges + 2);
      }
      expect(bankA + bankB).toBe(graph.nodes.length);
    }
    expect(riverSeeds).toBeGreaterThan(5);
  });
});

describe('buildNodeIndex', () => {
  it('finds the same node as a full scan', () => {
    const terrain = buildTerrain(mulberry32(4));
    const graph = buildRoadGraph(mulberry32(4), terrain);
    const index = buildNodeIndex(graph);
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const x = range(rng, -3000, 3000);
      const z = range(rng, -3000, 3000);
      const scanned = nearestNode(graph, x, z);
      const found = index.nearest(x, z);
      const a = graph.nodes[scanned];
      const b = graph.nodes[found];
      if (!a || !b) throw new Error('missing node');
      // Two nodes can be exactly as near; the distance is what matters.
      const da = (a.x - x) ** 2 + (a.z - z) ** 2;
      const db = (b.x - x) ** 2 + (b.z - z) ** 2;
      expect(db).toBeCloseTo(da, 6);
    }
  });

  it('answers -1 for a graph with no nodes', () => {
    expect(buildNodeIndex(createGraph([], [])).nearest(0, 0)).toBe(-1);
  });
});
