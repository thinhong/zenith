import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  MeshBasicMaterial,
} from 'three';
import { uniform } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { cloudShadow } from '@/world/atmosphere';
import { writeInstanceMatrix } from '@/world/instanced';
import type { Lot } from '@/world/lots';
import type { RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';
import { isBuildable, TERRAIN, type TerrainSpec } from '@/world/terrain';

/**
 * Trees and street lamps. Four instanced meshes for the lot: trunks, canopies,
 * lamp posts and lamp heads. The heads are unlit material whose colour is
 * driven by the day clock, which is how a lamp "comes on" without a point light
 * (PLAN.md M1 task 6).
 */
export const PROPS = {
  parkSpacingM: 13,
  avenueSpacingM: 26,
  /** Gap between the kerb and a street tree or lamp. */
  kerbGapM: 4,
  lampSpacingM: 46,
  lampHeightM: 6,
  maxTrees: 9000,
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

interface Placement {
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
  return {
    trees: collectTrees(rng, terrain, graph, lots, palette),
    lamps: palette.lamps ? collectLamps(graph) : [],
  };
}

export function createProps(placements: PropPlacements, palette: PropPalette): Props {
  const trees = placements.trees;

  const group = new Group();
  group.name = 'props';

  const trunkGeometry = new CylinderGeometry(1, 1, 1, 5);
  trunkGeometry.translate(0, 0.5, 0);
  const canopyGeometry = new ConeGeometry(1, 1, 6);
  canopyGeometry.translate(0, 0.5, 0);
  const postGeometry = new CylinderGeometry(1, 1, 1, 4);
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
    group.add(
      instanced(
        canopyGeometry,
        lambert(palette.canopy, true),
        trees,
        'tree-canopies',
        (t) => t.radiusM,
        (t) => t.heightM * 0.7,
        (t) => t.heightM * 0.34,
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
    });
  };

  // Parks: a loose grid inside the lot.
  for (const lot of lots) {
    if (lot.use !== 'park') continue;
    const rows = Math.max(1, Math.floor(lot.dM / PROPS.parkSpacingM));
    const cols = Math.max(1, Math.floor(lot.wM / PROPS.parkSpacingM));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // A quarter of the grid points are left empty and the rest are pushed
        // well off them, because a park planted on a lattice reads as an
        // orchard, which is what it looked like.
        if (rng() < 0.26) continue;
        const x = lot.x - lot.wM / 2 + ((c + 0.5) * lot.wM) / cols + range(rng, -6, 6);
        const z = lot.z - lot.dM / 2 + ((r + 0.5) * lot.dM) / rows + range(rng, -6, 6);
        plant(x, z);
      }
    }
  }

  // A tree in the yard, beside the building rather than on it.
  for (const lot of lots) {
    if (lot.use === 'park' || lot.heightM <= 0) continue;
    if (rng() >= palette.courtyardChance) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const alongX = rng() < 0.5;
    const reach = (alongX ? lot.wM : lot.dM) / 2 + range(rng, 2, 5);
    plant(
      lot.x + (alongX ? side * reach : range(rng, -lot.wM / 3, lot.wM / 3)),
      lot.z + (alongX ? range(rng, -lot.dM / 3, lot.dM / 3) : side * reach),
    );
  }

  // Boulevards: a row down each side of every avenue and the ring road.
  for (const edge of graph.edges) {
    if (edge.kind === 'street') continue;
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    const offset = edge.widthM / 2 + PROPS.kerbGapM;
    for (let t = PROPS.avenueSpacingM / 2; t < length; t += PROPS.avenueSpacingM) {
      for (const side of [-1, 1]) {
        plant(a.x + dx * t - dz * offset * side, a.z + dz * t + dx * offset * side);
      }
    }
  }

  // Woods on the plain, in clumps rather than an even sprinkle.
  const inner = terrain.cityRadiusM + 80;
  const outer = TERRAIN.mountainInnerM + 300;
  for (let i = 0; i < PROPS.countrysideClumps; i++) {
    const angle = range(rng, 0, Math.PI * 2);
    const radius = range(rng, inner, outer);
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    for (let k = 0; k < PROPS.treesPerClump; k++) {
      const x = cx + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      const z = cz + range(rng, -PROPS.clumpRadiusM, PROPS.clumpRadiusM);
      // isBuildable also rejects the water, which is what matters out here.
      if (Math.hypot(x, z) < terrain.cityRadiusM) continue;
      if (!isBuildable({ ...terrain, cityRadiusM: outer + PROPS.clumpRadiusM }, x, z, 12)) continue;
      plant(x, z);
    }
  }

  return trees;
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
