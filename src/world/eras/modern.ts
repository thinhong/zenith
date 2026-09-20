import { MODERN_THOUGHTS } from '@/thoughts/content';
import type { Era, EraBuild, EraPalette, VehicleProfile } from '@/world/eras';
import { avenueCorridors, buildBlocks, buildLots, MODERN_LOTS } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import type { Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';

/**
 * The city the viewer lives in: a grid with a ring road and three diagonal
 * avenues, towers downtown, homes at the edge. This is the era M1 and M2 were
 * built against; nothing here is new, it has only moved out of the systems and
 * into one place.
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
  lamps: true,
  windowsLit: 0.42,
  windowGlow: 0.85,
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
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const roads = buildRoadGraph(rng, terrain);
  yield;
  const blocks = buildBlocks(terrain);
  yield;
  const lots = buildLots(rng, terrain, blocks, avenueCorridors(roads), MODERN_LOTS);
  yield;
  const structures = buildRoofscape(rng, lots, ROOF_STYLE);
  yield;
  structures.push(...buildStreetscape(rng, roads, lots, STREET_STYLE));
  return { roads, lots, structures, cityRadiusM: terrain.cityRadiusM };
}

export const MODERN_ERA: Era = {
  id: 'modern',
  year: 2020,
  name: 'Modern',
  palette: PALETTE,
  lots: MODERN_LOTS,
  vehicles: VEHICLES,
  thoughts: MODERN_THOUGHTS,
  population: { people: 4000, vehicles: 800 },
  build,
};
