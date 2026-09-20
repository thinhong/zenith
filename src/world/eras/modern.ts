import { MODERN_THOUGHTS } from '@/thoughts/content';
import type { Era, EraBuild, EraPalette, VehicleProfile } from '@/world/eras';
import { avenueCorridors, buildBlocks, buildLots, MODERN_LOTS } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import type { Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';

/**
 * The city the viewer lives in: a grid with a ring road and three diagonal
 * avenues, towers downtown, homes at the edge. This is the era M1 and M2 were
 * built against; nothing here is new, it has only moved out of the systems and
 * into one place.
 */
const PALETTE: EraPalette = {
  land: 0x4a5540,
  water: 0x1b2f42,
  road: 0x474a50,
  roof: 0x6b635a,
  canopy: 0x3f6034,
  trunk: 0x4a3b2c,
  lampOn: 0xffd79a,
  courtyardChance: 0.04,
  canopyScale: 1,
  lamps: true,
  windowsLit: 0.42,
  windowGlow: 0.85,
  building: {
    work: [0x5d6875, 0x6b7380, 0x4f5a68, 0x737d8a],
    home: [0x8a8175, 0x7d7a72, 0x94897a, 0x6f7a78],
    market: [0x8a7f6a, 0x93866c, 0x7d745f],
    temple: [0x8c5a46, 0x7d4f3e],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xd8dce2, 0xc9bfb2, 0xa9bac6, 0xd08a6e, 0x9aa6b2, 0xe0cfa4, 0xb6a9c2, 0xc3cbb4],
};

const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 4.4,
    heightM: 1.5,
    widthM: 1.8,
    speedMS: { min: 9, max: 14 },
    colours: [0xd6d2c8, 0xb8bcc2, 0x8e97a3, 0xc9b9a6, 0x7a8a93, 0xa8564a],
  },
  minor: {
    lengthM: 1.9,
    heightM: 1.15,
    widthM: 0.7,
    speedMS: { min: 8, max: 13 },
    colours: [0x6e757d, 0x8a7f72, 0x5a6169, 0x9c8f7e],
  },
  // Two thirds scooters. This is Vietnam (PLAN.md M2 task 6).
  minorShare: 0.66,
  density: 1,
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const roads = buildRoadGraph(rng, terrain);
  yield;
  const blocks = buildBlocks(terrain);
  yield;
  const lots = buildLots(rng, terrain, blocks, avenueCorridors(roads), MODERN_LOTS);
  return { roads, lots, structures: [], cityRadiusM: terrain.cityRadiusM };
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
