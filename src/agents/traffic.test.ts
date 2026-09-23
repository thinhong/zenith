import { describe, expect, it } from 'vitest';
import { pickNextEdge, trafficLoad } from './traffic';
import { MODERN_PLAN } from '@/world/eras/modern';
import { planTown } from '@/world/plan';
import { createGraph, type DraftEdge, type Point } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

describe('trafficLoad', () => {
  it('stays inside 0..1 at every hour', () => {
    for (let h = 0; h <= 24; h += 0.25) {
      const load = trafficLoad(h);
      expect(load).toBeGreaterThan(0);
      expect(load).toBeLessThanOrEqual(1);
    }
  });

  it('peaks at the two rush hours and empties overnight', () => {
    expect(trafficLoad(8.5)).toBeGreaterThan(trafficLoad(12));
    expect(trafficLoad(18.5)).toBeGreaterThan(trafficLoad(12));
    expect(trafficLoad(3)).toBeLessThan(trafficLoad(12) / 2);
  });

  it('is continuous across midnight', () => {
    expect(Math.abs(trafficLoad(23.99) - trafficLoad(0.01))).toBeLessThan(0.02);
  });
});

describe('pickNextEdge', () => {
  /** A cross: node 0 in the middle, four spokes. */
  const points: Point[] = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: -100, z: 0 },
    { x: 0, z: 100 },
    { x: 0, z: -100 },
  ];
  const edges: DraftEdge[] = [
    { a: 0, b: 1, kind: 'street', widthM: 12 },
    { a: 0, b: 2, kind: 'street', widthM: 12 },
    { a: 0, b: 3, kind: 'street', widthM: 12 },
    { a: 0, b: 4, kind: 'street', widthM: 12 },
  ];
  const graph = createGraph(points, edges);

  it('never turns back the way it came when there is another way', () => {
    for (let r = 0; r < 1; r += 0.05) {
      expect(pickNextEdge(graph, 0, 0, r)).not.toBe(0);
    }
  });

  it('uses every other spoke across the range of rolls', () => {
    const seen = new Set<number>();
    for (let r = 0; r < 1; r += 0.01) seen.add(pickNextEdge(graph, 0, 0, r));
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('turns round at a dead end', () => {
    // node 1 only touches edge 0
    expect(pickNextEdge(graph, 1, 0, 0.5)).toBe(0);
  });

  it('always returns an edge that touches the node it is leaving', () => {
    const city = planTown(mulberry32(3), buildTerrain(mulberry32(3)), MODERN_PLAN).roads;
    for (let node = 0; node < city.nodes.length; node += 13) {
      const from = (city.adjacency[node] ?? [])[0] ?? -1;
      if (from < 0) continue;
      for (const roll of [0, 0.33, 0.66, 0.99]) {
        const next = pickNextEdge(city, node, from, roll);
        const edge = city.edges[next];
        expect(edge).toBeDefined();
        expect(edge?.a === node || edge?.b === node).toBe(true);
      }
    }
  });
});
