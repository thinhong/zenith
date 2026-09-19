import {
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  abs,
  attribute,
  float,
  floor,
  fract,
  mix,
  normalWorld,
  positionWorld,
  step,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import type { BuildingStyle, Lot, LotUse } from '@/world/lots';

/**
 * Buildings: one InstancedMesh per style plus one for roof caps, so the whole
 * city is four draw calls. Window lights are drawn by the material rather than
 * by geometry: a row-and-column pattern in metres, keyed off a per-instance
 * seed so each building has its own dark windows, faded by the day clock and
 * by altitude (PLAN.md M1 tasks 4 and 7).
 */
const WINDOW = {
  rowM: 3.6,
  colM: 4.2,
  /** Fraction of windows that are lit at night. */
  litShare: 0.42,
  glow: 0.85,
  /** No windows in the ground floor or right under the roof. */
  skirtM: 2,
  parapetM: 1.2,
} as const;

const ROOF = { thicknessM: 0.7, overhang: 1.05, color: 0x6b635a } as const;

/** Modern-era building colours, low saturation and slightly warm (PLAN.md 5). */
const PALETTE: Record<LotUse, readonly number[]> = {
  work: [0x5d6875, 0x6b7380, 0x4f5a68, 0x737d8a],
  home: [0x8a8175, 0x7d7a72, 0x94897a, 0x6f7a78],
  market: [0x8a7f6a, 0x93866c, 0x7d745f],
  temple: [0x8c5a46, 0x7d4f3e],
  park: [0x000000],
  water: [0x000000],
};

export interface Buildings {
  group: Group;
  /** 1 while windows are lit, 0 in daylight. */
  setNight: (night: number) => void;
  /** 1 close in, 0 from satellite height: the city goes flat colour. */
  setDetail: (detail: number) => void;
  count: number;
}

export function createBuildings(lots: readonly Lot[]): Buildings {
  // One material for all three styles: the per-building numbers live in the
  // geometry, so the shader is compiled once.
  const windows = createWindowMaterial();

  const group = new Group();
  group.name = 'buildings';

  let count = 0;
  for (const style of ['tower', 'slab', 'low'] as const) {
    const styleLots = lots.filter((lot) => lot.heightM > 0 && lot.style === style);
    if (styleLots.length === 0) continue;
    group.add(buildingMesh(styleLots, style, windows.material));
    count += styleLots.length;
  }

  const capped = lots.filter((lot) => lot.heightM > 0 && lot.style !== 'tower');
  if (capped.length > 0) group.add(roofMesh(capped));

  return { group, setNight: windows.setNight, setDetail: windows.setDetail, count };
}

function buildingMesh(
  lots: readonly Lot[],
  style: BuildingStyle,
  material: MeshLambertNodeMaterial,
): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // pivot at the base so scaling in y grows upward

  const colors = new Float32Array(lots.length * 3);
  const sizes = new Float32Array(lots.length * 3);
  const seeds = new Float32Array(lots.length);
  const color = new Color();

  const mesh = new InstancedMesh(geometry, material, lots.length);
  mesh.name = `buildings-${style}`;

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();

  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    if (!lot) continue;
    position.set(lot.x, 0, lot.z);
    scale.set(lot.wM, lot.heightM, lot.dM);
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));

    const palette = PALETTE[lot.use];
    const shade = palette[Math.min(palette.length - 1, Math.floor(lot.jitter * palette.length))] ?? 0x808080;
    // Color.set() already lands in the renderer's working (linear) space, so
    // the components go straight into the attribute. Converting again here made
    // every building about ten times too dark.
    color.set(shade);
    colors.set([color.r, color.g, color.b], i * 3);
    sizes.set([lot.wM, lot.heightM, lot.dM], i * 3);
    seeds[i] = lot.jitter * 100;
  }

  geometry.setAttribute('iColor', new InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('iSize', new InstancedBufferAttribute(sizes, 3));
  geometry.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 1));

  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A thin cap that reads as eaves from above and breaks up the flat tops. */
function roofMesh(lots: readonly Lot[]): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ color: new Color(ROOF.color) }),
    lots.length,
  );
  mesh.name = 'buildings-roofs';

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    if (!lot) continue;
    position.set(lot.x, lot.heightM, lot.z);
    scale.set(lot.wM * ROOF.overhang, ROOF.thicknessM, lot.dM * ROOF.overhang);
    mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The window-light material. Returns the material together with the two knobs
 * the world turns each frame; the node types stay inferred rather than spelled
 * out, which keeps this readable.
 */
function createWindowMaterial() {
  const night = uniform(0);
  const detail = uniform(1);

  const instanceColor = attribute('iColor', 'vec3');
  // Instance attributes are read in the vertex stage, so they have to be
  // interpolated explicitly before the fragment stage can use them. Without
  // this the whole pattern is evaluated per vertex and smears across each face.
  const buildingSize = varying(attribute('iSize', 'vec3'));
  const buildingSeed = varying(attribute('iSeed', 'float'));

  // Buildings stand on y = 0, so world height is height above the street, and
  // world x/z give a window grid that lines up across the whole city.
  const heightM = positionWorld.y;
  const facingX = step(0.5, abs(normalWorld.x));
  const acrossM = mix(positionWorld.x, positionWorld.z, facingX);

  const row = heightM.div(WINDOW.rowM);
  const col = acrossM.div(WINDOW.colM);
  const withinRow = fract(row);
  const withinCol = fract(col);
  const paneY = step(0.16, withinRow).mul(float(1).sub(step(0.9, withinRow)));
  const paneX = step(0.1, withinCol).mul(float(1).sub(step(0.9, withinCol)));

  // Cheap per-window randomness, so some windows stay dark all night. The usual
  // fract(sin(dot(...)) * 43758) hash speckles once world coordinates get this
  // large, so every term here is kept small enough for 32-bit floats.
  const hashA = fract(floor(row).mul(0.1031).add(buildingSeed.mul(0.0973)));
  const hashB = fract(floor(col).mul(0.1379).add(hashA.mul(43.21)));
  const noise = fract(hashA.add(hashB).mul(hashB.add(19.19)).mul(7.13));
  const lit = step(1 - WINDOW.litShare, noise);

  const notRoof = float(1).sub(step(0.5, abs(normalWorld.y)));
  const aboveStreet = step(WINDOW.skirtM, heightM);
  const belowParapet = step(heightM, buildingSize.y.sub(WINDOW.parapetM));

  const glow = vec3(1.0, 0.82, 0.48)
    .mul(paneY)
    .mul(paneX)
    .mul(lit)
    .mul(notRoof)
    .mul(aboveStreet)
    .mul(belowParapet)
    .mul(night)
    .mul(detail)
    .mul(WINDOW.glow);

  const material = new MeshLambertNodeMaterial();
  material.colorNode = instanceColor;
  // three declares emissiveNode only on MeshStandardNodeMaterial, but
  // NodeMaterial.setupLighting() reads it on every node material.
  (material as MeshLambertNodeMaterial & { emissiveNode: unknown }).emissiveNode = glow;

  return {
    material,
    setNight: (value: number): void => {
      night.value = value;
    },
    setDetail: (value: number): void => {
      detail.value = value;
    },
  };
}
