import { BufferAttribute, type BufferGeometry, ConeGeometry, Group, IcosahedronGeometry, InstancedMesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  attachInstanceColors,
  createTintedInstanceMaterial,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';
import type { ForestTree } from '@/world/landscape';

/**
 * The woods on the hills (`landscape.ts` FOREST), as two instanced meshes.
 *
 * Much plainer per tree than the town's own, because nobody sees one of these
 * from closer than a few hundred metres: two seven-sided tiers for a conifer,
 * one twenty-sided lump for a broadleaf. At that range that is all a tree is,
 * and it lets ten thousand of them cost two draw calls and about a fifth of
 * the triangles the town's trees do.
 */
export const FOREST_LOOK = {
  conifer: 0x2f5836,
  broadleaf: 0x4d7239,
  /** For a tree of size 1, in metres. */
  coniferRadiusM: 3.2,
  coniferHeightM: 12.5,
  broadleafRadiusM: 4.4,
  broadleafHeightM: 9,
} as const;

/** Gives every vertex of a part one shade, for the tinted instance material. */
function shaded(source: BufferGeometry, shade: (y: number) => number): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) colours.fill(shade(position.getY(i)), i * 3, i * 3 + 3);
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
}

function coniferGeometry(): BufferGeometry {
  const lower = new ConeGeometry(1, 0.62, 7, 1, true);
  lower.translate(0, 0.16 + 0.31, 0);
  const upper = new ConeGeometry(0.66, 0.52, 7, 1, true);
  // Turned against the tier below, so the facets do not line up.
  upper.rotateY(0.45);
  upper.translate(0, 0.48 + 0.26, 0);
  const merged = mergeGeometries([shaded(lower, () => 0.84), shaded(upper, () => 1.08)]);
  if (!merged) throw new Error('could not build a forest conifer');
  merged.scale(FOREST_LOOK.coniferRadiusM, FOREST_LOOK.coniferHeightM, FOREST_LOOK.coniferRadiusM);
  return merged;
}

function broadleafGeometry(): BufferGeometry {
  const ball = new IcosahedronGeometry(1, 0);
  ball.scale(1, 0.62, 1);
  ball.translate(0, 0.72, 0);
  // Lit on top, shaded underneath, which is most of what reads as foliage.
  const geometry = shaded(ball, (y) => 0.74 + 0.36 * Math.min(1, Math.max(0, (y - 0.1) / 1.24)));
  geometry.scale(FOREST_LOOK.broadleafRadiusM, FOREST_LOOK.broadleafHeightM * 0.72, FOREST_LOOK.broadleafRadiusM);
  return geometry;
}

function woods(trees: readonly ForestTree[], geometry: BufferGeometry, base: number, name: string): InstancedMesh {
  const material = createTintedInstanceMaterial(true);
  material.flatShading = true;
  const count = Math.max(1, trees.length);
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = name;
  const matrices = mesh.instanceMatrix.array as Float32Array;
  const colours = attachInstanceColors(mesh, count);
  const linear = paletteToLinear([base]);
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    if (!tree) continue;
    // A turn taken from the position, so it is the same on every load.
    const turn = (tree.x * 0.37 + tree.z * 0.61) % (Math.PI * 2);
    const tall = tree.size * (0.88 + (tree.tint - 0.84) * 0.8);
    writeInstanceMatrix(matrices, i, tree.x, tree.y, tree.z, turn, tree.size, tall, tree.size);
    // Warmer as it gets lighter and cooler as it gets darker, as in the town.
    colours[i * 3] = (linear[0] ?? 0.1) * tree.tint * (0.94 + tree.tint * 0.06);
    colours[i * 3 + 1] = (linear[1] ?? 0.2) * tree.tint;
    colours[i * 3 + 2] = (linear[2] ?? 0.1) * tree.tint * (1.06 - tree.tint * 0.06);
  }
  mesh.count = trees.length;
  mesh.instanceMatrix.needsUpdate = true;
  // The woods ring the camera, so one bounding sphere round all of them is
  // always in view: culling them as a whole would only cost the test.
  mesh.frustumCulled = false;
  return mesh;
}

export interface Forest {
  group: Group;
  /**
   * Leaves this share of the woods standing (EraAir.woods). The trees were
   * placed in random order, so the first part of each list is a thinning of
   * the whole, not one side of it cut away.
   */
  setShare: (share: number) => void;
}

export function createForest(trees: readonly ForestTree[]): Forest {
  const group = new Group();
  group.name = 'forest';
  const conifers = trees.filter((tree) => tree.conifer);
  const broadleaves = trees.filter((tree) => !tree.conifer);
  const meshes: { mesh: InstancedMesh; full: number }[] = [];
  if (conifers.length > 0) {
    meshes.push({ mesh: woods(conifers, coniferGeometry(), FOREST_LOOK.conifer, 'forest-conifers'), full: conifers.length });
  }
  if (broadleaves.length > 0) {
    meshes.push({
      mesh: woods(broadleaves, broadleafGeometry(), FOREST_LOOK.broadleaf, 'forest-broadleaves'),
      full: broadleaves.length,
    });
  }
  for (const { mesh } of meshes) group.add(mesh);
  return {
    group,
    setShare: (share) => {
      const k = Math.min(1, Math.max(0, share));
      for (const { mesh, full } of meshes) mesh.count = Math.round(full * k);
    },
  };
}
