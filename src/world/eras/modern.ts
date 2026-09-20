import { MODERN_THOUGHTS } from '@/thoughts/content';
import type { Era, EraBuild, EraPalette, VehicleProfile } from '@/world/eras';
import { avenueCorridors, buildBlocks, buildLots, MODERN_LOTS } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
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
  townGround: 0x78756a,
  land: 0x6f7a4e,
  water: 0x44637a,
  road: 0x5e6167,
  roof: 0x8d9298,
  canopy: 0x435c34,
  trunk: 0x5a4a3a,
  lampOn: 0xffd79a,
  courtyardChance: 0.18,
  canopyScale: 1.25,
  lamps: true,
  windowsLit: 0.42,
  windowGlow: 0.85,
  building: {
    // Downtown: concrete, weathered render and glass.
    work: [0xa7adb3, 0x8e969e, 0xbcc0c4, 0x78848f, 0x9ba7b2],
    // The low-rise: washed render in beige and grey, which is what a street of
    // tube houses actually looks like from above.
    home: [0xbdb3a2, 0xa89e8e, 0xc9c2b2, 0x9d9a92, 0xb2a897, 0xaeb0a6],
    market: [0xb6a992, 0xa39781, 0xc2b69f],
    temple: [0x9c6b52, 0x8b5f48],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xe8eaec, 0xd6cab6, 0xaec2d2, 0xd2806a, 0xa0aeba, 0xdecb9e, 0xb6aacb, 0xc2cbae],
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
  tile: [0x96604a, 0x855440, 0xa66b4e, 0x7d6354, 0x8e6a4c, 0x6e6a62, 0x7a7168],
  grandTile: [0x9c6b52, 0x8b5f48],
  // Tar and gravel. A real flat roof is the darkest thing on a city block,
  // and that is most of what gives an aerial view its texture.
  deck: [0x6b6f74, 0x5d6166, 0x767a7e, 0x666a6e, 0x7e8286],
  clutter: [0x9aa0a6, 0x868c92, 0xa8aeb2],
  pitchedShare: 0.4,
  pitchedMaxM: 17,
  wingShare: 0.34,
  crowns: true,
  crownTint: [0x9aa2aa, 0x88919a, 0xaeb6bd, 0x7e878f],
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const roads = buildRoadGraph(rng, terrain);
  yield;
  const blocks = buildBlocks(terrain);
  yield;
  const lots = buildLots(rng, terrain, blocks, avenueCorridors(roads), MODERN_LOTS);
  yield;
  const structures = buildRoofscape(rng, lots, ROOF_STYLE);
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
