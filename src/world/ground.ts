import { BufferAttribute, BufferGeometry, CircleGeometry, Color, Group, Mesh } from 'three';
import {
  attribute,
  clamp,
  float,
  min,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalize,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial, MeshPhongNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cloudShadow, FIELDS, fieldTone, townToCountry, weatherTime } from '@/world/atmosphere';
import { createForest } from '@/world/forest-mesh';
import { buildForest, buildLandscapeGrid, type LandscapeGrid } from '@/world/landscape';
import { mulberry32 } from '@/world/seed';
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
 * Coplanar surfaces need a little separation or they fight for the same depth.
 * The camera's near plane grows with altitude (core/camera.ts) so these small
 * gaps stay resolvable from 6 km up.
 */
export const LAYER_Y = { ground: 0, bank: 0.15, water: 0.3, pavement: 0.5, road: 0.6 } as const;

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

export interface Ground {
  group: Group;
  /**
   * The land takes two colours from the era, the ground a town stands on and
   * the country beyond it, and the water a third. All three cross-fade when
   * the era changes.
   */
  setColours: (town: Color, country: Color, water: Color) => void;
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
  const landMesh = createLand(terrain, townColour, countryColour);
  const waterMesh = createWater(terrain, waterColour);
  const grid = buildLandscapeGrid(terrain, mulberry32(0x5eed));
  group.add(
    landMesh,
    createBanks(terrain),
    waterMesh,
    createLandscape(grid, terrain, townColour, countryColour),
    createForest(buildForest(terrain, grid, mulberry32(0xf0e5))),
  );

  return {
    group,
    setColours: (nextTown, nextCountry, nextWater) => {
      townColour.value.copy(nextTown);
      countryColour.value.copy(nextCountry);
      waterColour.value.copy(nextWater);
    },
  };
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

  const material = new MeshPhongNodeMaterial();
  // A tight, faint highlight. Broad and bright, it lit a third of the sea
  // white whenever the camera faced the sun, which read as fog, not water.
  material.shininess = 320;
  material.specular = new Color(SHORE_PALETTE.glint);

  const across = varying(attribute('across', 'float'));
  const fromBankM = river
    ? min(across, float(1).sub(across)).mul(water.halfWidthM * 2)
    : across.mul(TERRAIN.waterReachM);
  // Two sizes of noise: a small one that frays the foam line, and a wide slow
  // one that keeps open water from being one flat colour.
  const fray = mx_noise_float(positionWorld.xz.mul(0.07));
  const drift = vec2(weatherTime.mul(0.021), weatherTime.mul(0.013));
  const swell = mx_noise_float(positionWorld.xz.mul(0.022).add(drift));
  const lap = sin(weatherTime.mul((Math.PI * 2) / SHORE.lapS).add(fray.mul(2.2))).mul(0.5).add(0.5);

  const shallow = mix(colour.mul(1.18), colourUniform(SHORE_PALETTE.shallow), 0.42);
  let surface = mix(shallow, colour.mul(0.94), smoothstep(0, SHORE.shallowM, fromBankM));
  const foam = float(1).sub(
    smoothstep(SHORE.foamM * 0.3, lap.mul(SHORE.lapM).add(SHORE.foamM), fromBankM.add(fray.mul(0.8))),
  );
  surface = mix(surface, colourUniform(SHORE_PALETTE.foam), foam.mul(0.78));
  surface = surface.mul(swell.mul(0.05).add(1));
  material.colorNode = surface.mul(cloudShadow());
  // Small moving ripples tilt the surface a few degrees either way, so the
  // highlight breaks into glitter instead of lying on the sea as one disc.
  const wavelets = mx_noise_vec3(
    positionWorld.xz.mul(0.32).add(vec2(weatherTime.mul(0.23), weatherTime.mul(-0.17))),
  );
  material.normalNode = transformNormalToView(
    normalize(vec3(wavelets.x.mul(0.075), 1, wavelets.y.mul(0.075))),
  );

  const mesh = new Mesh(geometry, material);
  mesh.name = 'water';
  return mesh;
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
