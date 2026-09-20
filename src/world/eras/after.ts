import { smoothstep } from '@/state/altitude';
import { AFTER_THOUGHTS } from '@/thoughts/after-content';
import type { Era, EraBuild, EraPalette, Structure, VehicleProfile } from '@/world/eras';
import {
  avenueCorridors,
  buildBlocks,
  buildLots,
  type Lot,
  type LotProfile,
} from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { range, type Rng } from '@/world/seed';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import type { TerrainSpec } from '@/world/terrain';

/**
 * About 2300. The same streets, three hundred years after the last of the
 * traffic.
 *
 * The plan is 2020's, because a road grid outlives everything built along it:
 * that is the point of the era, and it is why the layout is not regenerated.
 * What changes is what happened to it. Most buildings are gone and what is
 * left has sunk and is half under growth, the water stands higher than it did,
 * a few hundred people live in what still has a roof, and nothing drives.
 *
 * It is the quiet end of the dial, so almost everything here is a reduction:
 * fewer lots, lower, greener, and no vehicles worth the name.
 */

const AFTER = {
  /** Share of 2020's buildings still standing at all. */
  standingShare: 0.38,
  /** How far a survivor has sunk into the ground, as a share of its height. */
  sinkMin: 0.15,
  sinkMax: 0.55,
  /** Share of empty plots that have gone back to trees. */
  thicketShare: 0.62,
} as const;

const PALETTE: EraPalette = {
  // The tarmac has gone under, so the ground between buildings is not much
  // different from the country around it.
  townGround: 0x7a8a52,
  land: 0x7e9155,
  water: 0x4c88ae,
  road: 0x76804f,
  pavement: 0x8a8f66,
  roof: 0x8a8f7e,
  canopy: 0x467038,
  trunk: 0x5c4c3a,
  lampOn: 0x000000,
  // Everything is overgrown, so a yard tree is the rule rather than a mark
  // of a house that has one.
  courtyardChance: 0.92,
  canopyScale: 1.7,
  canopyRound: 0x527e3c,
  roundShare: 0.62,
  bush: 0x5a8442,
  bushesPerTree: 1.2,
  lamps: false,
  // A handful of windows, by firelight. Nothing is on the grid.
  windowsLit: 0.05,
  windowGlow: 0.22,
  building: {
    // Concrete that has been out in the weather for three centuries: stained,
    // greened at the base, bleached at the top.
    work: [0x9aa094, 0x87907f, 0xa8ab9c, 0x76806e, 0x929a8a],
    home: [0xa8a690, 0x93917e, 0xb2b09a, 0x8a8c78, 0x9e9c86],
    market: [0x9c9a82, 0x8c8a74],
    temple: [0x8e7a62, 0x7d6b55],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xd8cdb4, 0xb8a98c, 0x8e9a72, 0xc6b89c, 0x9d8f76, 0xcfc4a8, 0x7f8a66],
};

/** Nothing drives. A handcart is the largest thing that moves. */
const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 1.8,
    heightM: 0.9,
    widthM: 0.9,
    speedMS: { min: 1.0, max: 1.5 },
    colours: [0x8a7a5c, 0x756548],
  },
  minor: {
    lengthM: 1.1,
    heightM: 0.7,
    widthM: 0.6,
    speedMS: { min: 0.9, max: 1.3 },
    colours: [0x7e6f52, 0x6a5c42],
  },
  minorShare: 0.8,
  density: 0.04,
};

const ROOF_STYLE: RoofStyle = {
  // Whatever was to hand: sheet, board, and old tile off the ruins.
  tile: [0x8a7f68, 0x76705c, 0x9a6f52, 0x6e7264, 0x847a62],
  grandTile: [0x9a6f52, 0x8a7f68],
  // A deck that is not maintained is a deck with a wood on it.
  deck: [0x5e6b46, 0x6c7850, 0x54603e],
  clutter: [0x8e9078, 0x7c7e68],
  pitchedShare: 0.62,
  pitchedMaxM: 22,
  wingShare: 0.2,
  crowns: false,
  crownTint: [0x8e9078],
  chimney: { share: 0.55, colours: [0x84796a, 0x6f665a] },
  // Roof gardens, but not on purpose.
  deckTop: { share: 0.8, colours: [0x4e7a3a, 0x5e8a44, 0x446e34] },
};

const STREET_STYLE: StreetStyle = {
  wallShare: 0.5,
  wallHeightM: 1.0,
  wallColours: [0x8c8a72, 0x7a7c64, 0x9a9880],
  // Not parked. Left.
  parkedShare: 0.18,
  parked: { lengthM: 3.4, widthM: 1.6, heightM: 1.1, colours: [0x78806e, 0x6a7264, 0x848a74] },
  poleShare: 0.12,
  poleColour: 0x6e6a58,
};

const AFTER_LOTS: LotProfile = {
  lotsPerBlock: (d) => {
    const t = smoothstep(0.15, 0.55, d);
    return { min: Math.round(2 + 4 * t), max: Math.round(4 + 8 * t) };
  },
  maxAspect: 4.2,
  minLotSideM: 3.5,
  splitFloorM: 8,
  setbackM: 1,
  // Most of it is wood now.
  parkChance: (d) => 0.3 + 0.35 * smoothstep(0.2, 1, d),
  weights: (d) => {
    const centre = 1 - smoothstep(0.2, 0.6, d);
    return {
      work: 0.06 + 0.3 * centre,
      home: 0.5,
      market: 0.05,
      temple: 0.04,
      park: 0.35,
    };
  },
  heightFor: (rng, use, d) => {
    const centre = 1 - smoothstep(0.2, 0.6, d);
    if (use === 'park') return 0;
    if (use === 'work') return range(rng, 8, 22) + 26 * centre;
    return range(rng, 4, 9);
  },
  style: (heightM) => (heightM >= 40 ? 'tower' : heightM >= 16 ? 'slab' : 'low'),
};

/**
 * Takes most of the town away and sinks what is left.
 *
 * A ruin is not a building with a different colour on it. It is shorter than
 * it was, because three hundred years of silt and growth put a metre or two
 * over everything, and there are far fewer of them.
 */
function ruin(rng: Rng, lots: readonly Lot[]): Lot[] {
  const out: Lot[] = [];
  for (const lot of lots) {
    if (lot.use === 'park' || lot.heightM <= 0) {
      out.push({ ...lot, id: out.length });
      continue;
    }
    if (rng() >= AFTER.standingShare) {
      // Gone. The plot goes back to trees, which `props.ts` then plants on it.
      out.push({ ...lot, id: out.length, use: 'park', heightM: 0 });
      continue;
    }
    const sunk = 1 - range(rng, AFTER.sinkMin, AFTER.sinkMax);
    out.push({ ...lot, id: out.length, heightM: Math.max(3, lot.heightM * sunk) });
  }
  return out;
}

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  // The same grid as 2020. A road outlives what was built along it, and that
  // is the whole reason this era is worth showing on the same land.
  const roads = buildRoadGraph(rng, terrain);
  yield;
  const blocks = buildBlocks(terrain);
  yield;
  const lots = ruin(rng, buildLots(rng, terrain, blocks, avenueCorridors(roads), AFTER_LOTS));
  yield;
  const structures: Structure[] = buildRoofscape(rng, lots, ROOF_STYLE);
  yield;
  structures.push(...buildStreetscape(rng, roads, lots, STREET_STYLE));
  return { roads, lots, structures, cityRadiusM: terrain.cityRadiusM };
}

export const AFTER_ERA: Era = {
  id: 'after',
  year: 2300,
  name: 'After',
  palette: PALETTE,
  lots: AFTER_LOTS,
  vehicles: VEHICLES,
  thoughts: AFTER_THOUGHTS,
  population: { people: 900, vehicles: 24 },
  interior: {
    wall: 0xbcb8a4,
    floor: 0x8a8a6a,
    core: 0x7e7e62,
    furniture: [0x6c6a4e, 0x7e7a5c, 0x5c6a44, 0x86805f],
  },
  build,
};
