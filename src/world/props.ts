import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
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
  maxTrees: 3600,
  maxLamps: 900,
  /** Woods on the plain between the ring road and the mountains. */
  countrysideClumps: 130,
  treesPerClump: 7,
  clumpRadiusM: 45,
} as const;

const PALETTE = {
  trunk: 0x4a3b2c,
  canopy: 0x3f6034,
  canopyDark: 0x35502d,
  post: 0x3a3a3c,
  lampOff: 0x4a4740,
  lampOn: 0xffd79a,
} as const;

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

export function createProps(
  rng: Rng,
  terrain: TerrainSpec,
  graph: RoadGraph,
  lots: readonly Lot[],
): Props {
  const trees = collectTrees(rng, terrain, graph, lots);
  const lamps = collectLamps(graph);

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
  const trunks = trees.map((t) => ({ ...t, radiusM: t.radiusM * 0.12, heightM: t.heightM * 0.38 }));
  const canopies = trees.map((t) => ({
    ...t,
    y: t.y + t.heightM * 0.34,
    heightM: t.heightM * 0.7,
  }));

  group.add(instanced(trunkGeometry, lambert(PALETTE.trunk), trunks, 'tree-trunks'));
  group.add(instanced(canopyGeometry, lambert(PALETTE.canopy, true), canopies, 'tree-canopies'));

  const headMaterial = new MeshBasicMaterial({ color: new Color(PALETTE.lampOff) });
  const posts = lamps.map((l) => ({ ...l, radiusM: 0.09, heightM: PROPS.lampHeightM }));
  const heads = lamps.map((l) => ({
    ...l,
    y: l.y + PROPS.lampHeightM,
    radiusM: 0.45,
    heightM: 0.35,
  }));
  group.add(instanced(postGeometry, lambert(PALETTE.post), posts, 'lamp-posts'));
  group.add(instanced(headGeometry, headMaterial, heads, 'lamp-heads'));

  const off = new Color(PALETTE.lampOff);
  const on = new Color(PALETTE.lampOn);

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
): Placement[] {
  const trees: Placement[] = [];

  const plant = (x: number, z: number): void => {
    if (trees.length >= PROPS.maxTrees) return;
    trees.push({
      x,
      y: 0,
      z,
      radiusM: range(rng, 2.2, 4),
      heightM: range(rng, 8, 13),
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
        const x = lot.x - lot.wM / 2 + ((c + 0.5) * lot.wM) / cols + range(rng, -2.5, 2.5);
        const z = lot.z - lot.dM / 2 + ((r + 0.5) * lot.dM) / rows + range(rng, -2.5, 2.5);
        plant(x, z);
      }
    }
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

function lambert(color: number, flatShading = false): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: new Color(color), flatShading });
}

function instanced(
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(placements.length, 1));
  mesh.name = name;
  mesh.count = placements.length;
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (!p) continue;
    position.set(p.x, p.y, p.z);
    rotation.setFromAxisAngle(up, p.rotY);
    scale.set(p.radiusM, p.heightM, p.radiusM);
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
