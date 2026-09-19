import { range, type Rng } from '@/world/seed';
import { isBuildable, waterDepthAt, type TerrainSpec } from '@/world/terrain';

/**
 * The road network: a grid with a ring road, a few diagonal avenues and a
 * bridge or two where water splits the city. Pure module, no three.js, so the
 * layout and the pathfinding can be tested without a GPU (AGENTS.md 3).
 *
 * The graph is also what M2 walks people and vehicles along, so it is always
 * returned fully connected: anything the water cut off is dropped.
 */
export const ROADS = {
  pitchM: 100,
  streetWidthM: 12,
  avenueWidthM: 18,
  ringWidthM: 20,
  /** How far a road must stay from open water. */
  bankMarginM: 10,
  ringNodes: 44,
  /** A ring node joins the grid if a grid node is this close. */
  ringSpurM: 160,
  avenueCount: 3,
  /** How far an avenue may sit off the centre of the city. */
  avenueOffsetM: 300,
  maxBridges: 3,
  bridgeSpanM: 360,
  /** Keep bridges apart instead of bunching them at the narrowest point. */
  bridgeSpacingM: 450,
} as const;

export type RoadKind = 'street' | 'avenue' | 'ring';

export interface RoadNode {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export interface RoadEdge {
  readonly a: number;
  readonly b: number;
  readonly kind: RoadKind;
  readonly widthM: number;
  readonly lengthM: number;
}

export interface RoadGraph {
  readonly nodes: readonly RoadNode[];
  readonly edges: readonly RoadEdge[];
  /** Node id to the indices of the edges that touch it. */
  readonly adjacency: ReadonlyArray<readonly number[]>;
}

export interface DraftEdge {
  a: number;
  b: number;
  kind: RoadKind;
  widthM: number;
}

export interface Point {
  x: number;
  z: number;
}

const TAU = Math.PI * 2;

export function buildRoadGraph(rng: Rng, terrain: TerrainSpec): RoadGraph {
  const points: Point[] = [];
  const edges: DraftEdge[] = [];
  const edgeByKey = new Map<string, number>();

  const addNode = (x: number, z: number): number => {
    points.push({ x, z });
    return points.length - 1;
  };

  const addEdge = (a: number, b: number, kind: RoadKind, widthM: number): void => {
    if (a === b || a < 0 || b < 0) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edgeByKey.get(key);
    if (existing !== undefined) {
      // An avenue that lands on a street widens that street instead of
      // stacking a second road on top of it.
      const e = edges[existing];
      if (e && widthM > e.widthM) {
        e.kind = kind;
        e.widthM = widthM;
      }
      return;
    }
    edgeByKey.set(key, edges.length);
    edges.push({ a, b, kind, widthM });
  };

  // --- the grid ---------------------------------------------------------
  const gridId = new Map<string, number>();
  const half = Math.floor(terrain.cityRadiusM / ROADS.pitchM);
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const x = i * ROADS.pitchM;
      const z = j * ROADS.pitchM;
      if (!isBuildable(terrain, x, z, ROADS.bankMarginM)) continue;
      gridId.set(`${i},${j}`, addNode(x, z));
    }
  }
  const gridCount = points.length;

  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const a = gridId.get(`${i},${j}`);
      if (a === undefined) continue;
      const right = gridId.get(`${i + 1},${j}`);
      const down = gridId.get(`${i},${j + 1}`);
      if (right !== undefined) addEdge(a, right, 'street', ROADS.streetWidthM);
      if (down !== undefined) addEdge(a, down, 'street', ROADS.streetWidthM);
    }
  }

  // --- the ring road ----------------------------------------------------
  const ringIds: (number | null)[] = [];
  for (let k = 0; k < ROADS.ringNodes; k++) {
    const a = (k / ROADS.ringNodes) * TAU;
    const x = Math.cos(a) * terrain.cityRadiusM;
    const z = Math.sin(a) * terrain.cityRadiusM;
    const wet = waterDepthAt(terrain.water, x, z) > -ROADS.bankMarginM;
    ringIds.push(wet ? null : addNode(x, z));
  }
  for (let k = 0; k < ringIds.length; k++) {
    const a = ringIds[k];
    const b = ringIds[(k + 1) % ringIds.length];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    addEdge(a, b, 'ring', ROADS.ringWidthM);
  }
  for (const id of ringIds) {
    if (id === null || id === undefined) continue;
    const p = points[id];
    if (!p) continue;
    const near = nearestPoint(points, gridCount, p.x, p.z);
    const q = near >= 0 ? points[near] : undefined;
    if (q && Math.hypot(q.x - p.x, q.z - p.z) <= ROADS.ringSpurM) {
      addEdge(id, near, 'street', ROADS.streetWidthM);
    }
  }

  // --- diagonal avenues -------------------------------------------------
  for (let k = 0; k < ROADS.avenueCount; k++) {
    // Angles well away from the grid axes, or an avenue is just a wider street.
    const base = range(rng, 0.45, 1.12);
    const angle = k % 2 === 0 ? base : Math.PI - base;
    const offsetM = range(rng, -ROADS.avenueOffsetM, ROADS.avenueOffsetM);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const step = ROADS.pitchM * 1.45;
    let previous = -1;
    for (let t = -terrain.cityRadiusM; t <= terrain.cityRadiusM; t += step) {
      const x = dx * t - dz * offsetM;
      const z = dz * t + dx * offsetM;
      const id = nearestPoint(points, gridCount, x, z);
      const p = id >= 0 ? points[id] : undefined;
      if (!p || Math.hypot(p.x - x, p.z - z) > ROADS.pitchM) {
        // No grid node here (water, or outside the city): start a new run.
        previous = -1;
        continue;
      }
      const q = previous >= 0 ? points[previous] : undefined;
      if (q && previous !== id && Math.hypot(p.x - q.x, p.z - q.z) <= step * 1.4) {
        addEdge(previous, id, 'avenue', ROADS.avenueWidthM);
      }
      previous = id;
    }
  }

  // --- bridges ----------------------------------------------------------
  for (const bridge of planBridges(points, edges)) {
    addEdge(bridge.a, bridge.b, 'street', ROADS.streetWidthM);
  }

  return largestComponent(createGraph(points, edges));
}

/** Lengths and adjacency from plain points and edges. Does not drop anything. */
export function createGraph(points: readonly Point[], edges: readonly DraftEdge[]): RoadGraph {
  const nodes: RoadNode[] = points.map((p, id) => ({ id, x: p.x, z: p.z }));
  const out: RoadEdge[] = [];
  const adjacency: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (!a || !b || e.a === e.b) continue;
    const index = out.length;
    out.push({
      a: e.a,
      b: e.b,
      kind: e.kind,
      widthM: e.widthM,
      lengthM: Math.hypot(b.x - a.x, b.z - a.z),
    });
    adjacency[e.a]?.push(index);
    adjacency[e.b]?.push(index);
  }
  return { nodes, edges: out, adjacency };
}

/** Keeps only the biggest connected piece and renumbers it from zero. */
export function largestComponent(graph: RoadGraph): RoadGraph {
  const labels = componentLabels(graph);
  const counts = new Map<number, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  let keep = -1;
  let best = -1;
  for (const [label, count] of counts) {
    if (count > best) {
      best = count;
      keep = label;
    }
  }

  const remap = new Int32Array(graph.nodes.length).fill(-1);
  const points: Point[] = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    if (!node || labels[i] !== keep) continue;
    remap[i] = points.length;
    points.push({ x: node.x, z: node.z });
  }
  const edges: DraftEdge[] = [];
  for (const e of graph.edges) {
    const a = remap[e.a] ?? -1;
    const b = remap[e.b] ?? -1;
    if (a < 0 || b < 0) continue;
    edges.push({ a, b, kind: e.kind, widthM: e.widthM });
  }
  return createGraph(points, edges);
}

export function nearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (const node of graph.nodes) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = node.id;
    }
  }
  return best;
}

/**
 * A* over the road graph. Returns node ids from `start` to `goal`, or an empty
 * array if there is no route. Edge cost is length in metres.
 */
export function shortestPath(graph: RoadGraph, start: number, goal: number): number[] {
  const count = graph.nodes.length;
  if (start < 0 || goal < 0 || start >= count || goal >= count) return [];
  if (start === goal) return [start];

  const gScore = new Float64Array(count).fill(Infinity);
  const cameFrom = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const open = createHeap();

  gScore[start] = 0;
  open.push(start, straightLine(graph, start, goal));

  while (open.size() > 0) {
    const current = open.pop();
    if (current < 0) break;
    if (current === goal) return reconstruct(cameFrom, start, goal);
    if (closed[current] === 1) continue;
    closed[current] = 1;

    for (const index of graph.adjacency[current] ?? []) {
      const edge = graph.edges[index];
      if (!edge) continue;
      const next = edge.a === current ? edge.b : edge.a;
      if (closed[next] === 1) continue;
      const tentative = (gScore[current] ?? Infinity) + edge.lengthM;
      if (tentative < (gScore[next] ?? Infinity)) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        open.push(next, tentative + straightLine(graph, next, goal));
      }
    }
  }
  return [];
}

/** Total length of a node path in metres. 0 for a path of fewer than two nodes. */
export function pathLength(graph: RoadGraph, path: readonly number[]): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = graph.nodes[path[i] ?? -1];
    const b = graph.nodes[path[i + 1] ?? -1];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

function componentLabels(graph: RoadGraph): Int32Array {
  const labels = new Int32Array(graph.nodes.length).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let seed = 0; seed < graph.nodes.length; seed++) {
    if (labels[seed] !== -1) continue;
    const label = next++;
    labels[seed] = label;
    stack.length = 0;
    stack.push(seed);
    while (stack.length > 0) {
      const current = stack.pop() ?? -1;
      if (current < 0) break;
      for (const index of graph.adjacency[current] ?? []) {
        const edge = graph.edges[index];
        if (!edge) continue;
        const other = edge.a === current ? edge.b : edge.a;
        if (labels[other] !== -1) continue;
        labels[other] = label;
        stack.push(other);
      }
    }
  }
  return labels;
}

/**
 * Where water splits the grid, pick a few short crossings between the two
 * largest pieces, spread along the bank rather than bunched together.
 */
function planBridges(points: readonly Point[], edges: readonly DraftEdge[]): Point2Pair[] {
  const graph = createGraph(points, edges);
  const labels = componentLabels(graph);
  const members = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? -1;
    const list = members.get(label);
    if (list) list.push(i);
    else members.set(label, [i]);
  }
  const groups = [...members.values()].sort((a, b) => b.length - a.length);
  const main = groups[0];
  const other = groups[1];
  if (!main || !other) return [];

  const candidates: { a: number; b: number; distance: number }[] = [];
  for (const a of main) {
    const pa = points[a];
    if (!pa) continue;
    for (const b of other) {
      const pb = points[b];
      if (!pb) continue;
      const distance = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      if (distance <= ROADS.bridgeSpanM) candidates.push({ a, b, distance });
    }
  }
  candidates.sort((x, y) => x.distance - y.distance);

  const accepted: Point2Pair[] = [];
  const midpoints: Point[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= ROADS.maxBridges) break;
    const pa = points[candidate.a];
    const pb = points[candidate.b];
    if (!pa || !pb) continue;
    const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
    if (midpoints.some((m) => Math.hypot(m.x - mid.x, m.z - mid.z) < ROADS.bridgeSpacingM)) continue;
    midpoints.push(mid);
    accepted.push({ a: candidate.a, b: candidate.b });
  }
  return accepted;
}

interface Point2Pair {
  a: number;
  b: number;
}

/** Nearest of the first `limit` points. Used to snap avenues onto the grid. */
function nearestPoint(points: readonly Point[], limit: number, x: number, z: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < limit; i++) {
    const p = points[i];
    if (!p) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

function straightLine(graph: RoadGraph, from: number, to: number): number {
  const a = graph.nodes[from];
  const b = graph.nodes[to];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function reconstruct(cameFrom: Int32Array, start: number, goal: number): number[] {
  const path = [goal];
  let current = goal;
  while (current !== start) {
    const previous = cameFrom[current] ?? -1;
    if (previous < 0) return [];
    path.push(previous);
    current = previous;
  }
  return path.reverse();
}

interface MinHeap {
  push: (node: number, key: number) => void;
  pop: () => number;
  size: () => number;
}

function createHeap(): MinHeap {
  const nodes: number[] = [];
  const keys: number[] = [];

  const swap = (i: number, j: number): void => {
    const n = nodes[i] ?? 0;
    const k = keys[i] ?? 0;
    nodes[i] = nodes[j] ?? 0;
    keys[i] = keys[j] ?? 0;
    nodes[j] = n;
    keys[j] = k;
  };

  return {
    size: () => nodes.length,
    push: (node, key) => {
      nodes.push(node);
      keys.push(key);
      let i = nodes.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if ((keys[parent] ?? Infinity) <= (keys[i] ?? Infinity)) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop: () => {
      if (nodes.length === 0) return -1;
      const top = nodes[0] ?? -1;
      const lastNode = nodes.pop() ?? 0;
      const lastKey = keys.pop() ?? 0;
      if (nodes.length > 0) {
        nodes[0] = lastNode;
        keys[0] = lastKey;
        let i = 0;
        for (;;) {
          const left = i * 2 + 1;
          const right = left + 1;
          let smallest = i;
          if (left < nodes.length && (keys[left] ?? Infinity) < (keys[smallest] ?? Infinity)) smallest = left;
          if (right < nodes.length && (keys[right] ?? Infinity) < (keys[smallest] ?? Infinity)) smallest = right;
          if (smallest === i) break;
          swap(i, smallest);
          i = smallest;
        }
      }
      return top;
    },
  };
}
