/**
 * The road network as a graph, and the searches people and vehicles make on
 * it. Pure module, no three.js, so the pathfinding can be tested without a GPU
 * (AGENTS.md 3).
 *
 * The network itself is laid out by the town planner (world/plan.ts), which
 * hands over a graph that is always fully connected: anything the water cut
 * off is dropped. What lives here is what every era's graph shares: its
 * shape, the runs of street between junctions, how much room a junction
 * takes, the bridges, and A*.
 */
export const ROADS = {
  /** How far a road must stay from open water. */
  bankMarginM: 8,
  maxBridges: 2,
  bridgeSpanM: 150,
  /** Keep bridges apart instead of bunching them at the narrowest point. */
  bridgeSpacingM: 450,
} as const;

export type RoadKind = 'street' | 'avenue' | 'ring';

/**
 * How far the pavement reaches past the kerb, in metres. It is drawn as one
 * wider quad under the road (road-mesh.ts), and lots stand behind it.
 */
export const PAVEMENT_M = 2.2;

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

/** How many roads meet at a node: 1 is a dead end, 2 a bend in one road. */
export function degreeOf(graph: RoadGraph, node: number): number {
  return graph.adjacency[node]?.length ?? 0;
}

/**
 * How far along an edge, from the end at `node`, it takes to get clear of
 * the other roads that meet there: each one's half width plus `padM`, over
 * the sine of the angle it meets this one at. A side street joining at
 * thirty degrees takes twice the room of one joining square on, and the old
 * square junction patches got that wrong for every road off the grid.
 *
 * A road that carries straight on through the junction is the same road and
 * is skipped, and a bend in one road (two edges) or a dead end needs nothing.
 */
export function junctionClearM(graph: RoadGraph, edgeIndex: number, node: number, padM = 0): number {
  const touching = graph.adjacency[node] ?? [];
  if (touching.length < 3) return 0;
  const edge = graph.edges[edgeIndex];
  const here = graph.nodes[node];
  if (!edge || !here) return 0;
  const far = graph.nodes[edge.a === node ? edge.b : edge.a];
  if (!far) return 0;
  const length = Math.hypot(far.x - here.x, far.z - here.z) || 1;
  const dx = (far.x - here.x) / length;
  const dz = (far.z - here.z) / length;
  let clear = 0;
  for (const index of touching) {
    if (index === edgeIndex) continue;
    const other = graph.edges[index];
    if (!other) continue;
    const end = graph.nodes[other.a === node ? other.b : other.a];
    if (!end) continue;
    const otherLength = Math.hypot(end.x - here.x, end.z - here.z) || 1;
    const sin = Math.abs((dx * (end.z - here.z) - dz * (end.x - here.x)) / otherLength);
    if (sin < 0.26) continue;
    clear = Math.max(clear, (other.widthM / 2 + padM) / sin);
  }
  return clear;
}

/**
 * The roads as runs from junction to junction: each run is the edges of one
 * street between two places where it meets another, in order, joined at the
 * bends. A planned street is cut into short straight pieces wherever it
 * curves, and anything decided per street (is it planted, with what, does
 * anyone park on it) has to be decided per run, or a curving street changes
 * its trees at every bend.
 */
export function roadChains(graph: RoadGraph): number[][] {
  const used = new Uint8Array(graph.edges.length);
  const chains: number[][] = [];
  for (let e = 0; e < graph.edges.length; e++) {
    if (used[e]) continue;
    const first = graph.edges[e];
    if (!first) continue;
    used[e] = 1;
    const chain = [e];
    for (const end of [first.a, first.b]) {
      let node = end;
      let current = e;
      while (degreeOf(graph, node) === 2) {
        const next = (graph.adjacency[node] ?? []).find((i) => i !== current);
        if (next === undefined || used[next]) break;
        used[next] = 1;
        if (end === first.a) chain.unshift(next);
        else chain.push(next);
        const edge = graph.edges[next];
        if (!edge) break;
        node = edge.a === node ? edge.b : edge.a;
        current = next;
      }
    }
    chains.push(chain);
  }
  return chains;
}

/** One edge of a run, with the node it is walked from and the node it is walked to. */
export interface ChainStep {
  edge: number;
  from: number;
  to: number;
}

/** Walks a run from one end to the other, so "the left side" means one side all the way along. */
export function walkChain(graph: RoadGraph, chain: readonly number[]): ChainStep[] {
  const steps: ChainStep[] = [];
  const first = graph.edges[chain[0] ?? -1];
  if (!first) return steps;
  const second = graph.edges[chain[1] ?? -1];
  let from = second && (first.a === second.a || first.a === second.b) ? first.b : first.a;
  for (const index of chain) {
    const edge = graph.edges[index];
    if (!edge) break;
    const to = edge.a === from ? edge.b : edge.a;
    steps.push({ edge: index, from, to });
    from = to;
  }
  return steps;
}

/**
 * How much of an edge's end to leave clear of anything placed along it: past
 * the other roads at a junction, a little at a dead end, nothing at a bend.
 */
export function endClearM(graph: RoadGraph, edgeIndex: number, node: number, minimumM: number, padM: number): number {
  const degree = degreeOf(graph, node);
  if (degree >= 3) return Math.max(minimumM, junctionClearM(graph, edgeIndex, node, padM));
  return degree === 1 ? minimumM * 0.5 : 0;
}

/** Cell size of the road-node lookup grid, in metres. */
export const NODE_INDEX_CELL_M = 150;

export interface NodeIndex {
  /** The nearest road node to a point, or -1 if the graph is empty. */
  nearest: (x: number, z: number) => number;
}

/**
 * A grid over the road nodes. `nearestNode` scans the whole graph, which is
 * fine once but not once per lot: the citadel has five thousand lots and a
 * thousand nodes, and the full scan costs 26 ms of a single frame.
 */
export function buildNodeIndex(graph: RoadGraph, cellM: number = NODE_INDEX_CELL_M): NodeIndex {
  const buckets = new Map<string, number[]>();
  /** The cells the graph actually occupies, or null for an empty graph. */
  let bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  for (const node of graph.nodes) {
    const cx = Math.floor(node.x / cellM);
    const cz = Math.floor(node.z / cellM);
    const key = `${cx},${cz}`;
    const list = buckets.get(key);
    if (list) list.push(node.id);
    else buckets.set(key, [node.id]);
    if (!bounds) bounds = { minX: cx, maxX: cx, minZ: cz, maxZ: cz };
    else {
      if (cx < bounds.minX) bounds.minX = cx;
      if (cx > bounds.maxX) bounds.maxX = cx;
      if (cz < bounds.minZ) bounds.minZ = cz;
      if (cz > bounds.maxZ) bounds.maxZ = cz;
    }
  }
  const box = bounds;

  return {
    nearest: (x, z) => {
      // Empty graph: nothing to find, and no reason to sweep for it. See the
      // same guard in lots.ts for what the unbounded version cost.
      if (!box) return -1;
      const cx = Math.floor(x / cellM);
      const cz = Math.floor(z / cellM);
      const maxRing = Math.max(
        Math.abs(cx - box.minX),
        Math.abs(cx - box.maxX),
        Math.abs(cz - box.minZ),
        Math.abs(cz - box.maxZ),
      );
      let best = -1;
      let bestDistance = Infinity;
      for (let ring = 0; ring <= maxRing; ring++) {
        // Nothing in this ring or beyond can be nearer than its inner edge, so
        // once that edge is further than the best so far, the search is done.
        // Stopping one ring after the first hit is wrong: from outside the
        // city the first hit can be fifteen rings out and the true nearest
        // several rings further still.
        if (ring > 1 && ((ring - 1) * cellM) ** 2 > bestDistance) break;
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const list = buckets.get(`${cx + dx},${cz + dz}`);
            if (!list) continue;
            for (const id of list) {
              const node = graph.nodes[id];
              if (!node) continue;
              const distance = (node.x - x) ** 2 + (node.z - z) ** 2;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = id;
              }
            }
          }
        }
      }
      return best;
    },
  };
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
 * Where water splits the network, pick a few short crossings between the two
 * largest pieces, spread along the bank rather than bunched together.
 */
export function planBridges(points: readonly Point[], edges: readonly DraftEdge[]): Point2Pair[] {
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

export interface Point2Pair {
  a: number;
  b: number;
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
