import { MODERN_THOUGHTS } from '@/thoughts/content';
import { ERA_POPULATION } from '@/world/eras/population';
import type { Era, EraBuild, EraPalette, VehicleProfile } from '@/world/eras';
import { MODERN_LOTS } from '@/world/lots';
import { parcelSteps } from '@/world/parcels';
import { buildParks, type ParkStyle } from '@/world/parks';
import { planSteps, type ParcelStyle, type PlanStyle } from '@/world/plan';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import type { Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';

/**
 * The city the viewer lives in: a centre of towers round a square, a ring
 * boulevard where the old walls would have been, main roads out through the
 * country, and between them districts of every age: an old quarter of tube
 * houses on winding lanes, planned grids lined up on the road they grew from,
 * estates of large blocks, suburbs of closes. The plan is `MODERN_PLAN`; 2300
 * is built on the same one.
 */
/**
 * A real city from six hundred metres. Two things matter and pull against each
 * other. Nothing may sit below about 0x60, because a shaded side takes roughly
 * half the value and anything darker than that goes to mud, which is what the
 * first version of this palette did. But very little is saturated either: an
 * aerial photograph of a city is grey, beige and dark green, and colour turns
 * up only in terracotta roofs, a painted wall and the odd rusted sheet.
 *
 * So the separation between uses is carried by value and by hue that is barely
 * there, not by strong colour.
 */
const PALETTE: EraPalette = {
  townGround: 0x8a8577,
  land: 0x7e9155,
  water: 0x4a86ac,
  road: 0x6b6f77,
  pavement: 0x9a978d,
  roof: 0x9aa0a8,
  canopy: 0x4a7038,
  trunk: 0x64513e,
  lampOn: 0xffd79a,
  courtyardChance: 0.18,
  canopyScale: 1.25,
  canopyRound: 0x5c7a3e,
  roundShare: 0.45,
  bush: 0x557f3c,
  bushesPerTree: 0.7,
  streetTrees: { share: 0.62, spacingM: 10.5 },
  marks: {
    kind: 'paint',
    line: 0xe6e4dc,
    centre: 0xdcb04a,
    ink: 0.82,
    centreInk: 0,
    // Crossings at the junctions with lights, and at a share of the rest.
    crossingShare: 0.42,
  },
  lamps: true,
  windowsLit: 0.42,
  windowGlow: 0.85,
  // Warm white: a room with a lamp in it.
  windowTint: [1.0, 0.82, 0.48],
  building: {
    // Downtown: concrete, weathered render and glass.
    work: [0xbcc4cc, 0x9fabb6, 0xd2d8de, 0x86a0b4, 0xafbdc8],
    // The low-rise: washed render in beige and grey, which is what a street of
    // tube houses actually looks like from above.
    home: [0xd8c9ad, 0xc2b294, 0xdcd6c2, 0xb0b4a4, 0xc9bca4, 0xbcc4b8],
    market: [0xd8bd8c, 0xc5a97a, 0xe2cca2],
    temple: [0xb87755, 0xa66849],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xfaf6ee, 0xe8d4b4, 0x9cc0dc, 0xe8806a, 0x7f92a4, 0xf0d89a, 0xb69ad4, 0xa8c48e],
};

const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 4.4,
    heightM: 1.5,
    widthM: 1.8,
    speedMS: { min: 9, max: 14 },
    colours: [0xf0ece2, 0xcdd2d8, 0xa8b3bf, 0xdfd0bb, 0x9aacb6, 0xc9604f],
  },
  minor: {
    lengthM: 1.9,
    heightM: 1.15,
    widthM: 0.7,
    speedMS: { min: 8, max: 13 },
    colours: [0xa3aab2, 0xc0b2a1, 0x8d959e, 0xcfc0aa],
  },
  // Two thirds scooters. This is Vietnam (PLAN.md M2 task 6).
  minorShare: 0.66,
  density: 1,
};

/**
 * Roofs for 2020: tile on the low-rise that still has it, tar decks inside
 * parapets on everything else, stair housings and water tanks, and a stepped
 * crown on anything tall.
 */
const ROOF_STYLE: RoofStyle = {
  // Weathered terracotta and rusted sheet, not new tile.
  tile: [0xb06b4c, 0x9c5c40, 0xc27c58, 0x8f6c58, 0xa5734e, 0x7e7a70, 0x8a8076],
  grandTile: [0x9c6b52, 0x8b5f48],
  // Tar and gravel. A real flat roof is the darkest thing on a city block,
  // and that is most of what gives an aerial view its texture.
  deck: [0x7a7f86, 0x6c7178, 0x868b92, 0x757a81, 0x8e939a],
  clutter: [0xaab0b8, 0x969ca4, 0xb8bec4],
  pitchedShare: 0.4,
  pitchedMaxM: 17,
  wingShare: 0.34,
  crowns: true,
  crownTint: [0xacb4bc, 0x98a1aa, 0xc0c8d0, 0x8e97a0],
  ledge: { everyM: 9.6, thicknessM: 0.34, overhangM: 0.26, colours: [0xbcc2c8, 0xa6aeb6, 0xcbd0d4] },
  chimney: { share: 0.34, colours: [0xa08a78, 0x8e7c6c, 0xb0a08c] },
  // Roof gardens and solar racks, which is what a 2020 flat roof carries.
  deckTop: { share: 0.3, colours: [0x5c7a44, 0x3c4a60, 0x6c8a50, 0x46566e] },
};

const STREET_STYLE: StreetStyle = {
  wallShare: 0.42,
  wallHeightM: 1.1,
  wallColours: [0x9c968a, 0xaea698, 0x8c8d84, 0xb6ab96],
  parkedShare: 0.55,
  parked: {
    lengthM: 4.3,
    widthM: 1.8,
    heightM: 1.5,
    colours: [0xe4e0d6, 0xb4bcc4, 0x8f9aa4, 0xd0bfa8, 0x7d8c96, 0xba5c4c, 0x46535e],
  },
  poleShare: 0.3,
  poleColour: 0x8a8578,
  furniture: {
    share: 0.72,
    stepM: 11,
    // Timber slats on a dark frame, which is what a city bench is.
    benchColours: [0x8a7a5c, 0x7a6a52, 0x6f7276],
    planterColours: [0x9a9a96, 0x8b8b8e, 0xa8a49b],
    plantColours: [0x4f7a3e, 0x5c8a46, 0x46703a],
    bollardColour: 0x6e747a,
  },
};

/**
 * What sticks out of a 2020 wall. Concrete slab balconies on the flats, a
 * shallow rib on the office towers, and a shopfront band along the bottom of
 * anything on a street. The balcony is the one that matters: a block of flats
 * without them is an office block.
 */
const FACADE_STYLE: FacadeStyle = {
  balcony: {
    share: 0.74,
    everyM: 3.6,
    perFloor: 2,
    depthM: 1.15,
    railM: 0.92,
    colours: [0xb9b5ac, 0xc6c2b8, 0xa9a59d],
    // Pale metal and glass. A dark rail against a pale wall does not read as
    // a railing at all: it reads as a hole punched in the building.
    railColours: [0xa8b0b8, 0x99a2ab, 0xb6bec6],
  },
  pilaster: {
    fromM: 22,
    share: 0.62,
    widthM: 0.42,
    depthM: 0.3,
    spacingM: 4.2,
    colours: [0xcfcbc2, 0xbdb9b1, 0xdad6cd],
  },
  shopfront: {
    share: 0.66,
    heightM: 3.9,
    canopyDepthM: 1.5,
    colours: [0x6f7378, 0x5e6266, 0x7d8186],
    canopyColours: [0xc4643f, 0x3f6b7d, 0xb8ab7a, 0x5a7a52],
  },
};

/**
 * Grass, pale paving, and a fountain in the middle with benches round it: the
 * municipal park, which every town of this size has one of in each district.
 */
const PARK_STYLE: ParkStyle = {
  lawn: [0x6e9a4a, 0x76a150, 0x699343],
  path: 0xc9bfa6,
  centre: 'fountain',
  stone: 0xbdb6a8,
  water: 0x5a9cc0,
  flowers: [0xd8495f, 0xf2c94c, 0xe07b39, 0xb05fc4],
  bench: 0x7a5a3c,
};

/** Tube houses: a shopfront wide, built back to back until the block is full. */
const TUBE: ParcelStyle = {
  frontM: [4.2, 7],
  depthM: [12, 18],
  setbackM: 0.6,
  gapM: [0, 0.4],
  fill: 0.97,
  annexChance: 0.25,
  backfill: 0.9,
};
/** Shops and flats of three to eight storeys, the stuff of a planned grid. */
const MID: ParcelStyle = {
  frontM: [7, 13],
  depthM: [13, 19],
  setbackM: 1.2,
  gapM: [0.3, 1.2],
  fill: 0.96,
  annexChance: 0.2,
  backfill: 0.85,
};
/** Slabs and yards on the big blocks. */
const LARGE: ParcelStyle = {
  frontM: [14, 26],
  depthM: [15, 24],
  setbackM: 2.5,
  gapM: [1, 2.5],
  fill: 0.94,
  annexChance: 0.1,
  backfill: 0.8,
};
/** Detached houses with gardens, which the backs are left as. */
const HOUSE: ParcelStyle = {
  frontM: [10, 14],
  depthM: [9, 13],
  setbackM: 3,
  gapM: [2, 4.5],
  fill: 0.92,
  annexChance: 0.35,
  backfill: 0.15,
};
/** Towers on their own plots, downtown. */
const TOWER: ParcelStyle = {
  frontM: [20, 32],
  depthM: [20, 30],
  setbackM: 2,
  gapM: [1.5, 4],
  fill: 0.97,
  annexChance: 0,
  backfill: 0.7,
};
/** Farmhouses strung out along the country roads. */
const FARM: ParcelStyle = {
  frontM: [12, 18],
  depthM: [11, 15],
  setbackM: 4,
  gapM: [16, 50],
  fill: 0.55,
  annexChance: 0.5,
  backfill: 0,
};

/**
 * How 2020 is laid out (world/plan.ts). The centre is a tight grid of towers
 * round a square, inside a ring boulevard. Five main roads leave it, bending
 * a little, and run on into the country. Each wedge between two of them is
 * split by a collector street into two districts, each chosen from the four
 * kinds below and each lined up on the main road beside it, which is why two
 * districts meet at an angle along every collector.
 */
export const MODERN_PLAN: PlanStyle = {
  outline: { share: 0.92, wobble: 0.12, fingerM: 60, fingerRad: 0.13 },
  core: {
    radiusAt: (angle) => 112 * (1 + 0.1 * Math.sin(3 * angle + 0.6) + 0.06 * Math.sin(5 * angle - 1.1)),
    pattern: 'grid',
    pitchM: [44, 52],
    acrossM: [46, 56],
    streetM: 10,
    warpM: 1.5,
    warpScaleM: 200,
    turnRad: null,
    dropShare: 0.06,
    parkChance: 0.06,
    parcel: TOWER,
  },
  ring: { offsetM: 0, widthM: 15, kind: 'ring' },
  arterials: { count: 5, widthM: 14, countryWidthM: 8, wanderRad: 0.1, reachM: 120 },
  collectorM: 10,
  districts: [
    {
      name: 'old quarter',
      weight: 1,
      pitchM: [26, 34],
      acrossM: [30, 38],
      grade: 0.3,
      streetM: 6.5,
      warpM: 8,
      warpScaleM: 60,
      dropShare: 0.12,
      deadEndShare: 0.1,
      closeShare: 0,
      skewRad: 0.35,
      parkChance: 0.03,
      parcel: TUBE,
    },
    {
      name: 'grid',
      weight: 1.4,
      pitchM: [38, 48],
      acrossM: [44, 54],
      grade: 0.5,
      streetM: 8,
      warpM: 1.5,
      warpScaleM: 220,
      dropShare: 0.06,
      deadEndShare: 0,
      closeShare: 0,
      skewRad: 0.12,
      parkChance: 0.07,
      parcel: MID,
    },
    {
      name: 'estates',
      weight: 0.8,
      pitchM: [66, 86],
      acrossM: [62, 80],
      grade: 0.3,
      streetM: 10,
      warpM: 3,
      warpScaleM: 160,
      dropShare: 0.1,
      deadEndShare: 0,
      closeShare: 0.2,
      skewRad: 0.25,
      parkChance: 0.12,
      parcel: LARGE,
    },
    {
      name: 'suburb',
      weight: 1,
      pitchM: [90, 130],
      acrossM: [46, 56],
      grade: 0.3,
      streetM: 7,
      warpM: 14,
      warpScaleM: 110,
      dropShare: 0.08,
      deadEndShare: 0.4,
      closeShare: 0.4,
      skewRad: 0.3,
      parkChance: 0.08,
      parcel: HOUSE,
    },
  ],
  shoreRoad: { offsetM: 17, widthM: 12 },
  ribbon: { reachM: 90, parcel: FARM },
  square: { wM: 42, dM: 42, lot: 'park' },
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const plan = yield* planSteps(rng, terrain, MODERN_PLAN);
  const roads = plan.roads;
  yield;
  const lots = yield* parcelSteps(rng, terrain, plan, MODERN_LOTS);
  yield;
  const structures = buildRoofscape(rng, lots, ROOF_STYLE);
  yield;
  structures.push(...buildStreetscape(rng, roads, lots, STREET_STYLE));
  yield;
  structures.push(...buildFacade(rng, lots, FACADE_STYLE));
  structures.push(...buildParks(lots, PARK_STYLE));
  return {
    roads,
    lots,
    structures,
    cityRadiusM: terrain.cityRadiusM,
    // The square in the middle: a step off the path round the fountain.
    landmarks: { square: { x: 0, z: 7, faceX: 0, faceZ: -1 } },
  };
}

export const MODERN_ERA: Era = {
  id: 'modern',
  year: 2020,
  name: 'Modern',
  palette: PALETTE,
  lots: MODERN_LOTS,
  vehicles: VEHICLES,
  thoughts: MODERN_THOUGHTS,
  population: { people: ERA_POPULATION, vehicles: 800 },
  interior: {
    wall: 0xe2ddd2,
    floor: 0xbcb6aa,
    core: 0xa8a49a,
    furniture: [0x8a6f56, 0x6e7b86, 0xb0a48e, 0x53606c, 0x9c8264],
  },
  build,
};
