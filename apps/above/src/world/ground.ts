import { BufferAttribute, BufferGeometry, CircleGeometry, Color, Group, Mesh } from 'three';
import {
  attribute,
  cameraPosition,
  clamp,
  float,
  length,
  min,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  sin,
  smoothstep,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshBasicNodeMaterial, MeshLambertNodeMaterial, MeshPhongNodeMaterial, type Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloudShadow, FIELDS, fieldTone, townToCountry, weatherTime } from '@/world/atmosphere';
import { createForest } from '@/world/forest-mesh';
import { buildForest, buildLandscapeGrid, type LandscapeGrid } from '@/world/landscape';
import { mulberry32 } from '@/world/seed';
import { lakeRadiusAt, type Lake } from '@/world/plan';
import { centrelinePoint, TERRAIN, type TerrainSpec, type WaterSpec } from '@/world/terrain';

/**
 * The land, the water and the mountain ring as three.js objects. Everything is
 * flat colour and instanced (AGENTS.md 6); the shape comes from terrain.ts.
 */

/**
 * The high country rings every era, so above the lowland its colours do not
 * change with one. The lowland itself is the era's own land colour, so the
 * foothills rise out of the plain without a seam in any century.
 */
export const GROUND_PALETTE = {
  forest: 0x4a6b3a,
  forestLight: 0x6d8c4b,
  rock: 0x938a7b,
  rockDark: 0x746c60,
  snow: 0xf2f4f7,
} as const;

/**
 * How far above the land each flat layer is drawn. Coplanar surfaces need a
 * little separation or they fight for the same depth. These were three to
 * four times larger, sized for a camera that once went up to six kilometres.
 * It stops at 2.6 km now, and the near plane grows with altitude
 * (core/camera.ts), which leaves a few centimetres enough. And a person on
 * the street is seen from eye height now (walk/): with the pavement half a
 * metre up, everybody on it stood in it to the knee, and every kerb was a
 * step down into a trench in front of the houses.
 */
export const LAYER_Y = { ground: 0, bank: 0.05, water: 0.09, pavement: 0.14, road: 0.22 } as const;

/**
 * Where the water meets the land. Open water was one flat colour right up to
 * a ruled edge, which is how a map draws a coast, not how one looks: from the
 * air the first thing a shore shows is the change in the water itself, pale
 * where the bottom shows through, and a line of broken white where it meets
 * the sand.
 */
export const SHORE = {
  /** Water this close to the bank shows the bottom through it. */
  shallowM: 60,
  /** The line of broken water along the bank. */
  foamM: 2.6,
  /** How far a wave carries the foam line in and back. */
  lapM: 1.4,
  /** Seconds for one wave to come in and go out. */
  lapS: 7,
  /** Sand along a coast; a strip of mud along a river. */
  bankM: { coast: 18, river: 6 },
  /** How far the sand runs on under the water, so no gap shows at the edge. */
  bankUnderM: 2,
} as const;

/** Terrain colours, the same in every era: the sea does not change its sand. */
const SHORE_PALETTE = {
  shallow: 0x5fbdb9,
  foam: 0xf2f5f3,
  sand: 0xd9caa3,
  wetSand: 0xae9b77,
  mud: 0x9a8c6b,
  /** The water's own highlight, where it turns the sun back at the eye. */
  glint: 0x252b2f,
} as const;

/** A colour the era can rewrite, read by a material's colour node. */
function colourUniform(value: number | Color) {
  return uniform(new Color(value));
}
type ColourUniform = ReturnType<typeof colourUniform>;

/** A number the era can rewrite, read by a material. */
function numberUniform(value: number) {
  return uniform(value);
}
type NumberUniform = ReturnType<typeof numberUniform>;

export interface Ground {
  group: Group;
  /**
   * The land takes two colours from the era, the ground a town stands on and
   * the country beyond it, and the water a third. All three cross-fade when
   * the era changes.
   */
  setColours: (town: Color, country: Color, water: Color) => void;
  /** How still the water lies, 0 to 1 (EraAir.calm). */
  setCalm: (calm: number) => void;
  /** The colour of the sky, which still water holds when it is looked at from low down. */
  setSky: (sky: Color) => void;
  /** Share of the woods on the hills left standing (EraAir.woods). */
  setWoods: (share: number) => void;
  /** Low mist lying over the water and the plain, 0 for none, and its colour (EraAir.mist). */
  setMist: (strength: number, colour: Color) => void;
  /**
   * The lakes of one era's town, as a group for that era's own scene graph:
   * it comes and goes with the era, and its water is the sea's.
   */
  lakes: (lakes: readonly Lake[]) => Group;
}

/**
 * Low mist, for an era that has it (EraAir.mist): two layers lying over the
 * water (the sea or the river, and the lakes in a town), broken into
 * drifting banks by noise. They fade out close to the eye, so from the
 * street they are a band of mist over the water rather than a ceiling, and
 * they thin out from high up, where a whole sea under a blanket reads as
 * cloud rather than as a calm morning. Only over water: a sheet over the
 * land showed from above as a pale disc with the town cut out of it.
 */
export const MIST_SHEETS = {
  layers: [
    { heightM: 12, scaleM: 300, drift: 0.55, share: 1 },
    { heightM: 34, scaleM: 520, drift: -0.35, share: 0.6 },
  ],
  /**
   * Over a lake in town: two thin sheets just off the water, below the eye of
   * somebody on the bank, so what they veil is the water and the foot of the
   * far shore. Wisps, not banks: the noise is finer than a lake is wide. They
   * are for somebody down there, and gone by the roof band. The one sheet
   * this used to be, four metres up at the sea's scale of noise, sat over
   * every lake as one even film: milk by day and pink at dusk from the air,
   * and from the bank it was above the eye and faced away from it, so it
   * could not be seen at all.
   */
  lake: {
    sheets: [
      { heightM: 0.6, scaleM: 34, drift: 0.22, share: 0.75 },
      { heightM: 1.2, scaleM: 58, drift: -0.16, share: 0.6 },
    ],
    nearM: 6,
    fullM: 45,
    highFromM: 40,
    highToM: 220,
    highShare: 0,
  },
  /** Nothing within this far of the eye, and all of it past the second. */
  nearM: 60,
  fullM: 360,
  /** The noise between these is the edge of a bank. */
  bank: [0.36, 0.76] as const,
  /** Most a sheet is ever opaque. */
  opacity: 0.6,
  /** All of it below the first height, and this share of it left above the second. */
  highFromM: 900,
  highToM: 2200,
  highShare: 0.25,
  renderOrder: 6,
} as const;

/** How near the eye a sheet starts, and how high the eye can go before it thins. */
interface MistReach {
  nearM: number;
  fullM: number;
  highFromM: number;
  highToM: number;
  highShare: number;
}

function mistMaterial(
  colour: ColourUniform,
  strength: NumberUniform,
  layer: { scaleM: number; drift: number; share: number },
  reach: MistReach = MIST_SHEETS,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.colorNode = colour;
  const drift = vec2(weatherTime.mul(layer.drift), weatherTime.mul(layer.drift * 0.6));
  const noise = mx_noise_float(positionWorld.xz.div(layer.scaleM).add(drift)).mul(0.5).add(0.5);
  const banks = smoothstep(MIST_SHEETS.bank[0], MIST_SHEETS.bank[1], noise);
  const offEye = smoothstep(reach.nearM, reach.fullM, length(positionWorld.xz.sub(cameraPosition.xz)));
  const high = float(1).sub(smoothstep(reach.highFromM, reach.highToM, cameraPosition.y).mul(1 - reach.highShare));
  material.opacityNode = banks.mul(offEye).mul(high).mul(strength).mul(MIST_SHEETS.opacity * layer.share);
  return material;
}

function mistMesh(geometry: BufferGeometry, material: MeshBasicNodeMaterial, heightM: number, name: string): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = heightM;
  mesh.renderOrder = MIST_SHEETS.renderOrder;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.castsNoShadow = true;
  return mesh;
}

export function createGround(
  terrain: TerrainSpec,
  town: number,
  country: number,
  water: number,
): Ground {
  const group = new Group();
  group.name = 'ground';
  // The era writes these; the shaders read them, so a cross-fade is three writes.
  const townColour = colourUniform(town);
  const countryColour = colourUniform(country);
  const waterColour = colourUniform(water);
  const calm = numberUniform(0);
  const sky = colourUniform(0xffffff);
  const landMesh = createLand(terrain, townColour, countryColour);
  const waterMesh = createWater(terrain, waterColour, calm, sky);
  const grid = buildLandscapeGrid(terrain, mulberry32(0x5eed));
  const forest = createForest(buildForest(terrain, grid, mulberry32(0xf0e5)));
  const mistColour = colourUniform(0xffffff);
  const mistStrength = numberUniform(0);
  const mist = createMist(terrain, mistColour, mistStrength);
  group.add(landMesh, createBanks(terrain), waterMesh, createLandscape(grid, terrain, townColour, countryColour), forest.group, mist);

  return {
    group,
    setColours: (nextTown, nextCountry, nextWater) => {
      townColour.value.copy(nextTown);
      countryColour.value.copy(nextCountry);
      waterColour.value.copy(nextWater);
    },
    setCalm: (value) => {
      calm.value = value;
    },
    setSky: (colour) => {
      sky.value.copy(colour);
    },
    setWoods: (share) => forest.setShare(share),
    setMist: (strength, colour) => {
      mistStrength.value = strength;
      mistColour.value.copy(colour);
      mist.visible = strength > 0.01;
    },
    lakes: (lakes) => {
      const out = new Group();
      out.name = 'lakes';
      if (lakes.length === 0) return out;
      const surface = lakeGeometry(lakes);
      const fromBankM = varying(attribute('fromBank', 'float'));
      const lake = varying(attribute('lake', 'vec3'));
      const water = new Mesh(surface, waterMaterial(fromBankM, waterColour, calm, sky, { lake }));
      water.name = 'lake-water';
      water.receiveShadow = true;
      const edgeMaterial = new MeshLambertNodeMaterial();
      edgeMaterial.colorNode = colourUniform(LAKE_LOOK.edge).mul(cloudShadow());
      const edge = new Mesh(lakeEdgeGeometry(lakes), edgeMaterial);
      edge.name = 'lake-edge';
      edge.receiveShadow = true;
      out.add(edge, water);
      const mistSurface = lakeGeometry(lakes);
      for (const sheet of MIST_SHEETS.lake.sheets) {
        const lakeMist = mistMesh(mistSurface, mistMaterial(mistColour, mistStrength, sheet, MIST_SHEETS.lake), sheet.heightM, `lake-mist-${sheet.heightM}`);
        lakeMist.visible = true;
        out.add(lakeMist);
      }
      // Nothing here casts a shadow, and the era's group would otherwise tell it to.
      out.traverse((object) => {
        object.userData.castsNoShadow = true;
      });
      return out;
    },
  };
}

function createMist(terrain: TerrainSpec, colour: ColourUniform, strength: NumberUniform): Group {
  const group = new Group();
  group.name = 'mist';
  group.visible = false;
  const water = terrain.water;
  const centre = waterCentreline(water);
  const river = water.kind === 'river';
  const inner = offsetLine(water, centre, river ? -water.halfWidthM : 0);
  const outer = offsetLine(water, centre, river ? water.halfWidthM : TERRAIN.waterReachM);
  const geometry = ribbonGeometry(inner, outer, 0);
  for (const layer of MIST_SHEETS.layers) {
    group.add(mistMesh(geometry, mistMaterial(colour, strength, layer), layer.heightM, `mist-${layer.heightM}`));
  }
  return group;
}

/**
 * The land is most of the picture from any height, so a single flat colour is
 * most of why the world used to read as felt. It carries two patterns instead:
 * the patchwork of fields out in the country, and the cloud shadows.
 *
 * The disc is 128 segments, which is nowhere near enough vertices to hold a
 * pattern, so both live in the fragment stage and cost nothing in geometry.
 */
function createLand(
  terrain: TerrainSpec,
  town: ColourUniform,
  country: ColourUniform,
): Mesh<CircleGeometry, MeshLambertNodeMaterial> {
  const geometry = new CircleGeometry(terrain.groundRadiusM, 128);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshLambertNodeMaterial();
  // Push the land a touch further away so the roads drawn on top of it win.
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;

  material.colorNode = landColour(terrain, town, country).mul(cloudShadow());

  const mesh = new Mesh(geometry, material);
  mesh.name = 'land';
  mesh.position.y = LAYER_Y.ground;
  return mesh;
}

/**
 * The water's centreline, carried far past both ends of the land so the strip
 * never shows a cut edge from high up.
 */
function waterCentreline(water: WaterSpec): { x: number; z: number }[] {
  const centre: { x: number; z: number }[] = [];
  for (let i = 0; i < water.offsetsM.length; i++) centre.push(centrelinePoint(water, i));
  const head = centre[0];
  const tail = centre[centre.length - 1];
  if (head) {
    centre.unshift({
      x: head.x - water.dirX * TERRAIN.waterReachM,
      z: head.z - water.dirZ * TERRAIN.waterReachM,
    });
  }
  if (tail) {
    centre.push({
      x: tail.x + water.dirX * TERRAIN.waterReachM,
      z: tail.z + water.dirZ * TERRAIN.waterReachM,
    });
  }
  return centre;
}

/** The centreline moved sideways across the water by `offsetM`. */
function offsetLine(
  water: WaterSpec,
  centre: readonly { x: number; z: number }[],
  offsetM: number,
): { x: number; z: number }[] {
  return centre.map((p) => ({ x: p.x + water.nrmX * offsetM, z: p.z + water.nrmZ * offsetM }));
}

/**
 * 0 along a ribbon's first line and 1 along its second. The ribbon keeps its
 * vertices in pairs, one from each line, so this is the whole of it.
 */
function acrossAttribute(pairs: number): BufferAttribute {
  const across = new Float32Array(pairs * 2);
  for (let i = 0; i < pairs; i++) across[i * 2 + 1] = 1;
  return new BufferAttribute(across, 1);
}

/**
 * The water surface. It knows how far each point is from the nearest bank,
 * because the strip is built from the bank out and carries that as an
 * attribute, and it spends that on three things: a pale shallow band where
 * the bottom shows, a line of foam that comes in and goes out along the edge,
 * and a highlight where the surface turns the sun back at the eye.
 */
function createWater(
  terrain: TerrainSpec,
  colour: ColourUniform,
  calm: NumberUniform,
  sky: ColourUniform,
): Mesh<BufferGeometry, MeshPhongNodeMaterial> {
  const water = terrain.water;
  const centre = waterCentreline(water);
  // A river is a band around its centreline; a coast is everything on one
  // side of the shore, carried far enough out to vanish into fog.
  const river = water.kind === 'river';
  const inner = offsetLine(water, centre, river ? -water.halfWidthM : 0);
  const outer = offsetLine(water, centre, river ? water.halfWidthM : TERRAIN.waterReachM);
  const geometry = ribbonGeometry(inner, outer, LAYER_Y.water);
  geometry.setAttribute('across', acrossAttribute(Math.min(inner.length, outer.length)));
  const across = varying(attribute('across', 'float'));
  const fromBankM = river
    ? min(across, float(1).sub(across)).mul(water.halfWidthM * 2)
    : across.mul(TERRAIN.waterReachM);
  const mesh = new Mesh(geometry, waterMaterial(fromBankM, colour, calm, sky));
  mesh.name = 'water';
  return mesh;
}

/**
 * The water's surface, for anything that knows how far each point is from
 * its bank: the sea or the river, and the lakes an era keeps in its town.
 * It spends that distance on three things: a pale shallow band where the
 * bottom shows, a line of foam that comes in and goes out along the edge,
 * and a highlight where the surface turns the sun back at the eye.
 */
/**
 * A lake, as each point of its water knows it: the middle it is round, and
 * its radius, so the water can work out where a reflected ray meets the far
 * bank (see `waterMaterial`).
 */
interface Banked {
  /** x and z of the lake's middle, and its radius, per vertex. */
  lake: Node<'vec3'>;
}

function waterMaterial(
  fromBankM: Node<'float'>,
  colour: ColourUniform,
  calm: NumberUniform,
  sky: ColourUniform,
  banked?: Banked,
): MeshPhongNodeMaterial {
  const material = new MeshPhongNodeMaterial();
  // The water is a few centimetres above the land it covers (LAYER_Y), and
  // from the top of the range the far sea is kilometres off, where a depth
  // step is bigger than that: the land showed through in green specks. A
  // small bias toward the camera settles it without raising the water.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  // A tight, faint highlight. Broad and bright, it lit a third of the sea
  // white whenever the camera faced the sun, which read as fog, not water.
  material.shininess = 320;
  material.specular = new Color(SHORE_PALETTE.glint);

  // Two sizes of noise: a small one that frays the foam line, and a wide slow
  // one that keeps open water from being one flat colour.
  const fray = mx_noise_float(positionWorld.xz.mul(0.07));
  const drift = vec2(weatherTime.mul(0.021), weatherTime.mul(0.013));
  const swell = mx_noise_float(positionWorld.xz.mul(0.022).add(drift));
  const lap = sin(weatherTime.mul((Math.PI * 2) / SHORE.lapS).add(fray.mul(2.2))).mul(0.5).add(0.5);

  // Still water (EraAir.calm) keeps less of everything that says the sea is
  // moving: the foam, the swell, the ripples, and the green of the shallows,
  // which a lake under mist does not have.
  const moving = float(1).sub(calm);
  const shallow = mix(colour.mul(1.18), colourUniform(SHORE_PALETTE.shallow), moving.mul(0.25).add(0.17));
  let surface = mix(shallow, colour.mul(0.94), smoothstep(0, SHORE.shallowM, fromBankM));
  const foam = float(1).sub(
    smoothstep(SHORE.foamM * 0.3, lap.mul(SHORE.lapM).add(SHORE.foamM), fromBankM.add(fray.mul(0.8))),
  );
  surface = mix(surface, colourUniform(SHORE_PALETTE.foam), foam.mul(moving.mul(0.7).add(0.08)));
  surface = surface.mul(swell.mul(moving.mul(0.04).add(0.01)).add(1));
  // Still water holds the sky when it is looked at from low down, and less
  // and less of it the more steeply it is looked into: a mirror at the eye's
  // own height, its own colour from above. Only still water: at calm 0 this
  // is nothing, and a moving sea is as it was.
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const grazing = pow(float(1).sub(clamp(toEye.y, 0, 1)), 3);
  const still = grazing.mul(calm).mul(0.85);
  if (banked) {
    // A still lake does not mirror only the sky. Seen from its bank, the
    // reflected ray rises as steeply as the eye looks down, and for most of
    // the water it meets the trees on the far side before it clears them:
    // the water is dark with the far bank upside down in it, and only near
    // the eye, where the eye looks down steeply, is it sky. Worked out
    // against a ring of trees round the lake's own circle.
    const B = BANK_MIRROR;
    const flat = positionWorld.xz.sub(cameraPosition.xz);
    const run = length(flat).max(0.01);
    const along = flat.div(run);
    const rise = cameraPosition.y.sub(positionWorld.y).max(0.01).div(run);
    const offset = positionWorld.xz.sub(banked.lake.xy);
    const b = along.dot(offset);
    const c = offset.dot(offset).sub(banked.lake.z.mul(banked.lake.z));
    const onward = b.negate().add(b.mul(b).sub(c).max(0).sqrt()).max(0);
    const hit = positionWorld.xz.add(along.mul(onward));
    // The line of the tree tops: rounded crowns on a rolling line, two sizes of noise.
    const treesM = mx_noise_float(hit.div(B.noiseM))
      .mul(B.jitterM)
      .add(mx_noise_float(hit.div(B.crownM)).mul(B.crownJitterM))
      .add(B.heightM);
    const up = onward.mul(rise);
    const trees = float(1).sub(smoothstep(treesM.mul(0.78), treesM, up));
    // Their feet are darker than their crowns, and the far bank is further
    // into the haze than the water is.
    const wall = mix(colourUniform(B.foot), colourUniform(B.crown), up.div(treesM).clamp(0, 1));
    const haze = smoothstep(B.hazeFromM, B.hazeToM, run.add(onward));
    surface = mix(surface, mix(sky, mix(wall, sky, haze.mul(B.hazeShare)), trees), still);
  } else {
    surface = mix(surface, sky, still);
  }
  material.colorNode = surface.mul(cloudShadow());
  // Small moving ripples tilt the surface a few degrees either way, so the
  // highlight breaks into glitter instead of lying on the sea as one disc.
  const wavelets = mx_noise_vec3(
    positionWorld.xz.mul(0.32).add(vec2(weatherTime.mul(0.23), weatherTime.mul(-0.17))),
  );
  const ripple = moving.mul(0.06).add(0.015);
  material.normalNode = transformNormalToView(normalize(vec3(wavelets.x.mul(ripple), 1, wavelets.y.mul(ripple))));
  return material;
}

/**
 * The lakes an era keeps inside its town (world/plan.ts Lake), with the same
 * water as the sea and a band of pale stone round each. One mesh for all of
 * them. Rings from the edge in to the middle carry each point's distance
 * from the bank, which is what the water spends on its shallows.
 */
/**
 * What still water shows of the bank across it (`waterMaterial`): trees about
 * this tall, give or take, their feet and their crowns, and how far off the
 * far bank goes into the haze.
 */
export const BANK_MIRROR = {
  heightM: 11,
  jitterM: 3,
  noiseM: 16,
  crownM: 4.5,
  crownJitterM: 1.6,
  foot: 0x2f3b2c,
  crown: 0x5a6b4c,
  hazeFromM: 60,
  hazeToM: 700,
  hazeShare: 0.75,
} as const;

export const LAKE_LOOK = {
  segments: 96,
  /** From the edge in, as shares of the way to the middle. */
  rings: [0, 0.12, 0.3, 0.55, 0.8] as const,
  /**
   * The stones round a lake, how wide. Grey and a little green, as stones at
   * a water's edge are: pale and even, the edge read as the coping of a pool.
   */
  edgeM: 1.5,
  edge: 0xaeab9b,
} as const;

function lakeGeometry(lakes: readonly Lake[]): BufferGeometry {
  const positions: number[] = [];
  const fromBank: number[] = [];
  const which: number[] = [];
  const index: number[] = [];
  const S = LAKE_LOOK.segments;
  for (const lake of lakes) {
    const base = positions.length / 3;
    const rings = LAKE_LOOK.rings;
    for (const share of rings) {
      for (let i = 0; i < S; i++) {
        const t = (i / S) * Math.PI * 2;
        const edge = lakeRadiusAt(lake, t);
        const r = edge * (1 - share);
        positions.push(lake.x + Math.cos(t) * r, LAYER_Y.water, lake.z + Math.sin(t) * r);
        fromBank.push(edge * share);
        which.push(lake.x, lake.z, lake.radiusM);
      }
    }
    const middle = base + rings.length * S;
    positions.push(lake.x, LAYER_Y.water, lake.z);
    fromBank.push(lake.radiusM);
    which.push(lake.x, lake.z, lake.radiusM);
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let i = 0; i < S; i++) {
        const a = base + ring * S + i;
        const b = base + ring * S + ((i + 1) % S);
        const c = base + (ring + 1) * S + i;
        const d = base + (ring + 1) * S + ((i + 1) % S);
        // Counter-clockwise seen from above, so the faces point up.
        index.push(a, c, b, b, c, d);
      }
    }
    const last = base + (rings.length - 1) * S;
    for (let i = 0; i < S; i++) index.push(last + i, middle, last + ((i + 1) % S));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('fromBank', new BufferAttribute(new Float32Array(fromBank), 1));
  geometry.setAttribute('lake', new BufferAttribute(new Float32Array(which), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function lakeEdgeGeometry(lakes: readonly Lake[]): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const S = LAKE_LOOK.segments;
  for (const lake of lakes) {
    const base = positions.length / 3;
    for (let i = 0; i < S; i++) {
      const t = (i / S) * Math.PI * 2;
      const edge = lakeRadiusAt(lake, t);
      // From a little under the water's edge out onto the land.
      for (const r of [edge - 0.6, edge + LAKE_LOOK.edgeM]) {
        positions.push(lake.x + Math.cos(t) * r, LAYER_Y.bank, lake.z + Math.sin(t) * r);
      }
    }
    for (let i = 0; i < S; i++) {
      const a = base + i * 2;
      const b = base + i * 2 + 1;
      const c = base + ((i + 1) % S) * 2;
      const d = base + ((i + 1) % S) * 2 + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Sand along a coast, or a strip of mud along each bank of a river, fading
 * into the land behind it along a ragged line. Wet and darker at the water's
 * edge, the way a beach is below the high-tide line.
 *
 * Drawn before the roads, which are transparent too: a road that runs down to
 * the water crosses the sand, never the other way about.
 */
function createBanks(terrain: TerrainSpec): Mesh<BufferGeometry, MeshLambertNodeMaterial> {
  const water = terrain.water;
  const centre = waterCentreline(water);
  const bankM = SHORE.bankM[water.kind];
  // Each strip runs from the land side (across 0) to under the water (across 1).
  const strip = (landM: number, wetM: number): BufferGeometry => {
    const land = offsetLine(water, centre, landM);
    const wet = offsetLine(water, centre, wetM);
    const geometry = ribbonGeometry(land, wet, LAYER_Y.bank);
    geometry.setAttribute('across', acrossAttribute(Math.min(land.length, wet.length)));
    return geometry;
  };
  const strips =
    water.kind === 'river'
      ? [
          strip(-water.halfWidthM - bankM, -water.halfWidthM + SHORE.bankUnderM),
          strip(water.halfWidthM + bankM, water.halfWidthM - SHORE.bankUnderM),
        ]
      : [strip(-bankM, SHORE.bankUnderM)];
  const geometry = strips.length === 1 ? strips[0] : mergeGeometries(strips);
  if (!geometry) throw new Error('the banks did not merge');

  const material = new MeshLambertNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  const across = varying(attribute('across', 'float'));
  const dry = colourUniform(water.kind === 'coast' ? SHORE_PALETTE.sand : SHORE_PALETTE.mud);
  const wetLine = 1 - SHORE.bankUnderM / (bankM + SHORE.bankUnderM);
  const wet = smoothstep(wetLine - 0.28, wetLine, across);
  material.colorNode = mix(dry, colourUniform(SHORE_PALETTE.wetSand), wet.mul(0.85)).mul(cloudShadow());
  const ragged = mx_noise_float(positionWorld.xz.mul(0.045)).mul(0.22);
  material.opacityNode = smoothstep(0.05, 0.55, across.add(ragged));

  const mesh = new Mesh(geometry, material);
  mesh.name = 'banks';
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * How much the bare ground varies inside one field or one yard: worn patches,
 * damp patches, grass coming and going. Without it every block between the
 * buildings was a single flat tint and read as a board the houses were glued
 * to. Two sizes, both far larger than a pixel from anywhere the town is seen,
 * so neither needs fading by altitude.
 */
export const GROUND_GRAIN = {
  patchScaleM: 24,
  patch: 0.08,
  grainScaleM: 7,
  grain: 0.035,
} as const;

/** The land's own colour: town ground in the middle, fields beyond it. */
function landColour(terrain: TerrainSpec, town: ColourUniform, country: ColourUniform) {
  const base = mix(town, country, townToCountry(terrain.cityRadiusM));
  const tone = fieldTone(terrain.cityRadiusM);
  const pale = base.mul(1 + FIELDS.spread);
  const deep = base.mul(1 - FIELDS.spread);
  const fields = mix(base, mix(deep, pale, tone.mul(0.5).add(0.5)), tone.abs());
  const patch = mx_noise_float(positionWorld.xz.div(GROUND_GRAIN.patchScaleM));
  const grain = mx_noise_float(positionWorld.xz.div(GROUND_GRAIN.grainScaleM));
  return fields.mul(patch.mul(GROUND_GRAIN.patch).add(grain.mul(GROUND_GRAIN.grain)).add(1));
}

/**
 * The high country: one mesh, eighty-six thousand triangles, one draw call.
 *
 * It replaced seventy-six seven-sided cones. Its shape is `landscape.ts`; what
 * is here is how it is coloured, which is by what the ground would actually
 * be at that height and angle rather than by a flat tint per mountain. The
 * lowland is the era's own fields. Above that, forest. Where the slope is too
 * steep to hold soil, bare rock, whatever the height. Above the tree line,
 * more rock. At the top, snow, except on faces too steep for it to lie.
 *
 * Smooth-shaded where everything in the town is faceted, on purpose. At this
 * distance, under the tilt shift, a smooth landscape reads as the modelled
 * baseboard the miniature town is standing on, which is the look.
 */
function createLandscape(
  grid: LandscapeGrid,
  terrain: TerrainSpec,
  town: ColourUniform,
  country: ColourUniform,
): Mesh<BufferGeometry, MeshLambertNodeMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.positions, 3));
  geometry.setIndex(new BufferAttribute(grid.index, 1));
  geometry.computeVertexNormals();

  const material = new MeshLambertNodeMaterial();
  const h = positionWorld.y;
  const top = Math.max(1, grid.maxHeightM);
  const high = h.div(top);
  const steep = float(1).sub(clamp(normalWorld.y, 0, 1));
  // Two sizes of mottling, so no slope is one flat colour: stands of trees,
  // scree, patches where the snow has gone.
  const coarse = mx_noise_float(positionWorld.xz.mul(0.011)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.xz.mul(0.035)).mul(0.5).add(0.5);

  const forest = mix(colourUniform(GROUND_PALETTE.forest), colourUniform(GROUND_PALETTE.forestLight), coarse);
  const rock = mix(colourUniform(GROUND_PALETTE.rockDark), colourUniform(GROUND_PALETTE.rock), fine);
  const snow = colourUniform(GROUND_PALETTE.snow);

  let colour = mix(landColour(terrain, town, country), forest, smoothstep(4, 60, h));
  // Too steep to hold soil: rock, at any height.
  colour = mix(colour, rock, smoothstep(0.38, 0.62, steep));
  // Above the tree line.
  colour = mix(colour, rock, smoothstep(0.4, 0.6, high).mul(0.75));
  // Snow on the tops, broken up by the mottling, and never on a cliff face.
  const snowLine = smoothstep(0.6, 0.76, high.add(fine.sub(0.5).mul(0.08)));
  colour = mix(colour, snow, snowLine.mul(float(1).sub(smoothstep(0.42, 0.7, steep))));
  material.colorNode = colour.mul(cloudShadow());

  const mesh = new Mesh(geometry, material);
  mesh.name = 'landscape';
  mesh.receiveShadow = true;
  // It would cast into a shadow map that only covers the 520 m round the
  // look-at point, which the hills are almost never inside, and nothing is
  // culled: casting cost eighty-six thousand triangles a frame for nothing.
  mesh.castShadow = false;
  // A hair above the land disc where the two meet on the plain's edge.
  mesh.position.y = LAYER_Y.ground + 0.02;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A flat strip between two lines of points, lying at height `y` with normals
 * pointing up. The winding is checked once and reversed if needed, so callers
 * do not have to reason about which side is "inner".
 */
export function ribbonGeometry(
  inner: ReadonlyArray<{ x: number; z: number }>,
  outer: ReadonlyArray<{ x: number; z: number }>,
  y: number,
): BufferGeometry {
  const count = Math.min(inner.length, outer.length);
  const positions = new Float32Array(count * 6);
  const normals = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const a = inner[i];
    const b = outer[i];
    if (!a || !b) continue;
    positions.set([a.x, y, a.z, b.x, y, b.z], i * 6);
    normals.set([0, 1, 0, 0, 1, 0], i * 6);
  }
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const v = i * 2;
    index.push(v, v + 1, v + 3, v, v + 3, v + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(facesUp(positions, index) ? index : reverseTriangles(index));
  geometry.computeBoundingSphere();
  return geometry;
}

function facesUp(positions: Float32Array, index: readonly number[]): boolean {
  const i0 = index[0];
  const i1 = index[1];
  const i2 = index[2];
  if (i0 === undefined || i1 === undefined || i2 === undefined) return true;
  const ux = (positions[i1 * 3] ?? 0) - (positions[i0 * 3] ?? 0);
  const uz = (positions[i1 * 3 + 2] ?? 0) - (positions[i0 * 3 + 2] ?? 0);
  const vx = (positions[i2 * 3] ?? 0) - (positions[i0 * 3] ?? 0);
  const vz = (positions[i2 * 3 + 2] ?? 0) - (positions[i0 * 3 + 2] ?? 0);
  // y component of the cross product of the two edges
  return uz * vx - ux * vz > 0;
}

function reverseTriangles(index: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < index.length; i += 3) {
    out.push(index[i + 2] ?? 0, index[i + 1] ?? 0, index[i] ?? 0);
  }
  return out;
}
