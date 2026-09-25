import { Color, Group, InstancedMesh, Vector3, type BufferGeometry } from 'three';
import {
  attribute,
  float,
  interleavedGradientNoise,
  mix,
  mx_noise_float,
  positionGeometry,
  positionLocal,
  positionWorld,
  screenCoordinate,
  sin,
  smoothstep,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { TREE_DETAIL } from '@/state/altitude';
import { cloudShadow, weatherTime } from '@/world/atmosphere';
import { attachInstanceColors, markDynamic, paletteToLinear, writeInstanceMatrix } from '@/world/instanced';
import { nearCutMask } from '@/world/near-cut';
import {
  broadleafFar,
  broadleafNear,
  coniferFar,
  coniferNear,
  shrubGeometry,
  slenderFar,
  slenderNear,
} from '@/world/tree-geometry';

/**
 * The town's trees, drawn (the shapes are world/tree-geometry.ts).
 *
 * Each kind of tree is two instanced meshes: the whole tree for the ones near
 * the eye, its crown leaf cards round dark cores, and a plain one of solid
 * clumps, a sixth of the triangles, for the rest. Which is
 * which is sorted on the CPU whenever the eye has moved a few metres, which
 * for a town of three thousand trees is a copy of three thousand matrices,
 * nothing. A tree in the band between the two distances is in both meshes,
 * and each keeps the pixels the other throws away, by the same screen-space
 * dither the near cut uses, so walking toward a tree it thickens into its
 * full self rather than jumping.
 *
 * The leaves' light is noise in world space, three sizes of it: clusters of
 * leaf lit and in shade, the sprays in them and the grain of single leaves.
 * Their shapes are noise in each card's own square, which cuts it into a
 * cluster of leaves with sky between. Both fade with distance before they can
 * shimmer, and the far trees compute neither: from there the baked shade and
 * the soft crown normals do the work (tree-geometry.ts).
 *
 * They move a little: a slow sway that grows with the square of the height,
 * so the trunk stands and the crown moves, and a quicker flutter in the
 * leaves alone. It runs on the weather clock, which stands still for anybody
 * who asked for less motion (world/atmosphere.ts).
 */
export const TREE_LOOK = {
  /** The three sizes of the leaf pattern, in metres. */
  clusterM: 1.7,
  sprayM: 0.55,
  leafM: 0.2,
  /** Leaf in shadow and leaf in the light, against the tree's own colour. */
  dark: 0.74,
  light: 1.18,
  /** Lit leaves a little warmer, shaded ones a little cooler, as a share. */
  warmth: 0.07,
  /** The green drifting yellower and bluer across a crown: how big the patches, and how far. */
  hueM: 3.4,
  hue: 0.07,
  /** The pattern at full strength this near, gone by this far. */
  textureNearM: 30,
  textureFarM: 150,
  /**
   * A leaf card: how many clusters of leaves across it; where the leaves
   * stop, and how fast they thin toward the corners; and how much fuller a
   * card is by the second distance than at the first.
   */
  cardGrain: 6.5,
  cardCut: 0.44,
  cardFall: 0.42,
  cardFill: 0.22,
  cardFillFromM: 40,
  cardFillToM: 150,
  /** Bark: long streaks up the trunk. */
  barkStreakM: { across: 0.3, up: 2.6 },
  /** How far the top of a tree this tall moves, and the leaves on their own, in metres. */
  swayM: 0.11,
  swayHeightM: 10,
  flutterM: 0.022,
} as const;

/** Where the eye is. Every tree material reads it, the shadow pass included, so near and far agree there too. */
const eye = uniform(new Vector3());

/** Called once a frame from world.ts. */
export function setTreeEye(x: number, y: number, z: number): void {
  eye.value.set(x, y, z);
}

/** One tree as props.ts places it. */
export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  radiusM: number;
  heightM: number;
  rotY: number;
  round?: boolean;
  stems?: boolean;
  colour?: number;
  tint?: number;
}

export interface TreePalette {
  /** Conifers. */
  canopy: number;
  /** Everything else. */
  canopyRound: number;
  trunk: number;
  bush: number;
}

export interface TreeMeshes {
  group: Group;
  /** Sorts the trees into near and far, when the eye has moved far enough to matter. */
  setEye: (x: number, y: number, z: number) => void;
}

type Lod = 'near' | 'far' | 'all';

function treeMaterial(barkColour: number, lod: Lod): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();
  const leaf = varying(attribute('iColor', 'vec3'));
  const shade = varying(attribute('color', 'vec3'));
  const bark = varying(attribute('bark', 'float'));
  const p = positionWorld;
  const base = leaf.mul(shade);
  const toEye = p.distance(eye);
  let leaves = base;
  let kept = nearCutMask();
  if (lod !== 'far') {
    const L = TREE_LOOK;
    // Three sizes of pattern: clusters of leaf lit and in shade, the sprays in
    // them, and the grain of single leaves, which only shows close to.
    const clusters = mx_noise_float(p.div(L.clusterM));
    const sprays = mx_noise_float(p.div(L.sprayM).add(vec3(13.1, 7.3, 3.7)));
    const grain = mx_noise_float(p.div(L.leafM).add(vec3(-5.3, 21.7, 11.9)));
    const lit = smoothstep(-0.46, 0.5, clusters.mul(0.5).add(sprays.mul(0.3)).add(grain.mul(0.2)));
    const strength = float(1).sub(smoothstep(L.textureNearM, L.textureFarM, toEye));
    const tone = mix(float(L.dark), float(L.light), lit);
    const warm = lit.sub(0.5).mul(L.warmth * 2);
    // And the green itself drifts across a crown, yellower here and bluer there.
    const drift = mx_noise_float(p.div(L.hueM).add(vec3(31.1, -2.9, 17.3))).mul(L.hue);
    const pattern = vec3(
      tone.mul(warm.add(1)).mul(drift.add(1)),
      tone.mul(drift.mul(0.3).add(1)),
      tone.mul(float(1).sub(warm)).mul(float(1).sub(drift.mul(1.4))),
    );
    leaves = base.mul(mix(vec3(1, 1, 1), pattern, strength));

    // Each leaf card is cut into a cluster of leaves (world/tree-geometry.ts
    // `shell`): noise in the card's own square, so a card is the same leaves
    // however the tree sways, thinning to nothing toward its corners so no
    // card shows its square. Further off the clusters fill in, before single
    // leaves get small enough to shimmer.
    const leafCard = varying(attribute('leaf', 'vec3'));
    const across = leafCard.xy.sub(0.5).mul(2);
    const cluster = mx_noise_float(vec3(leafCard.xy.mul(L.cardGrain), leafCard.z.mul(31.7))).mul(0.5).add(0.5);
    const fill = smoothstep(L.cardFillFromM, L.cardFillToM, toEye).mul(L.cardFill);
    const inLeaf = cluster.add(fill).sub(across.dot(across).mul(L.cardFall)).greaterThan(L.cardCut);
    kept = kept.and(leafCard.z.lessThan(0).or(inLeaf));
  }
  const streaks = mx_noise_float(
    p.mul(vec3(1 / TREE_LOOK.barkStreakM.across, 1 / TREE_LOOK.barkStreakM.up, 1 / TREE_LOOK.barkStreakM.across)),
  );
  const wood = shade.mul(uniform(new Color(barkColour))).mul(streaks.mul(0.1).add(0.97));
  material.colorNode = mix(leaves, wood, bark).mul(cloudShadow());

  // Near and far share the band between them by a dither, measured from the
  // eye rather than from whichever camera is drawing: in the shadow pass that
  // is the sun, and a tree near the eye would cast no shadow at all.
  const far = smoothstep(TREE_DETAIL.nearM, TREE_DETAIL.farM, toEye);
  const dither = interleavedGradientNoise(screenCoordinate.xy);
  if (lod === 'near') material.maskNode = kept.and(dither.greaterThanEqual(far));
  else if (lod === 'far') material.maskNode = kept.and(dither.lessThan(far));
  else material.maskNode = kept;

  // The bend goes with the square of the height in metres, so a tall tree
  // sways and a shrub barely moves; the flutter goes with the height up the
  // tree's own model, so every crown has some.
  const h = positionGeometry.y.clamp(0, 1);
  const up = positionLocal.y.div(TREE_LOOK.swayHeightM).clamp(0, 2);
  const phase = positionLocal.x.mul(0.043).add(positionLocal.z.mul(0.037));
  const gust = sin(weatherTime.mul(0.83).add(phase)).mul(0.6).add(sin(weatherTime.mul(1.91).add(phase.mul(1.7))).mul(0.4));
  const bend = up.mul(up).mul(gust).mul(TREE_LOOK.swayM);
  const flutter = sin(weatherTime.mul(4.7).add(phase.mul(9.1)).add(positionLocal.y.mul(2.3)))
    .mul(TREE_LOOK.flutterM)
    .mul(h)
    .mul(float(1).sub(attribute('bark', 'float')));
  material.positionNode = positionLocal.add(vec3(bend.add(flutter), 0, bend.mul(0.55).sub(flutter.mul(0.6))));
  return material;
}

interface Kind {
  name: string;
  trees: readonly TreePlacement[];
  near: () => BufferGeometry;
  far: () => BufferGeometry;
  widthM: (tree: TreePlacement) => number;
  heightM: (tree: TreePlacement) => number;
  leaf: number;
}

/** Each tree's own green, a little warmer as it gets lighter and cooler as it gets darker. */
function leafColours(trees: readonly TreePlacement[], base: number): Float32Array {
  const out = new Float32Array(trees.length * 3);
  const own = new Map<number, Float32Array>();
  const baseLinear = paletteToLinear([base]);
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    if (!tree) continue;
    let linear = baseLinear;
    if (tree.colour !== undefined) {
      const found = own.get(tree.colour) ?? paletteToLinear([tree.colour]);
      own.set(tree.colour, found);
      linear = found;
    }
    const tint = tree.tint ?? 1;
    out[i * 3] = (linear[0] ?? 0.2) * tint * (0.94 + tint * 0.06);
    out[i * 3 + 1] = (linear[1] ?? 0.3) * tint;
    out[i * 3 + 2] = (linear[2] ?? 0.15) * tint * (1.06 - tint * 0.06);
  }
  return out;
}

interface Layer {
  kind: Kind;
  matrices: Float32Array;
  colours: Float32Array;
  near: InstancedMesh;
  nearColours: Float32Array;
  far: InstancedMesh;
  farColours: Float32Array;
  /** Per tree: 1 in the near mesh, 2 in the far one, 3 in both. */
  where: Uint8Array;
}

export function createTreeMeshes(trees: readonly TreePlacement[], bushes: readonly TreePlacement[], palette: TreePalette): TreeMeshes {
  const group = new Group();
  group.name = 'trees';
  const nearMaterial = treeMaterial(palette.trunk, 'near');
  const farMaterial = treeMaterial(palette.trunk, 'far');

  const kinds: Kind[] = [
    {
      name: 'tree-slender',
      trees: trees.filter((tree) => tree.stems),
      near: slenderNear,
      far: slenderFar,
      widthM: (tree) => tree.radiusM * 2,
      heightM: (tree) => tree.heightM,
      leaf: palette.canopyRound,
    },
    {
      name: 'tree-broadleaf',
      trees: trees.filter((tree) => !tree.stems && tree.round),
      near: broadleafNear,
      far: broadleafFar,
      // As wide as the old crown of lobes was, so a street keeps its look.
      widthM: (tree) => tree.radiusM * 2.3,
      heightM: (tree) => tree.heightM,
      leaf: palette.canopyRound,
    },
    {
      name: 'tree-conifer',
      trees: trees.filter((tree) => !tree.stems && !tree.round),
      near: coniferNear,
      far: coniferFar,
      widthM: (tree) => tree.radiusM * 2,
      heightM: (tree) => tree.heightM * 1.04,
      leaf: palette.canopy,
    },
  ];

  const layers: Layer[] = [];
  for (const kind of kinds) {
    const count = kind.trees.length;
    if (count === 0) continue;
    const matrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      const tree = kind.trees[i];
      if (!tree) continue;
      const width = kind.widthM(tree);
      writeInstanceMatrix(matrices, i, tree.x, tree.y, tree.z, tree.rotY, width, kind.heightM(tree), width);
    }
    const colours = leafColours(kind.trees, kind.leaf);
    const near = new InstancedMesh(kind.near(), nearMaterial, count);
    near.name = `${kind.name}-near`;
    const far = new InstancedMesh(kind.far(), farMaterial, count);
    far.name = `${kind.name}-far`;
    for (const mesh of [near, far]) {
      mesh.frustumCulled = false;
      markDynamic(mesh);
      group.add(mesh);
    }
    const layer: Layer = {
      kind,
      matrices,
      colours,
      near,
      nearColours: attachInstanceColors(near, count),
      far,
      farColours: attachInstanceColors(far, count),
      where: new Uint8Array(count),
    };
    // Everything is far until the eye is known.
    layer.where.fill(2);
    (far.instanceMatrix.array as Float32Array).set(matrices);
    layer.farColours.set(colours);
    far.count = count;
    near.count = 0;
    layers.push(layer);
  }

  if (bushes.length > 0) {
    const mesh = new InstancedMesh(shrubGeometry(), treeMaterial(palette.trunk, 'all'), bushes.length);
    mesh.name = 'bushes';
    mesh.frustumCulled = false;
    const out = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < bushes.length; i++) {
      const bush = bushes[i];
      if (!bush) continue;
      writeInstanceMatrix(out, i, bush.x, bush.y, bush.z, bush.rotY, bush.radiusM * 2, bush.heightM, bush.radiusM * 2);
    }
    attachInstanceColors(mesh, bushes.length).set(leafColours(bushes, palette.bush));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  let sortedX = Number.POSITIVE_INFINITY;
  let sortedY = Number.POSITIVE_INFINITY;
  let sortedZ = Number.POSITIVE_INFINITY;

  function sort(x: number, y: number, z: number): void {
    for (const layer of layers) {
      const trees = layer.kind.trees;
      let changed = false;
      for (let i = 0; i < trees.length; i++) {
        const tree = trees[i];
        if (!tree) continue;
        const dx = tree.x - x;
        const dy = tree.y + tree.heightM * 0.6 - y;
        const dz = tree.z - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const reach = Math.max(tree.radiusM * 1.3, tree.heightM * 0.6);
        const where = (d - reach < TREE_DETAIL.farM ? 1 : 0) | (d + reach > TREE_DETAIL.nearM ? 2 : 0);
        if (where !== layer.where[i]) changed = true;
        layer.where[i] = where;
      }
      if (!changed) continue;
      const nearOut = layer.near.instanceMatrix.array as Float32Array;
      const farOut = layer.far.instanceMatrix.array as Float32Array;
      let n = 0;
      let f = 0;
      for (let i = 0; i < trees.length; i++) {
        const where = layer.where[i] ?? 2;
        const matrix = layer.matrices.subarray(i * 16, i * 16 + 16);
        const colour = layer.colours.subarray(i * 3, i * 3 + 3);
        if (where & 1) {
          nearOut.set(matrix, n * 16);
          layer.nearColours.set(colour, n * 3);
          n++;
        }
        if (where & 2) {
          farOut.set(matrix, f * 16);
          layer.farColours.set(colour, f * 3);
          f++;
        }
      }
      layer.near.count = n;
      layer.far.count = f;
      for (const mesh of [layer.near, layer.far]) {
        mesh.instanceMatrix.needsUpdate = true;
        const colours = mesh.geometry.getAttribute('iColor');
        colours.needsUpdate = true;
      }
    }
  }

  return {
    group,
    setEye: (x, y, z) => {
      const moved = Math.hypot(x - sortedX, y - sortedY, z - sortedZ);
      if (moved < TREE_DETAIL.resortM) return;
      sortedX = x;
      sortedY = y;
      sortedZ = z;
      sort(x, y, z);
    },
  };
}
