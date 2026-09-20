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
  /** No windows in the ground floor or right under the roof. */
  skirtM: 2,
  parapetM: 1.2,
} as const;

const ROOF = { thicknessM: 0.7, overhang: 1.05 } as const;

export interface Buildings {
  group: Group;
  /** 1 while windows are lit, 0 in daylight. */
  setNight: (night: number) => void;
  /** 1 close in, 0 from satellite height: the city goes flat colour. */
  setDetail: (detail: number) => void;
  count: number;
}

export interface BuildingOptions {
  colours: Readonly<Record<LotUse, readonly number[]>>;
  /** Colour of the thin eaves cap. */
  roof: number;
  /**
   * Whether to add that cap at all. An era that puts a proper tiled roof on
   * every building of its own (the citadel) turns it off.
   */
  caps: boolean;
  /**
   * Fraction of windows lit after dark, and how brightly. A city on the grid
   * shows rows of white panes; a town on oil lamps shows a few dim ones, so
   * the era sets both rather than every era glowing like 2020.
   */
  litShare: number;
  glow: number;
}

export function createBuildings(lots: readonly Lot[], options: BuildingOptions): Buildings {
  // One material for all three styles: the per-building numbers live in the
  // geometry, so the shader is compiled once.
  const windows = createWindowMaterial(options.litShare, options.glow);

  const group = new Group();
  group.name = 'buildings';

  let count = 0;
  for (const style of ['tower', 'slab', 'low'] as const) {
    const styleLots = lots.filter((lot) => lot.heightM > 0 && lot.style === style);
    if (styleLots.length === 0) continue;
    group.add(buildingMesh(styleLots, style, windows.material, options.colours));
    count += styleLots.length;
  }

  const capped = options.caps
    ? lots.filter((lot) => lot.heightM > 0 && lot.style !== 'tower')
    : [];
  if (capped.length > 0) group.add(roofMesh(capped, options.roof));

  return { group, setNight: windows.setNight, setDetail: windows.setDetail, count };
}

function buildingMesh(
  lots: readonly Lot[],
  style: BuildingStyle,
  material: MeshLambertNodeMaterial,
  colours: Readonly<Record<LotUse, readonly number[]>>,
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

    const palette = colours[lot.use];
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
function roofMesh(lots: readonly Lot[], colour: number): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ color: new Color(colour) }),
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
function createWindowMaterial(litShare: number, glowStrength: number) {
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
  const lit = step(1 - litShare, noise);

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
    .mul(glowStrength);

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
