import {
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Group,
  InstancedMesh,
  Material,
  MeshBasicMaterial,
} from 'three';
import { uniform } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { cloudShadow } from '@/world/atmosphere';
import {
  attachInstanceColors,
  createTintedInstanceMaterial,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Lot } from '@/world/lots';
import { endClearM, PAVEMENT_M, roadChains, walkChain, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { LANDSCAPE } from '@/world/landscape';
import { nearCutMask } from '@/world/near-cut';
import { onParkPlan, parkPlan } from '@/world/parks';
import { toWorld } from '@/world/frame';
import { createGridIndex, distanceToSegment, pointRectDistance, rectBounds } from '@/world/geometry2d';
import { isBuildable, TERRAIN, type TerrainSpec } from '@/world/terrain';

/**
 * Trees and street lamps. Four instanced meshes for the lot: trunks, canopies,
 * lamp posts and lamp heads. The heads are unlit material whose colour is
 * driven by the day clock, which is how a lamp "comes on" without a point light
 * (PLAN.md M1 task 6).
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
}

export interface Props {
  group: Group;
  /** 1 after dark: the lamps come on. */
  setNight: (night: number) => void;
  /** 0 from satellite height: props are too small to be worth drawing. */
  setDetail: (detail: number) => void;
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
): PropPlacements {
  const trees = collectTrees(rng, terrain, graph, lots, palette);
  return {
    trees,
    lamps: palette.lamps ? collectLamps(graph) : [],
    bushes: collectBushes(rng, trees, palette.bushesPerTree),
  };
}

/** Bakes a brightness into a geometry's vertices, for the tinted material. */
function tintedPart(source: BufferGeometry, shade: number): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3).fill(shade);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('could not merge a crown');
  return merged;
}

/**
 * A conifer: three tiers, each turned against the one below so the facets do
 * not line up, darker at the base where the lower branches are shaded and
 * lighter at the tip where the sun reaches. It used to be one eight-sided
 * cone, which is a party hat. Unit space: base radius 1 at y = 0, tip at 1.
 */
function coniferGeometry(): BufferGeometry {
  const tiers = [
    { radius: 1.0, height: 0.58, bottom: 0.0, shade: 0.84, closed: true },
    { radius: 0.76, height: 0.52, bottom: 0.3, shade: 1.0, closed: false },
    { radius: 0.5, height: 0.44, bottom: 0.56, shade: 1.16, closed: false },
  ];
  return mergeParts(
    tiers.map((tier, i) => {
      const cone = new ConeGeometry(tier.radius, tier.height, 9, 1, !tier.closed);
      cone.rotateY(i * 0.61);
      cone.translate(0, tier.bottom + tier.height / 2, 0);
      return tintedPart(cone, tier.shade);
    }),
  );
}

/**
 * A broadleaf crown: six lobes rather than one ball. A single twenty-sided
 * shape of this size is a die, whatever colour it is painted; a cluster of
 * them, shaded underneath and lit on top, is foliage. Deliberately lopsided,
 * three lobes round a core rather than four, because a symmetrical tree reads
 * as a model. Unit space: about plus and minus half across, 0.1 to 0.9 tall.
 */
function broadleafGeometry(): BufferGeometry {
  const lobes: { r: number; x: number; y: number; z: number; shade: number }[] = [
    { r: 0.3, x: 0, y: 0.44, z: 0, shade: 0.9 },
    { r: 0.23, x: 0.26, y: 0.37, z: 0.02, shade: 0.8 },
    { r: 0.22, x: -0.14, y: 0.38, z: 0.23, shade: 0.78 },
    { r: 0.22, x: -0.12, y: 0.36, z: -0.24, shade: 0.82 },
    { r: 0.25, x: 0.04, y: 0.64, z: -0.02, shade: 1.16 },
    { r: 0.18, x: 0.17, y: 0.57, z: 0.16, shade: 1.06 },
  ];
  return mergeParts(
    lobes.map((lobe, i) => {
      const ball = new IcosahedronGeometry(lobe.r, 0);
      ball.rotateY(i * 1.3);
      ball.rotateX(i * 0.7);
      ball.translate(lobe.x, lobe.y, lobe.z);
      return tintedPart(ball, lobe.shade);
    }),
  );
}

/** Writes each tree's own green into an instanced crown. */
function tintCrowns(mesh: InstancedMesh, trees: readonly Placement[], base: number): void {
  const colours = attachInstanceColors(mesh, Math.max(trees.length, 1));
  const linear = paletteToLinear([base]);
  for (let i = 0; i < trees.length; i++) {
    const tint = trees[i]?.tint ?? 1;
    // A little warmer as it gets lighter and cooler as it gets darker, the
    // way a real canopy varies, rather than one hue at different brightness.
    colours[i * 3] = (linear[0] ?? 0.2) * tint * (0.94 + tint * 0.06);
    colours[i * 3 + 1] = (linear[1] ?? 0.3) * tint;
    colours[i * 3 + 2] = (linear[2] ?? 0.15) * tint * (1.06 - tint * 0.06);
  }
}

export function createProps(placements: PropPlacements, palette: PropPalette): Props {
  const trees = placements.trees;

  const group = new Group();
  group.name = 'props';

  // Three sides, not five. A trunk is 40 cm wide and was costing twenty
  // triangles each; across the citadel's five thousand trees that was a third
  // of every triangle in the world, for something under a pixel from 200 m.
  // Five sides now, not three. A trunk is thin, but a three-sided one shows
  // its flat face whenever the sun is on it.
  const trunkGeometry = new CylinderGeometry(1, 1, 1, 5);
  trunkGeometry.translate(0, 0.5, 0);
  // A shrub is a metre across. Detail 1 on something that size is eighty
  // triangles for a blob; detail 0 is twenty and looks the same from 40 m up.
  const bushGeometry = new IcosahedronGeometry(0.5, 0);
  bushGeometry.translate(0, 0.45, 0);
  const postGeometry = new CylinderGeometry(1, 1, 1, 3);
  postGeometry.translate(0, 0.5, 0);
  const headGeometry = new BoxGeometry(1, 1, 1);

  // Trunks are a third of the tree; the canopy sits on top of them.
  if (trees.length > 0) {
    group.add(
      instanced(
        trunkGeometry,
        lambert(palette.trunk),
        trees,
        'tree-trunks',
        (t) => t.radiusM * 0.12,
        (t) => t.heightM * 0.38,
        () => 0,
      ),
    );
  }

  /**
   * Two crowns, not one.
   *
   * The second shape, the shrubs, `canopyRound`, `roundShare`, `bush` and
   * `bushesPerTree` were all written, all set by all three eras, and none of
   * them were ever drawn: `createProps` built the geometry and then never
   * passed it to `instanced`, and never read `placements.bushes` at all. So
   * every tree in every era was the same cone and there was not one shrub in
   * the world, which is exactly the plantation the comment above says the
   * second shape exists to avoid.
   */
  const cones = trees.filter((tree) => !tree.round);
  const rounds = trees.filter((tree) => tree.round);
  if (cones.length > 0) {
    const material = createTintedInstanceMaterial(true);
    material.flatShading = true;
    material.maskNode = nearCutMask();
    const mesh = instanced(
      coniferGeometry(),
      material,
      cones,
      'tree-canopies',
      (t) => t.radiusM,
      (t) => t.heightM * 0.7,
      (t) => t.heightM * 0.34,
    );
    tintCrowns(mesh, cones, palette.canopy);
    group.add(mesh);
  }
  if (rounds.length > 0) {
    const material = createTintedInstanceMaterial(true);
    material.flatShading = true;
    material.maskNode = nearCutMask();
    const mesh = instanced(
      broadleafGeometry(),
      material,
      rounds,
      'tree-crowns',
      // Wider and lower than a cone of the same tree: a round crown that
      // keeps the cone's proportions reads as a lollipop.
      (t) => t.radiusM * 2.3,
      (t) => t.heightM * 0.72,
      (t) => t.heightM * 0.3,
    );
    tintCrowns(mesh, rounds, palette.canopyRound);
    group.add(mesh);
  }

  const bushes = placements.bushes;
  if (bushes.length > 0) {
    group.add(
      instanced(
        bushGeometry,
        lambert(palette.bush, true),
        bushes,
        'bushes',
        (b) => b.radiusM * 2,
        (b) => b.heightM,
        () => 0,
      ),
    );
  }

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
    treeCount: trees.length,
    lampCount: lamps.length,
  };
}

function collectTrees(
  rng: Rng,
  terrain: TerrainSpec,
  graph: RoadGraph,
  lots: readonly Lot[],
  palette: PropPalette,
): Placement[] {
  const trees: Placement[] = [];

  const plant = (x: number, z: number): void => {
    if (trees.length >= PROPS.maxTrees) return;
    trees.push({
      x,
      y: 0,
      z,
      radiusM: range(rng, 2.2, 4) * palette.canopyScale,
      heightM: range(rng, 8, 13) * palette.canopyScale,
      rotY: range(rng, 0, Math.PI * 2),
      round: rng() < palette.roundShare,
      tint: range(rng, 0.82, 1.14),
    });
  };

  // Parks: a loose grid inside the lot, kept off the paths and out of the
  // middle, which is where parks.ts puts the things people walk to.
  for (const lot of lots) {
    if (lot.use !== 'park') continue;
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
            radiusM: 2.6 * size * range(rng, 0.94, 1.06) * palette.canopyScale,
            heightM: 9 * size * range(rng, 0.94, 1.06) * palette.canopyScale,
            rotY: range(rng, 0, Math.PI * 2),
            round,
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
  for (let i = 0; i < PROPS.countrysideClumps; i++) {
    const angle = range(rng, 0, Math.PI * 2);
    const inner = edgeAt(angle) + 40;
    if (inner >= outer - 10) continue;
    const radius = range(rng, inner, outer);
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    for (let k = 0; k < PROPS.treesPerClump; k++) {
      const x = cx + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      const z = cz + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      // isBuildable also rejects the water, which is what matters out here.
      const fromCentreM = Math.hypot(x, z);
      if (fromCentreM < edgeAt(Math.atan2(z, x)) + 20 || fromCentreM > outer) continue;
      if (!isBuildable({ ...terrain, cityRadiusM: outer + PROPS.clumpRadiusM }, x, z, 12)) continue;
      if (blocked(x, z)) continue;
      plant(x, z);
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
