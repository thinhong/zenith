import { smoothstep } from '@/state/altitude';
import { AFTER_THOUGHTS } from '@/thoughts/after-content';
import { ERA_POPULATION } from '@/world/eras/population';
import type { Era, EraBuild, EraPalette, EraTree, Structure, VehicleProfile } from '@/world/eras';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import { buildGardenSteps, measureGardenSteps, type GardenStyle } from '@/world/gardens';
import { pointRectDistance, rectOf } from '@/world/geometry2d';
import { buildHouseSteps, type HouseStyle } from '@/world/houses';
import type { LotProfile } from '@/world/lots';
import { parcelSteps } from '@/world/parcels';
import { planSteps, type DistrictStyle, type ParcelStyle, type PlanStyle } from '@/world/plan';
import { range, type Rng } from '@/world/seed';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import type { TerrainSpec } from '@/world/terrain';
import {
  buildHeart,
  buildLakesides,
  buildWaterGardens,
  clearGround,
  wetTest,
  type WaterGardenStyle,
} from '@/world/water-gardens';
import { buildWaterside, type WatersideStyle } from '@/world/waterside';

/**
 * About 2300. A garden town on still water.
 *
 * Nothing here is tall. The town is houses in gardens along narrow lanes
 * that curve with the land, round a great hall on a pond at its heart, with
 * the lanes meeting in small groups of houses and water gardens between them.
 * The houses are of a few kinds and two or three materials: pale plaster,
 * dark boards, warm timber under every roof, dark glass. Some are pavilions
 * under one great roof, some stack an upper floor out over the garden, some
 * are long and gabled, some reach round a court; the workshops sit under
 * folded roofs, the market under an open timber hall, the shrines on stone
 * plinths under deep roofs. Every park is a garden round a pond.
 *
 * The land round it is quieter than any other century's (EraAir): mist on
 * the hills and over the water, a softer sun, water that lies still enough
 * to hold the sky, woods thinned to a tree here and there, and a single
 * broad tree standing alone near the shore. It is the future as a slower
 * place, not a shinier one. Nothing here is chrome.
 *
 * The owner asked for this after the first garden version (24 Sep 2026): to
 * emphasise the landscape, a variety of buildings, to be creative and keep
 * it elegant. Of the spire that version kept: "The tower looks very ugly".
 * Then for lakes inside the town, and for a heart "massive but elegant and
 * beautiful that blends well with the style": the hall on the pond
 * (world/water-gardens.ts buildHeart).
 */

const PALETTE: EraPalette = {
  // Moss between the houses: from above, the town is a garden with pale
  // stone lanes through it.
  townGround: 0x9fa585,
  land: 0x93a86f,
  // The colour of the sky it holds, not of the sea bed.
  water: 0x9db4c6,
  // Lanes of pale stone, and the verge beside them barely paler than the moss,
  // so a lane reads as a path through a garden, not as a road with a pavement.
  road: 0xcbc3b2,
  pavement: 0xb0b294,
  roof: 0x646661,
  canopy: 0x5d8a44,
  // Pale bark, the colour of a stewartia or a snowbell.
  trunk: 0xa39a8c,
  lampOn: 0xffd9a6,
  courtyardChance: 0.94,
  canopyScale: 1,
  // The fresh green of a maple in spring: most of the trees here.
  canopyRound: 0x7fac56,
  // No conifers in a garden like this.
  roundShare: 1,
  bush: 0x5f844a,
  // The planting is in the gardens' beds. A shrub round every tree landed on
  // the verge outside the wall, a green boulder in the way.
  bushesPerTree: 0,
  streetTrees: { share: 0.5, spacingM: 9.5 },
  marks: {
    kind: 'light',
    // Faint by day, and a warm glow along the lanes after dark.
    line: 0xf4e4c4,
    centre: 0xf4e4c4,
    ink: 0.14,
    centreInk: 0,
    crossingShare: 0.2,
  },
  lamps: true,
  windowsLit: 0.52,
  windowGlow: 0.5,
  /** Paper-lantern warm. */
  windowTint: [1.0, 0.85, 0.64],
  building: {
    // Plaster in a few whites and dark boards for the odd house among them.
    // Dark here means about 0x6c, not black: a shaded side keeps about half
    // its value, and anything darker goes to mud (PLAN.md 5).
    work: [0xece7dd, 0xdfd9cd, 0x6f706a, 0xe6e0d4],
    home: [0xefeae1, 0xe6e0d4, 0xdcd5c8, 0x6c6d68, 0xf1ede6, 0xd8cfbf],
    // Paper-white: the stalls under the market halls.
    market: [0xf0e9dc, 0xebe3d4],
    // The shrines, and the great hall on the pond in the middle of town, whose
    // lights after dark are the brightest thing on the water.
    temple: [0xe9e4da, 0xd9d1c3],
    park: [0x000000],
    water: [0x000000],
  },
  // Linen, indigo, sage, charcoal and sand.
  clothes: [0xefe9dd, 0xd8cdb8, 0x5f6b82, 0x8b977a, 0x6f706a, 0xc7b394, 0xa6b0bd, 0xb98c6c],
  multiStemShare: 0.85,
  // A tree here and there out on the meadows, standing alone.
  country: { clumps: 60, perClump: 1 },
  parkGrid: false,
  air: {
    mist: 0.62,
    mistColour: 0xcfdbe7,
    fogNear: 0.5,
    fogFar: 0.62,
    sun: 0.72,
    ambient: 1.18,
    calm: 0.92,
    woods: 0.3,
  },
};

/** Small, slow and quiet. Nothing here is in a hurry. */
const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 3.2,
    heightM: 1.5,
    widthM: 1.6,
    speedMS: { min: 4, max: 6.5 },
    colours: [0xe9e4da, 0x76776f, 0xc9c1b1, 0x8e9a8a],
  },
  minor: {
    lengthM: 2.0,
    heightM: 1.2,
    widthM: 1.0,
    speedMS: { min: 3.5, max: 6 },
    colours: [0xe2dccf, 0x9a958a],
  },
  minorShare: 0.65,
  // Very few: the lanes are for walking.
  density: 0.2,
};

const CEDAR = [0xb3845a, 0xa97a50, 0xbb8d62] as const;
const GLASS = [0x6b7478, 0x677076, 0x707a80] as const;
const STONE = [0xd9d3c7, 0xcfc9bc] as const;

const HOUSE_STYLE: HouseStyle = {
  walls: PALETTE.building,
  plaster: [0xece7dd, 0xe4ddd0, 0xefeae2],
  boards: [0x686963, 0x6e6f69],
  cedar: CEDAR,
  glass: GLASS,
  stone: STONE,
  post: 0x5e605c,
  roof: {
    dark: [0x5f615d, 0x666863, 0x60625e, 0x6b6d67],
    pale: [0xd6cfc1, 0xcdc6b7],
    // A roof of moss, which from above is a patch of the garden lifted up.
    moss: [0x7b8f5a, 0x839a60],
    paleShare: 0.16,
    mossShare: 0.12,
    thicknessM: 0.26,
  },
  shrineRoof: [0x5d6a62, 0x62645f],
  hallRoof: [0x8a7a67, 0x857563],
  homes: { low: { pavilion: 0.34, gabled: 0.24, court: 0.16 }, tall: { stacked: 0.34, gabled: 0.2, court: 0.14 } },
  screen: { share: 0.3, spacingM: 0.16 },
};

const GARDEN_STYLE: GardenStyle = {
  depthM: [1.6, 3.6],
  sideM: 0.9,
  wall: {
    heightM: 2.0,
    lowM: 0.8,
    thicknessM: 0.22,
    gateM: 1.4,
    plaster: [0xe9e4da, 0xe2dcd0, 0xebe7df],
    boards: [0x676862, 0x6d6e68],
    boardShare: 0.3,
  },
  hedge: { share: 0.22, heightM: 1.1, thicknessM: 0.7, colours: [0x587a45, 0x5f8249] },
  openShare: 0.18,
  bed: [0x7f9a5c, 0x86a062, 0x76925a],
  stone: [0xdcd7cc, 0xd2ccc0],
};

const WATER_GARDEN_STYLE: WaterGardenStyle = {
  moss: [0x86a062, 0x7f9a5c, 0x8ba566],
  water: 0x9ab2c3,
  rim: 0xd6d0c4,
  stone: [0xc9c3b6, 0xbfb9ac],
  rock: [0x8f8b83, 0x98948b, 0x85827b],
  gravel: 0xd8d2c6,
  cedar: CEDAR,
  roof: [0x5f615d, 0x666863],
  post: 0x5e605c,
  // Cypress bark, the roof of the old palaces: warm and dark, and one family
  // with the market halls' weathered timber, not a black lid on the water.
  hallRoof: 0x6d5b4b,
  timber: 0x5b4636,
  gold: 0xc9a23f,
  wood: 0x587c42,
  reed: 0x6f8a4c,
  lawn: 0x8c9d70,
  paper: 0xf0e9dc,
  redMaple: 0xb45a3c,
  redShare: 0.12,
};

const WATERSIDE_STYLE: WatersideStyle = {
  deck: [0x9c8b74, 0xa4927a],
  post: 0x5e605c,
  roof: [0x5f615d, 0x666863],
  soffit: CEDAR,
  leaves: 0x55793f,
};

const STREET_STYLE: StreetStyle = {
  // The gardens bring their own walls.
  wallShare: 0,
  wallHeightM: 0.7,
  wallColours: [0xe9e4da],
  parkedShare: 0.04,
  parked: { lengthM: 3.0, widthM: 1.6, heightM: 1.3, colours: [0xe2dccf, 0x8e9a8a] },
  poleShare: 0,
  poleColour: 0x8a8c86,
  furniture: {
    share: 0.4,
    stepM: 14,
    benchColours: CEDAR,
    planterColours: [0xd6d0c4, 0xcac3b6],
    plantColours: [0x6f9a4f, 0x5d8a44, 0x86ad5e],
    bollardColour: 0x8a8c86,
  },
};

/**
 * Houses, not blocks: one storey or two, a workshop a little more, and
 * nothing much taller than it is wide.
 */
const AFTER_LOTS: LotProfile = {
  maxAspect: 1.1,
  weights: (d) => {
    const centre = 1 - smoothstep(0.1, 0.5, d);
    const edge = smoothstep(0.55, 1, d);
    // The big gardens are the blocks kept open (world/plan.ts parkChance) and
    // the lakes; a plot along a lane is mostly a house.
    return {
      work: 0.05 + 0.12 * centre,
      home: 0.68,
      market: 0.03 + 0.04 * centre,
      temple: 0.025,
      park: 0.07 + 0.08 * edge,
    };
  },
  heightFor: (rng, use) => {
    if (use === 'park') return 0;
    if (use === 'work') return range(rng, 4.2, 7.2);
    if (use === 'market') return range(rng, 3.2, 4);
    if (use === 'temple') return range(rng, 6.5, 8.5);
    // One storey or two, about half and half.
    return rng() < 0.5 ? range(rng, 3.4, 4.2) : range(rng, 6, 7.2);
  },
  style: () => 'low',
};

/**
 * Glass on the ground floor, in dark frames, and a short timber canopy over
 * a door. No balconies and no ribs: the variety is in the houses' shapes
 * (world/houses.ts), not in what is stuck to their faces.
 */
const FACADE_STYLE: FacadeStyle = {
  balcony: { share: 0, everyM: 3.2, perFloor: 1, depthM: 1.1, railM: 1, colours: CEDAR, railColours: [0x676862] },
  pilaster: { fromM: 999, share: 0, widthM: 0.3, depthM: 0.3, spacingM: 4, colours: [0xe9e4da] },
  shopfront: {
    share: 0.45,
    heightM: 2.5,
    canopyDepthM: 1.0,
    colours: GLASS,
    canopyColours: CEDAR,
  },
};

/** The middle of town: courtyard houses a little closer together, still behind gardens. */
const COURT: ParcelStyle = {
  frontM: [11, 16],
  depthM: [10, 14],
  setbackM: 4,
  gapM: [2.8, 4.4],
  fill: 0.88,
  annexChance: 0.3,
  backfill: 0.4,
};
/** A house in a garden along a lane. */
const GARDEN_HOUSE: ParcelStyle = {
  frontM: [10, 15],
  depthM: [9, 13],
  setbackM: 4.2,
  gapM: [3.2, 6],
  fill: 0.86,
  annexChance: 0.3,
  backfill: 0.2,
};
/** A few houses together, then open ground. */
const HAMLET: ParcelStyle = {
  frontM: [10, 14],
  depthM: [9, 12],
  setbackM: 4.2,
  gapM: [3, 5],
  fill: 0.72,
  annexChance: 0.35,
  backfill: 0.12,
};
/** Villas among the water meadows, far apart. */
const VILLA: ParcelStyle = {
  frontM: [13, 19],
  depthM: [11, 15],
  setbackM: 5.5,
  gapM: [6, 12],
  fill: 0.66,
  annexChance: 0.45,
  backfill: 0.05,
};

const LANE_M = 5;

const GARDEN_LANES: DistrictStyle = {
  name: 'garden lanes',
  weight: 1.2,
  pitchM: [50, 66],
  acrossM: [40, 52],
  grade: 0.4,
  streetM: LANE_M,
  warpM: 14,
  warpScaleM: 80,
  dropShare: 0.14,
  deadEndShare: 0.25,
  closeShare: 0.3,
  skewRad: 0.45,
  parkChance: 0.16,
  parcel: GARDEN_HOUSE,
};
const HAMLETS: DistrictStyle = {
  name: 'hamlets',
  weight: 1,
  pitchM: [70, 96],
  acrossM: [56, 72],
  grade: 0.5,
  streetM: LANE_M,
  warpM: 22,
  warpScaleM: 110,
  dropShare: 0.22,
  deadEndShare: 0.45,
  closeShare: 0.5,
  skewRad: 0.5,
  parkChance: 0.26,
  parcel: HAMLET,
};
const WATER_MEADOWS: DistrictStyle = {
  name: 'water meadows',
  weight: 0.8,
  pitchM: [96, 130],
  acrossM: [70, 90],
  grade: 0.4,
  streetM: LANE_M,
  warpM: 18,
  warpScaleM: 130,
  dropShare: 0.3,
  deadEndShare: 0.5,
  closeShare: 0.35,
  skewRad: 0.4,
  parkChance: 0.42,
  parcel: VILLA,
};

/**
 * Not 2020's grid. Lanes leave a pond garden in the middle like spokes and
 * are crossed by one ring; outside it each wedge is a different kind of
 * place, the lanes curving with the land, gathering into hamlets, and
 * thinning out into water meadows at the edge. A lane along the shore.
 */
export const AFTER_PLAN: PlanStyle = {
  outline: { share: 0.9, wobble: 0.16, fingerM: 70, fingerRad: 0.16 },
  core: {
    radiusAt: (angle) => 186 * (1 + 0.09 * Math.sin(3 * angle + 1.1) + 0.05 * Math.sin(5 * angle - 0.4)),
    pattern: 'radial',
    pitchM: [30, 30],
    acrossM: [30, 30],
    streetM: LANE_M,
    warpM: 0,
    warpScaleM: 60,
    turnRad: null,
    dropShare: 0,
    parkChance: 0,
    parcel: COURT,
    spokes: 8,
    rings: [0.74],
    alleys: 10,
    greens: 5,
  },
  ring: { offsetM: 0, widthM: 6.5, kind: 'street' },
  arterials: { count: 5, widthM: 7, countryWidthM: 5.5, wanderRad: 0.2, reachM: 110 },
  collectorM: LANE_M,
  districts: [GARDEN_LANES, HAMLETS, WATER_MEADOWS],
  shoreRoad: { offsetM: 26, widthM: LANE_M },
  ribbon: { reachM: 70, parcel: VILLA },
  // The heart of town: a great hall on a pond (world/water-gardens.ts buildHeart).
  square: { wM: 150, dM: 150, lot: null },
  // Three lakes in the town itself, each in the middle of a district, the
  // lanes stopping at the water.
  lakes: { count: 3, radiusM: [38, 66], at: [0.6, 0.86] },
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const plan = yield* planSteps(rng, terrain, AFTER_PLAN);
  const roads = plan.roads;
  yield;
  const town = yield* parcelSteps(rng, terrain, plan, AFTER_LOTS);
  yield;
  // The heart of town first: its rooms are lots, and lots are numbered in order.
  const square = plan.reserves.find((reserve) => reserve.lot === null);
  const heart = square ? buildHeart(rng, square, WATER_GARDEN_STYLE, town.length) : null;
  const lots = [...town, ...(heart?.lots ?? [])];
  // The hall and its towers are not houses and keep no gardens.
  yield* measureGardenSteps(town, roads, GARDEN_STYLE);
  yield;
  const houses = yield* buildHouseSteps(rng, town, roads, HOUSE_STYLE);
  yield;
  const gardens = yield* buildGardenSteps(rng, town, GARDEN_STYLE);
  yield;
  const water = buildWaterGardens(rng, town, WATER_GARDEN_STYLE);
  yield;
  const lakes = buildLakesides(rng, plan.lakes, clearGround(lots, roads), WATER_GARDEN_STYLE);
  yield;
  const shore = buildWaterside(rng, terrain, WATERSIDE_STYLE);
  const structures: Structure[] = [
    ...(heart?.structures ?? []),
    ...houses.structures,
    ...gardens.structures,
    ...water.structures,
    ...lakes.structures,
    ...shore.structures,
  ];
  yield;
  structures.push(...buildStreetscape(rng, roads, town, STREET_STYLE));
  structures.push(...buildFacade(rng, town, FACADE_STYLE));
  const allLakes = heart ? [...plan.lakes, heart.pond] : plan.lakes;
  const wet = wetTest(
    {
      ponds: water.ponds,
      dry: [...water.dry, ...lakes.dry, ...(heart?.dry ?? [])],
      islands: [...water.islands, ...lakes.islands, ...(heart?.islands ?? [])],
    },
    allLakes,
  );
  const trees: EraTree[] = [...(heart?.trees ?? []), ...water.trees, ...lakes.trees, ...shore.trees];
  return {
    roads,
    lots,
    structures,
    cityRadiusM: terrain.cityRadiusM,
    barriers: [...houses.barriers, ...gardens.barriers, ...water.barriers, ...lakes.barriers, ...(heart?.barriers ?? [])].map(rectOf),
    landmarks: { pavilion: heart?.lookout ?? { x: 0, z: 50, faceX: 0, faceZ: -1 } },
    trees,
    // Nor on the hall's floors, however dry they are.
    treeless: (x, z) => wet(x, z, 1.2) || (heart !== null && heart.floors.some((floor) => pointRectDistance(x, z, floor) < 1)),
    wet: (x, z) => wet(x, z, 0.1),
    lakes: allLakes,
  };
}

export const AFTER_ERA: Era = {
  id: 'after',
  year: 2300,
  name: 'After',
  palette: PALETTE,
  lots: AFTER_LOTS,
  vehicles: VEHICLES,
  thoughts: AFTER_THOUGHTS,
  population: { people: ERA_POPULATION, vehicles: 200 },
  interior: {
    wall: 0xf1ede5,
    floor: 0xc8a77e,
    core: 0xb7b0a2,
    furniture: [0x8b6b4e, 0x6d7a5a, 0xd9d1c1, 0x6a6b66, 0xb4855b],
  },
  build,
};
