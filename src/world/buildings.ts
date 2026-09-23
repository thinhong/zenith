import {
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  type Object3D,
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
  normalView,
  normalWorld,
  positionWorld,
  pow,
  step,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { cloudShadow } from '@/world/atmosphere';
import { nearCutMask } from '@/world/near-cut';
import { writeInstanceMatrix } from '@/world/instanced';
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
  /** How much darker a pane is than its wall in daylight. */
  dayShade: 0.22,
  /**
   * The ground floor is glass, shutters and signs, not the render of the six
   * storeys above it, so it takes its own tone. It is the band you read first
   * when you come down to street level.
   */
  shopM: 3.6,
  shopShade: 0.2,
  /** No windows in the ground floor or right under the roof. */
  skirtM: 2,
  parapetM: 1.2,
} as const;

const ROOF = { thicknessM: 0.7, overhang: 1.05 } as const;

/** The warm edge light on a silhouette. See createWindowMaterial. */
const RIM = { r: 1.0, g: 0.86, b: 0.62, strength: 0.34, falloff: 3.5 } as const;

export interface Buildings {
  group: Group;
  /** 1 while windows are lit, 0 in daylight. */
  setNight: (night: number) => void;
  /** 1 close in, 0 from satellite height: the city goes flat colour. */
  setDetail: (detail: number) => void;
  /** Fades the daytime window pattern, which aliases long before the lights do. */
  setFacade: (facade: number) => void;
  /** Makes the walls see-through (ui/bar.ts, the X key). */
  /** The lot a click landed on, or undefined if the mesh is not a building. */
  lotAt: (mesh: Object3D, instanceId: number) => Lot | undefined;
  /** Hides these lots' buildings, by scaling those instances to nothing. */
  setHidden: (lotIds: ReadonlySet<number>) => void;
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
  /**
   * The colour of a lit window. An oil lamp is orange, a filament is warm
   * white, and whatever 2300 runs on is cool and even. This was fixed at one
   * warm tone, which made every century's night look like the same century.
   */
  glowTint: readonly [number, number, number];
}

export function createBuildings(lots: readonly Lot[], options: BuildingOptions): Buildings {
  // One material for all three styles: the per-building numbers live in the
  // geometry, so the shader is compiled once.
  const windows = createWindowMaterial(options.litShare, options.glow, options.glowTint);

  const group = new Group();
  group.name = 'buildings';

  let count = 0;
  /**
   * `write` puts one instance back exactly as it was built, or scales it to
   * nothing. Each layer needs its own, because a roof cap does not sit where
   * its building sits: sharing one writer between them re-sealed every capped
   * building as a full-height box the size of the whole plot.
   */
  const layers: {
    mesh: InstancedMesh;
    lots: readonly Lot[];
    write: (out: Float32Array, index: number, lot: Lot, scale: number) => void;
  }[] = [];
  for (const style of ['tower', 'slab', 'low'] as const) {
    const styleLots = lots.filter((lot) => lot.heightM > 0 && lot.style === style);
    if (styleLots.length === 0) continue;
    const mesh = buildingMesh(styleLots, style, windows.material, options.colours);
    layers.push({
      mesh,
      lots: styleLots,
      write: (out, index, lot, k) =>
        writeInstanceMatrix(out, index, lot.x, 0, lot.z, 0, lot.wM * k, lot.heightM * k, lot.dM * k),
    });
    group.add(mesh);
    count += styleLots.length;
  }

  const capped = options.caps
    ? lots.filter((lot) => lot.heightM > 0 && lot.style !== 'tower')
    : [];
  if (capped.length > 0) {
    const mesh = roofMesh(capped, options.roof);
    layers.push({
      mesh,
      lots: capped,
      write: (out, index, lot, k) =>
        writeInstanceMatrix(
          out,
          index,
          lot.x,
          lot.heightM,
          lot.z,
          0,
          lot.wM * ROOF.overhang * k,
          ROOF.thicknessM * k,
          lot.dM * ROOF.overhang * k,
        ),
    });
    group.add(mesh);
  }

  return {
    group,
    setNight: windows.setNight,
    setDetail: windows.setDetail,
    setFacade: windows.setFacade,
    lotAt: (mesh, instanceId) => layers.find((l) => l.mesh === mesh)?.lots[instanceId],
    setHidden: (lotIds) => {
      for (const layer of layers) {
        const matrices = layer.mesh.instanceMatrix.array as Float32Array;
        for (let i = 0; i < layer.lots.length; i++) {
          const lot = layer.lots[i];
          if (!lot) continue;
          layer.write(matrices, i, lot, lotIds.has(lot.id) ? 0 : 1);
        }
        layer.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    count,
  };
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
function createWindowMaterial(
  litShare: number,
  glowStrength: number,
  tint: readonly [number, number, number],
) {
  const night = uniform(0);
  const detail = uniform(1);
  const facade = uniform(1);

  const instanceColor = varying(attribute('iColor', 'vec3'));
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
  const paneY = step(0.22, withinRow).mul(float(1).sub(step(0.86, withinRow)));
  const paneX = step(0.14, withinCol).mul(float(1).sub(step(0.88, withinCol)));

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

  // The same panes, dark, during the day. A blank wall is what makes a
  // rendered building read as a block: real glass is darker than the wall
  // around it at every hour, and from six hundred metres a floor is about two
  // pixels, which is exactly the texture an aerial photograph has. It fades
  // out with `detail`, so it never turns into moire from satellite height.
  const pane = paneY
    .mul(paneX)
    .mul(float(1).sub(step(0.5, abs(normalWorld.y))))
    .mul(step(WINDOW.skirtM, heightM))
    .mul(step(heightM, buildingSize.y.sub(WINDOW.parapetM)));
  // Vary the strength per building, or a street of towers reads as one
  // repeated texture, which is the giveaway in a rendered city. `iSeed` is the
  // lot's jitter times a hundred, so it is folded back into 0..1 first: taken
  // raw it multiplied the pattern by up to ninety and every wall came out
  // solid black.
  const seed01 = fract(buildingSeed.mul(0.01));
  const paneStrength = float(WINDOW.dayShade).mul(seed01.mul(0.7).add(0.65));
  const shaded = float(1).sub(pane.mul(paneStrength).mul(facade).mul(float(1).sub(night)));
  const shopfront = float(1).sub(
    float(1)
      .sub(step(WINDOW.shopM, heightM))
      .mul(float(1).sub(step(0.5, abs(normalWorld.y))))
      .mul(WINDOW.shopShade)
      .mul(facade),
  );

  const glow = vec3(tint[0], tint[1], tint[2])
    .mul(paneY)
    .mul(paneX)
    .mul(lit)
    .mul(notRoof)
    .mul(aboveStreet)
    .mul(belowParapet)
    .mul(night)
    .mul(detail)
    .mul(glowStrength);

  /**
   * A warm edge on every face that turns away from the camera. This is the
   * one thing a painted background does that a lit box never will: the
   * silhouette catches light and separates from whatever is behind it.
   *
   * `normalView.z` is 1 on a face pointing straight at the camera and 0 on one
   * seen edge-on, so this is nothing but the rim. It is cheap, it costs no
   * extra pass, and unlike an outline drawn in world units it holds its
   * meaning from twelve metres to two thousand.
   */
  const rim = pow(float(1).sub(abs(normalView.z)), RIM.falloff).mul(RIM.strength);
  const rimColour = vec3(RIM.r, RIM.g, RIM.b).mul(rim).mul(detail);

  const material = new MeshLambertNodeMaterial();
  material.colorNode = instanceColor.mul(shaded).mul(shopfront).mul(cloudShadow());
  material.maskNode = nearCutMask();
  // three declares emissiveNode only on MeshStandardNodeMaterial, but
  // NodeMaterial.setupLighting() reads it on every node material.
  (material as MeshLambertNodeMaterial & { emissiveNode: unknown }).emissiveNode = glow.add(rimColour);

  return {
    material,
    setNight: (value: number): void => {
      night.value = value;
    },
    setFacade: (value: number): void => {
      facade.value = value;
    },
    setDetail: (value: number): void => {
      detail.value = value;
    },
  };
}
