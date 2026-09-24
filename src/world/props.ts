import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Material, MeshBasicMaterial, type BufferGeometry } from 'three';
import { uniform } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { cloudShadow } from '@/world/atmosphere';
import { writeInstanceMatrix } from '@/world/instanced';
import type { Lot } from '@/world/lots';
import { endClearM, PAVEMENT_M, roadChains, walkChain, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { LANDSCAPE } from '@/world/landscape';
import { nearCutMask } from '@/world/near-cut';
import { onParkPlan, parkPlan } from '@/world/parks';
import { toWorld } from '@/world/frame';
import { createGridIndex, distanceToSegment, pointRectDistance, rectBounds } from '@/world/geometry2d';
import { isBuildable, TERRAIN, type TerrainSpec } from '@/world/terrain';
import { createTreeMeshes } from '@/world/tree-mesh';

/**
 * Trees and street lamps: where they go, and the lamps themselves. The trees
 * are drawn by world/tree-mesh.ts, near and far. The lamp heads are unlit
 * material whose colour is driven by the day clock, which is how a lamp
 * "comes on" without a point light (PLAN.md M1 task 6).
 */
export const PROPS = {
  parkSpacingM: 13,
  /** How far a park tree's trunk stands off a path or the middle, in metres. */
  parkPathClearM: 2.2,
  avenueSpacingM: 26,
  /**
   * Gap between the kerb and a boulevard tree. On the pavement: it was 4 m,
   * past the pavement, which was open ground while blocks stood well back
   * from the road and is somebody's shop now that lots are built up to it.
   */
  kerbGapM: 1.2,
  lampSpacingM: 46,
  lampHeightM: 6,
  maxTrees: 16000,
  maxLamps: 900,
  /** Woods on the plain between the ring road and the mountains. */
  countrysideClumps: 130,
  treesPerClump: 7,
  clumpRadiusM: 45,
  /** A slender tree of several stems against a single-trunked one of the same draw. */
  slender: { radius: 1.05, height: 0.66 },
  /** Behind a house with a front garden, the chance of a second tree in the back. */
  backTreeShare: 0.5,
} as const;

const FIXED = { post: 0x3a3a3c, lampOff: 0x4a4740 } as const;

export interface PropPalette {
  canopy: number;
  trunk: number;
  lampOn: number;
  /** Chance that a house or a shop has a tree in its yard. */
  courtyardChance: number;
  /** Multiplies the canopy size. Village trees are wider than street trees. */
  canopyScale: number;
  /** A second, rounder crown shape, and how many trees take it. */
  canopyRound: number;
  roundShare: number;
  /** Shrubs under the trees, as a share of them. */
  bush: number;
  bushesPerTree: number;
  /** Rows of trees along ordinary streets (eras/index.ts). */
  streetTrees: { share: number; spacingM: number };
  /** Street lamps belong to an era that has them. */
  lamps: boolean;
  /** Share of trees that are slender and many-stemmed (eras/index.ts EraPalette). */
  multiStemShare?: number;
  /** Trees out on the meadows, when an era wants other than the usual woods. */
  country?: { clumps: number; perClump: number };
  /** False when the era plants its parks itself. */
  parkGrid?: boolean;
}

/** What an era adds to, and keeps out of, the planting (EraLayout.trees, EraLayout.treeless). */
export interface PropExtras {
  trees?: readonly {
    x: number;
    z: number;
    radiusM: number;
    heightM: number;
    stems: boolean;
    colour?: number;
  }[];
  treeless?: (x: number, z: number) => boolean;
}

export interface Props {
  group: Group;
  /** 1 after dark: the lamps come on. */
  setNight: (night: number) => void;
  /** 0 from satellite height: props are too small to be worth drawing. */
  setDetail: (detail: number) => void;
  /** Where the eye is: the trees near it are drawn in full (world/tree-mesh.ts). */
  setEye: (x: number, y: number, z: number) => void;
  treeCount: number;
  lampCount: number;
}

/** A low round shrub under the trees, which is what fills a hedge line. */
function collectBushes(rng: Rng, trees: readonly Placement[], perTree: number): Placement[] {
  const bushes: Placement[] = [];
  for (const tree of trees) {
    if (rng() >= perTree) continue;
    const angle = range(rng, 0, Math.PI * 2);
    const reach = tree.radiusM * range(rng, 1.1, 2.4);
    bushes.push({
      x: tree.x + Math.cos(angle) * reach,
      y: 0,
      z: tree.z + Math.sin(angle) * reach,
      radiusM: range(rng, 0.7, 1.6),
      heightM: range(rng, 0.9, 1.8),
      rotY: range(rng, 0, Math.PI * 2),
      round: true,
    });
  }
  return bushes;
}

interface Placement {
  /** True if this one takes the rounder crown rather than the cone. */
  round?: boolean;
  /** True for a slender tree of several stems, which takes neither. */
  stems?: boolean;
  /** Its own leaf colour, instead of the era's green. */
  colour?: number;
  /**
   * How far this tree's green is from its era's, as a multiplier. No two
   * trees in a real wood are the same colour, and a whole town of one green
   * reads as plastic.
   */
  tint?: number;
  x: number;
  y: number;
  z: number;
  radiusM: number;
  heightM: number;
  rotY: number;
}

/** Where every tree and lamp goes. Pure, and the slow half of the work. */
export interface PropPlacements {
  trees: readonly Placement[];
  lamps: readonly Placement[];
  bushes: readonly Placement[];
}

/**
 * Chooses the positions. Split from `createProps` so that an era change can
 * run the two halves in separate frames; on its own each fits inside one.
 */
export function collectProps(
  rng: Rng,
  terrain: TerrainSpec,
  graph: RoadGraph,
  lots: readonly Lot[],
  palette: PropPalette,
  extras: PropExtras = {},
): PropPlacements {
  const trees = collectTrees(rng, terrain, graph, lots, palette, extras.treeless);
  for (const tree of extras.trees ?? []) {
    if (trees.length >= PROPS.maxTrees) break;
    const placed: Placement = {
      x: tree.x,
      y: 0,
      z: tree.z,
      radiusM: tree.radiusM,
      heightM: tree.heightM,
      rotY: (tree.x * 0.37 + tree.z * 0.61) % (Math.PI * 2),
      round: true,
      stems: tree.stems,
      tint: 0.9 + (((tree.x * 7.3 + tree.z * 3.1) % 1) + 1) % 1 * 0.2,
    };
    if (tree.colour !== undefined) placed.colour = tree.colour;
    trees.push(placed);
  }
  return {
    trees,
    lamps: palette.lamps ? collectLamps(graph) : [],
    bushes: collectBushes(rng, trees, palette.bushesPerTree),
  };
}

export function createProps(placements: PropPlacements, palette: PropPalette): Props {
  const group = new Group();
  group.name = 'props';

  // Trees and shrubs, near and far (world/tree-mesh.ts, world/tree-geometry.ts).
  const trees = createTreeMeshes(placements.trees, placements.bushes, {
    canopy: palette.canopy,
    canopyRound: palette.canopyRound,
    trunk: palette.trunk,
    bush: palette.bush,
  });
  group.add(trees.group);

  const postGeometry = new CylinderGeometry(1, 1, 1, 3);
  postGeometry.translate(0, 0.5, 0);
  const headGeometry = new BoxGeometry(1, 1, 1);

  const lamps = placements.lamps;
  const headMaterial = new MeshBasicMaterial({ color: new Color(FIXED.lampOff) });
  // An instanced mesh with no instances has no bounding sphere, and three
  // reports that as a NaN radius when the shadow pass comes to cull it.
  if (lamps.length > 0) {
    group.add(
      instanced(postGeometry, lambert(FIXED.post), lamps, 'lamp-posts', () => 0.09, () => PROPS.lampHeightM, () => 0),
    );
    group.add(
      instanced(headGeometry, headMaterial, lamps, 'lamp-heads', () => 0.45, () => 0.35, () => PROPS.lampHeightM),
    );
  }

  const off = new Color(FIXED.lampOff);
  const on = new Color(palette.lampOn);

  return {
    group,
    setNight: (night) => {
      headMaterial.color.lerpColors(off, on, Math.min(1, Math.max(0, night)));
    },
    setDetail: (detail) => {
      // A hard cut: at this altitude a tree is a fraction of a pixel.
      group.visible = detail > 0.02;
    },
    setEye: trees.setEye,
    treeCount: placements.trees.length,
    lampCount: lamps.length,
  };
}

function collectTrees(
  rng: Rng,
  terrain: TerrainSpec,
  graph: RoadGraph,
  lots: readonly Lot[],
  palette: PropPalette,
  treeless?: (x: number, z: number) => boolean,
): Placement[] {
  const trees: Placement[] = [];
  const slenderShare = palette.multiStemShare ?? 0;

  const plant = (x: number, z: number, slender = true): void => {
    if (trees.length >= PROPS.maxTrees) return;
    if (treeless?.(x, z)) return;
    // Drawn in the same order as always, so every other era's trees come out
    // as they did; the stems are drawn last, and only for an era that has any.
    const radiusM = range(rng, 2.2, 4) * palette.canopyScale;
    const heightM = range(rng, 8, 13) * palette.canopyScale;
    const rotY = range(rng, 0, Math.PI * 2);
    const round = rng() < palette.roundShare;
    const tint = range(rng, 0.82, 1.14);
    const stems = slender && slenderShare > 0 && rng() < slenderShare;
    trees.push({
      x,
      y: 0,
      z,
      // A garden tree is lower than a street tree, and its crown is wide for
      // its height: it is several trunks, not one.
      radiusM: stems ? radiusM * PROPS.slender.radius : radiusM,
      heightM: stems ? heightM * PROPS.slender.height : heightM,
      rotY,
      round,
      tint,
      stems,
    });
  };

  // Parks: a loose grid inside the lot, kept off the paths and out of the
  // middle, which is where parks.ts puts the things people walk to.
  for (const lot of lots) {
    if (lot.use !== 'park' || palette.parkGrid === false) continue;
    const plan = parkPlan(lot);
    const rows = Math.max(1, Math.floor(lot.dM / PROPS.parkSpacingM));
    const cols = Math.max(1, Math.floor(lot.wM / PROPS.parkSpacingM));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // A quarter of the grid points are left empty and the rest are pushed
        // well off them, because a park planted on a lattice reads as an
        // orchard, which is what it looked like.
        if (rng() < 0.26) continue;
        // Laid out square to the world round the lot's centre, like the plan,
        // then turned with the lot.
        const x = lot.x - lot.wM / 2 + ((c + 0.5) * lot.wM) / cols + range(rng, -6, 6);
        const z = lot.z - lot.dM / 2 + ((r + 0.5) * lot.dM) / rows + range(rng, -6, 6);
        if (onParkPlan(plan, x, z, PROPS.parkPathClearM)) continue;
        const at = toWorld(lot, x - lot.x, z - lot.z);
        plant(at.x, at.z);
      }
    }
  }

  // A tree in the yard, beside the building rather than on it. Behind it, on a
  // plot that faces a street: in front is the pavement.
  for (const lot of lots) {
    if (lot.use === 'park' || lot.heightM <= 0) continue;
    if (rng() >= palette.courtyardChance) continue;
    // A walled front garden (world/gardens.ts) takes its tree in front, where
    // it is seen over the wall, and off the stones from the gate to the door.
    const garden = lot.garden;
    if (garden && lot.street === true) {
      const count = garden.depthM > 2.4 && lot.wM > 7.5 && rng() < 0.7 ? 2 : 1;
      const first = rng() < 0.5 ? -1 : 1;
      for (let k = 0; k < count; k++) {
        const side = k === 0 ? first : -first;
        const reachM = lot.wM / 2 + garden.sideM - 0.9;
        const localX = side * range(rng, Math.min(1.3, reachM), reachM);
        const localZ = -(lot.dM / 2 + garden.depthM * range(rng, 0.38, 0.62));
        const at = toWorld(lot, localX, localZ);
        plant(at.x, at.z);
      }
      // And often one in the back, over the roof from the street.
      if (rng() < PROPS.backTreeShare) {
        const back = toWorld(lot, range(rng, -lot.wM / 3, lot.wM / 3), lot.dM / 2 + range(rng, 2, 4));
        plant(back.x, back.z);
      }
      continue;
    }
    const side = rng() < 0.5 ? -1 : 1;
    const alongX = lot.street === true ? false : rng() < 0.5;
    const reach = (alongX ? lot.wM : lot.dM) / 2 + range(rng, 2, 5);
    const localX = alongX ? side * reach : range(rng, -lot.wM / 3, lot.wM / 3);
    const localZ = alongX ? range(rng, -lot.dM / 3, lot.dM / 3) : lot.street === true ? reach : side * reach;
    const at = toWorld(lot, localX, localZ);
    plant(at.x, at.z);
  }

  // Boulevards: a row down each side of every avenue and the ring road, on the
  // pavement and clear of the junctions.
  for (const [index, edge] of graph.edges.entries()) {
    if (edge.kind === 'street') continue;
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    const offset = edge.widthM / 2 + PROPS.kerbGapM;
    const first = endClearM(graph, index, edge.a, 6, PAVEMENT_M + 1);
    const last = length - endClearM(graph, index, edge.b, 6, PAVEMENT_M + 1);
    for (let t = first + PROPS.avenueSpacingM / 2; t < last; t += PROPS.avenueSpacingM) {
      for (const side of [-1, 1]) {
        plant(a.x + dx * t - dz * offset * side, a.z + dz * t + dx * offset * side);
      }
    }
  }

  /**
   * Streets: some are planted, some are not, and a planted street is one
   * species, one size, evenly spaced. That regularity is what says a person
   * planted them, and it is what makes a street read as a street from above
   * rather than as a gap between buildings.
   */
  const st = palette.streetTrees;
  for (const chain of roadChains(graph)) {
    const firstEdge = graph.edges[chain[0] ?? -1];
    if (!firstEdge || firstEdge.kind !== 'street' || st.share <= 0) continue;
    // One street, one decision: planted or not, one species, one size,
    // however many pieces a curving street is cut into.
    if (rng() >= st.share) continue;
    const round = rng() < palette.roundShare;
    const stems = slenderShare > 0 && rng() < slenderShare;
    const size = range(rng, 0.72, 0.95);
    let carry = range(rng, 0, st.spacingM * 0.5);
    for (const step of walkChain(graph, chain)) {
      const edge = graph.edges[step.edge];
      const a = graph.nodes[step.from];
      const b = graph.nodes[step.to];
      if (!edge || !a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-6) continue;
      const dx = (b.x - a.x) / length;
      const dz = (b.z - a.z) / length;
      // On the pavement, just off the kerb, where street trees actually stand,
      // and clear of the junctions at both ends, where the crossing street runs.
      const offset = edge.widthM / 2 + 1.3;
      const first = endClearM(graph, step.edge, step.from, edge.widthM / 2 + 5, PAVEMENT_M + 2);
      const last = length - endClearM(graph, step.edge, step.to, edge.widthM / 2 + 5, PAVEMENT_M + 2);
      let t = first + carry;
      for (; t < last; t += st.spacingM) {
        for (const side of [-1, 1]) {
          if (trees.length >= PROPS.maxTrees) break;
          trees.push({
            x: a.x + dx * t - dz * offset * side,
            y: 0,
            z: a.z + dz * t + dx * offset * side,
            // Nearly uniform along one street, with the small differences a
            // row of real trees of one age still has.
            radiusM: 2.6 * size * range(rng, 0.94, 1.06) * palette.canopyScale * (stems ? PROPS.slender.radius : 1),
            heightM: 9 * size * range(rng, 0.94, 1.06) * palette.canopyScale * (stems ? PROPS.slender.height : 1),
            rotY: range(rng, 0, Math.PI * 2),
            round,
            stems,
            tint: range(rng, 0.94, 1.05),
          });
        }
      }
      // The rhythm carries across a bend instead of starting again.
      carry = Math.max(0, t - Math.max(length, last));
    }
  }

  // Woods on the plain, in clumps rather than an even sprinkle. Only on the
  // plain: past it the ground rises into the hills, which have woods of their
  // own (landscape.ts FOREST), and a tree planted at the height of the plain
  // out there stands buried in a hillside.
  //
  // The town's edge is no longer a circle, so where the country starts is read
  // off the lots themselves: in each direction, a little past the furthest
  // building. Country roads and the houses along them are kept clear too.
  const outer = TERRAIN.mountainInnerM * LANDSCAPE.plainShare;
  const edgeAt = townEdge(lots, terrain.cityRadiusM);
  const blocked = builtUp(graph, lots);
  const clumps = palette.country?.clumps ?? PROPS.countrysideClumps;
  const perClump = palette.country?.perClump ?? PROPS.treesPerClump;
  for (let i = 0; i < clumps; i++) {
    const angle = range(rng, 0, Math.PI * 2);
    const inner = edgeAt(angle) + 40;
    if (inner >= outer - 10) continue;
    const radius = range(rng, inner, outer);
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    for (let k = 0; k < perClump; k++) {
      const x = cx + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      const z = cz + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      // isBuildable also rejects the water, which is what matters out here.
      const fromCentreM = Math.hypot(x, z);
      if (fromCentreM < edgeAt(Math.atan2(z, x)) + 20 || fromCentreM > outer) continue;
      if (!isBuildable({ ...terrain, cityRadiusM: outer + PROPS.clumpRadiusM }, x, z, 12)) continue;
      if (blocked(x, z)) continue;
      // Out on the meadow a tree stands in its own round shape, not a garden's.
      plant(x, z, false);
    }
  }

  return trees;
}

/**
 * How far the town reaches in each direction: the furthest lot, by angle.
 * Where nothing is built (the sea side) it falls back to the settlement radius.
 */
function townEdge(lots: readonly Lot[], fallbackM: number): (angle: number) => number {
  const bins = 48;
  const far = new Float64Array(bins);
  for (const lot of lots) {
    const r = Math.hypot(lot.x, lot.z) + Math.max(lot.wM, lot.dM) / 2;
    const bin = Math.floor(((Math.atan2(lot.z, lot.x) / (Math.PI * 2)) + 1) * bins) % bins;
    far[bin] = Math.max(far[bin] ?? 0, r);
  }
  return (angle) => {
    const bin = Math.floor(((angle / (Math.PI * 2)) + 1) * bins) % bins;
    // The widest of this bin and its neighbours, so the edge has no notches.
    let best = 0;
    for (const d of [-1, 0, 1]) best = Math.max(best, far[(bin + d + bins) % bins] ?? 0);
    return best > 0 ? best : fallbackM;
  };
}

/** Whether a tree here would stand on a road or in a building. */
function builtUp(graph: RoadGraph, lots: readonly Lot[]): (x: number, z: number) => boolean {
  const index = createGridIndex(30);
  const count = graph.edges.length;
  graph.edges.forEach((edge, i) => {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) return;
    index.insert(i, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  });
  lots.forEach((lot, i) => {
    const box = rectBounds(lot);
    index.insert(count + i, box.minX, box.minZ, box.maxX, box.maxZ);
  });
  return (x, z) => {
    let hit = false;
    const pad = 12;
    index.query(x - pad, z - pad, x + pad, z + pad, (id) => {
      if (id < count) {
        const edge = graph.edges[id];
        const a = edge ? graph.nodes[edge.a] : undefined;
        const b = edge ? graph.nodes[edge.b] : undefined;
        if (edge && a && b && distanceToSegment(x, z, a.x, a.z, b.x, b.z) < edge.widthM / 2 + PAVEMENT_M + 2) hit = true;
      } else {
        const lot = lots[id - count];
        if (lot && pointRectDistance(x, z, lot) < 3) hit = true;
      }
      if (hit) return true;
    });
    return hit;
  };
}

function collectLamps(graph: RoadGraph): Placement[] {
  const lamps: Placement[] = [];
  for (const edge of graph.edges) {
    if (edge.kind === 'street') continue;
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    const offset = edge.widthM / 2 + 1.6;
    for (let t = PROPS.lampSpacingM / 2; t < length; t += PROPS.lampSpacingM) {
      for (const side of [-1, 1]) {
        if (lamps.length >= PROPS.maxLamps) return lamps;
        lamps.push({
          x: a.x + dx * t - dz * offset * side,
          y: 0,
          z: a.z + dz * t + dx * offset * side,
          radiusM: 1,
          heightM: 1,
          rotY: 0,
        });
      }
    }
  }
  return lamps;
}

/**
 * A flat colour under the cloud shadows. A tree is tall enough and a clump wide
 * enough that leaving them out of the weather shows.
 */
function lambert(color: number, flatShading = false): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();
  material.flatShading = flatShading;
  material.colorNode = uniform(new Color(color)).mul(cloudShadow());
  material.maskNode = nearCutMask();
  return material;
}

/**
 * One instanced mesh over a list of placements. The three functions say how big
 * this part of the prop is and how far up its base sits, so that a trunk and
 * its canopy share one list instead of each getting a copied one: the citadel
 * plants four thousand trees, and copying them twice cost more than a frame.
 */
function instanced(
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  name: string,
  radiusOf: (p: Placement) => number,
  heightOf: (p: Placement) => number,
  liftOf: (p: Placement) => number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(placements.length, 1));
  mesh.name = name;
  mesh.count = placements.length;
  const out = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (!p) continue;
    const radiusM = radiusOf(p);
    writeInstanceMatrix(
      out,
      i,
      p.x,
      p.y + liftOf(p),
      p.z,
      p.rotY,
      radiusM,
      heightOf(p),
      radiusM,
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
