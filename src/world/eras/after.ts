import { smoothstep } from '@/state/altitude';
import { AFTER_THOUGHTS } from '@/thoughts/after-content';
import { ERA_POPULATION } from '@/world/eras/population';
import type { Era, EraBuild, EraPalette, Structure, VehicleProfile } from '@/world/eras';
import { avenueCorridors, buildBlocks, buildLots, type Lot, type LotProfile } from '@/world/lots';
import { buildRoadGraph } from '@/world/roads';
import { buildParks, type ParkStyle } from '@/world/parks';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { range, type Rng } from '@/world/seed';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import type { TerrainSpec } from '@/world/terrain';

/**
 * About 2300. The same land, built high and built light.
 *
 * The plan is still 2020's grid, deliberately: a road outlives everything put
 * up along it, and keeping it is what ties five centuries to one piece of
 * ground. What changed is what stands on it. The centre is slender towers on
 * wide podiums; the edges are low and green; the roofs carry pads and masts
 * rather than tanks and chimneys; and the planting goes up the buildings
 * instead of being squeezed between them.
 *
 * It is a quiet future, not a shining one. Nothing here is chrome. The palette
 * is the pale cool grey of a building that is mostly glass, with planting and
 * one warm accent, and the only thing that moves on the ground is a small
 * unhurried pod.
 */

const PALETTE: EraPalette = {
  // Paving, not tarmac: a surface is a surface and it is light.
  townGround: 0x9aa0a4,
  land: 0x7f9256,
  water: 0x4f93bb,
  road: 0x8d949a,
  pavement: 0xb4bbbe,
  roof: 0xc6ccd0,
  canopy: 0x4f8a48,
  trunk: 0x6b6258,
  lampOn: 0xbfe6ff,
  /**
   * Planting is part of the building here, not a gap left between them, so
   * nearly every plot has something growing on it.
   */
  courtyardChance: 0.72,
  canopyScale: 1.2,
  canopyRound: 0x5f9a52,
  roundShare: 0.7,
  bush: 0x6aa85c,
  bushesPerTree: 1.0,
  streetTrees: { share: 0.86, spacingM: 8.5 },
  marks: {
    kind: 'light',
    line: 0xd6f8ff,
    centre: 0x8ce6ff,
    ink: 0.78,
    centreInk: 0,
    crossingShare: 0.7,
  },
  lamps: true,
  /**
   * Almost every pane is lit and the light is cool and even, because nothing
   * is a bulb in a room any more. From above at night the towers read as
   * lanterns rather than as grids of separate windows.
   */
  windowsLit: 0.58,
  windowGlow: 0.52,
  /**
   * Cool and even, and deliberately weaker than 2020's. Lighting three
   * quarters of the panes at full strength and then putting bloom on top
   * burned the whole city to white, which is the opposite of a quiet future.
   */
  windowTint: [0.82, 0.92, 1.0],
  building: {
    // Glass and pale composite. The separation between uses is barely there,
    // which is itself the look: one material, used everywhere.
    work: [0xdbe4ea, 0xc2d2dd, 0xe8eef2, 0xaec6d6, 0xcfdae2],
    home: [0xe4e6e4, 0xd0d6d6, 0xeceeec, 0xc4ccce, 0xdadedd],
    market: [0xe0e0d4, 0xd2d4c6],
    // The one warm thing in the era, and the only saturated colour in it.
    temple: [0xd28a5a, 0xc07a4c],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xf4f6f6, 0xd8e4ea, 0xbcd2cc, 0xe8a07c, 0x9fb4c4, 0xeee0c4, 0xc4b6da, 0xaecfb4],
};

/** Small, slow and quiet. Nothing here is in a hurry. */
const VEHICLES: VehicleProfile = {
  major: {
    lengthM: 3.4,
    heightM: 1.5,
    widthM: 1.7,
    speedMS: { min: 5, max: 8 },
    colours: [0xe8eef0, 0xc8d6de, 0xa8bcc8, 0xdad4c6],
  },
  minor: {
    lengthM: 2.0,
    heightM: 1.2,
    widthM: 1.0,
    speedMS: { min: 4, max: 7 },
    colours: [0xdfe6ea, 0xb8c8d2],
  },
  minorShare: 0.6,
  // Fewer than 2020 and slower, because most of the moving about is not here.
  density: 0.35,
};

const ROOF_STYLE: RoofStyle = {
  // Nothing is tiled. What little is pitched is a smooth pale shell.
  tile: [0xc8d0d4, 0xb6c0c6, 0xd6dce0],
  grandTile: [0xd28a5a, 0xc07a4c],
  // A roof deck is a surface people use, so it is pale and clean, not tar.
  deck: [0xb2bac0, 0xa2acb4, 0xc0c8cc],
  clutter: [0xd8dee2, 0xc2cace, 0xe6eaec],
  pitchedShare: 0.08,
  pitchedMaxM: 12,
  wingShare: 0.18,
  crowns: true,
  crownTint: [0xdfe6ea, 0xc8d2d8, 0xeef2f4],
  // No fires, so no chimneys.
  ledge: { everyM: 7.2, thicknessM: 0.3, overhangM: 0.34, colours: [0xeef3f6, 0xd4dde2, 0xaec4d0] },
  chimney: { share: 0, colours: [0xc0c8cc] },
  /**
   * Four roofs in five carry something: a garden, a water tank's descendant,
   * or a pad. Green and pale grey rather than tar and rust.
   */
  deckTop: { share: 0.82, colours: [0x5f9a52, 0x4f8a48, 0xc8d2d8, 0x6aa85c] },
};

const STREET_STYLE: StreetStyle = {
  // Low planters edging a plot rather than a wall keeping anyone out.
  wallShare: 0.55,
  wallHeightM: 0.7,
  wallColours: [0xc0c6c8, 0x5f9a52, 0xb4bcc0],
  // Very little is left standing about.
  parkedShare: 0.22,
  parked: { lengthM: 3.0, widthM: 1.6, heightM: 1.3, colours: [0xdfe6ea, 0xc4d0d8] },
  // Slim masts, everywhere, carrying whatever this century carries.
  poleShare: 0.55,
  poleColour: 0xc4ccd0,
  furniture: {
    share: 0.78,
    stepM: 9.5,
    benchColours: [0xc8d2d8, 0xb4bcc0, 0xdfe6ea],
    planterColours: [0xc0c6c8, 0xaeb8bc, 0xd2d8da],
    // More planting than seating: the era puts green on every flat surface.
    plantColours: [0x5f9a52, 0x6aa85c, 0x4f8a48, 0x7ab86a],
    bollardColour: 0xc4ccd0,
  },
};

const AFTER_LOTS: LotProfile = {
  /**
   * The centre is cut into very few, very large plots and the edge into many
   * small ones. That is what puts slender towers on wide podiums downtown and
   * keeps the outskirts low, and it is the opposite of 2020, where the whole
   * town was cut to roughly the same grain.
   */
  lotsPerBlock: (d) => {
    const t = smoothstep(0.12, 0.6, d);
    return { min: Math.round(1 + 6 * t), max: Math.round(2 + 11 * t) };
  },
  // Slimmer than anything 2020 could stand up.
  maxAspect: 7.5,
  minLotSideM: 3.5,
  splitFloorM: 8,
  setbackM: 1.6,
  parkChance: (d) => 0.14 + 0.2 * smoothstep(0.3, 1, d),
  weights: (d) => {
    const centre = 1 - smoothstep(0.15, 0.55, d);
    return {
      work: 0.08 + 0.42 * centre,
      home: 0.52,
      market: 0.1,
      temple: 0.02,
      park: 0.18,
    };
  },
  heightFor: (rng, use, d) => {
    const centre = 1 - smoothstep(0.1, 0.62, d);
    if (use === 'park') return 0;
    if (use === 'work') return range(rng, 14, 34) + 96 * centre * centre;
    if (use === 'market') return range(rng, 6, 14);
    return range(rng, 7, 20) + 34 * centre;
  },
  style: (heightM) => (heightM >= 46 ? 'tower' : heightM >= 16 ? 'slab' : 'low'),
};

const SKYLINE = {
  /** A tower has to be at least this tall to be worth bridging to. */
  bridgeFromM: 55,
  /** And the two ends no further apart than this. */
  bridgeSpanM: 62,
  bridgeWidthM: 3.2,
  bridgeDeckM: 1.1,
  /** How high up the shorter of the pair the deck is strung. */
  bridgeHeight: 0.72,
  bridgeColour: 0xd6e0e6,
  /** The guideway that runs the ring road, and how high it stands. */
  railHeightM: 16,
  railDeckM: 1.6,
  railWidthM: 5.5,
  railColour: 0xc8d4dc,
  pierEveryM: 34,
  pierWidthM: 1.5,
  /** The spire at the centre. */
  spireHeightM: 250,
  spireBaseM: 17,
} as const;

/**
 * The three things that say "future" here, and none of them is a new shape.
 *
 * A bridge strung between two towers, a guideway standing above the ring road,
 * and one spire taller than anything near it. What makes a skyline read as a
 * century is not the buildings, which are boxes in every era: it is whether
 * anything crosses the gaps between them, and whether the eye is given
 * somewhere to stop. 2020 has neither and 2300 now has both.
 */
function skyline(rng: Rng, lots: readonly Lot[], cityRadiusM: number): Structure[] {
  const out: Structure[] = [];

  // --- bridges between neighbouring towers ---------------------------------
  const tall = lots.filter((lot) => lot.heightM >= SKYLINE.bridgeFromM);
  const linked = new Set<number>();
  for (const from of tall) {
    if (linked.has(from.id)) continue;
    let best: Lot | null = null;
    let bestD: number = SKYLINE.bridgeSpanM;
    for (const to of tall) {
      if (to.id === from.id || linked.has(to.id)) continue;
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = to;
      }
    }
    if (!best || rng() < 0.35) continue;
    linked.add(from.id);
    linked.add(best.id);
    const y = Math.min(from.heightM, best.heightM) * SKYLINE.bridgeHeight;
    out.push({
      kind: 'box',
      x: (from.x + best.x) / 2,
      y,
      z: (from.z + best.z) / 2,
      wM: bestD,
      hM: SKYLINE.bridgeDeckM,
      dM: SKYLINE.bridgeWidthM,
      rotY: -Math.atan2(best.z - from.z, best.x - from.x),
      colour: SKYLINE.bridgeColour,
    });
  }

  // --- a guideway above the ring road ---------------------------------------
  const radius = cityRadiusM * 0.82;
  const steps = Math.max(24, Math.round((Math.PI * 2 * radius) / SKYLINE.pierEveryM));
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const span = Math.hypot(x1 - x0, z1 - z0);
    out.push({
      kind: 'box',
      x: (x0 + x1) / 2,
      y: SKYLINE.railHeightM,
      z: (z0 + z1) / 2,
      // A touch longer than the gap, so the segments meet rather than dot.
      wM: span * 1.06,
      hM: SKYLINE.railDeckM,
      dM: SKYLINE.railWidthM,
      rotY: -Math.atan2(z1 - z0, x1 - x0),
      colour: SKYLINE.railColour,
    });
    out.push({
      kind: 'box',
      x: x0,
      y: 0,
      z: z0,
      wM: SKYLINE.pierWidthM,
      hM: SKYLINE.railHeightM,
      dM: SKYLINE.pierWidthM,
      rotY: 0,
      colour: SKYLINE.railColour,
    });
  }

  // --- one spire ------------------------------------------------------------
  const base = SKYLINE.spireBaseM;
  out.push({ kind: 'box', x: 0, y: 0, z: 0, wM: base, hM: SKYLINE.spireHeightM * 0.62, dM: base, rotY: 0, colour: 0xdfe8ee });
  out.push({ kind: 'box', x: 0, y: SKYLINE.spireHeightM * 0.62, z: 0, wM: base * 0.66, hM: SKYLINE.spireHeightM * 0.26, dM: base * 0.66, rotY: Math.PI / 4, colour: 0xeaf1f5 });
  out.push({ kind: 'roof', x: 0, y: SKYLINE.spireHeightM * 0.88, z: 0, wM: base * 0.66, hM: SKYLINE.spireHeightM * 0.06, dM: base * 0.66, rotY: Math.PI / 4, colour: 0xd0dde6 });
  out.push({ kind: 'box', x: 0, y: SKYLINE.spireHeightM * 0.94, z: 0, wM: 1.1, hM: SKYLINE.spireHeightM * 0.16, dM: 1.1, rotY: 0, colour: 0xb8c8d2 });
  // A collar of decks part way up, so it is a building and not a mast.
  for (const at of [0.34, 0.5]) {
    out.push({
      kind: 'box',
      x: 0,
      y: SKYLINE.spireHeightM * at,
      z: 0,
      wM: base * 1.9,
      hM: 1.4,
      dM: base * 1.9,
      rotY: Math.PI / 4,
      colour: 0xc6d4dc,
    });
  }
  return out;
}

/**
 * 2300 puts the planting on the building, so a balcony here is a deep planted
 * terrace with a glass edge rather than a concrete shelf. The ribs run the
 * full height and are the same pale material as the wall: the shadow is the
 * only thing that shows them, which is the look.
 */
const FACADE_STYLE: FacadeStyle = {
  balcony: {
    share: 0.86,
    everyM: 3.5,
    perFloor: 2,
    depthM: 1.6,
    railM: 1.0,
    // The slab reads as planting, because that is what is on it.
    colours: [0x5f9a52, 0x6aa85c, 0x4f8a48, 0xc8d2d8],
    railColours: [0xdfe6ea, 0xc8d2d8, 0xaec6d6],
  },
  pilaster: {
    fromM: 26,
    share: 0.78,
    widthM: 0.36,
    depthM: 0.34,
    spacingM: 3.8,
    colours: [0xe8eef2, 0xd6dee4, 0xf0f4f6],
  },
  shopfront: {
    share: 0.58,
    heightM: 4.4,
    canopyDepthM: 1.9,
    colours: [0xaebcc6, 0x9aa8b4, 0xc0ccd4],
    canopyColours: [0xdfe6ea, 0x5f9a52, 0xd28a5a],
  },
};

/**
 * Lawns kept like carpet, white paths, and a long still pool where 2020 had
 * its fountain. Nothing splashes in 2300; the water only reflects.
 */
const PARK_STYLE: ParkStyle = {
  lawn: [0x7db865, 0x86bf6d, 0x78b25f],
  path: 0xe2e6e4,
  centre: 'pool',
  stone: 0xe8edef,
  water: 0x6ec0d8,
  flowers: [0x9be8d8, 0xf7a8c8, 0xfff0a8],
  bench: 0xdfe6ea,
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const roads = buildRoadGraph(rng, terrain);
  yield;
  const blocks = buildBlocks(terrain);
  yield;
  const lots = buildLots(rng, terrain, blocks, avenueCorridors(roads), AFTER_LOTS);
  yield;
  const structures: Structure[] = buildRoofscape(rng, lots, ROOF_STYLE);
  yield;
  structures.push(...buildStreetscape(rng, roads, lots, STREET_STYLE));
  yield;
  structures.push(...skyline(rng, lots, terrain.cityRadiusM));
  yield;
  structures.push(...buildFacade(rng, lots, FACADE_STYLE));
  structures.push(...buildParks(lots, PARK_STYLE));
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
  // Denser than 2020 on the same ground, because it is built higher.
  population: { people: ERA_POPULATION, vehicles: 300 },
  interior: {
    wall: 0xeef2f4,
    floor: 0xc6ced2,
    core: 0xb0b8be,
    furniture: [0x8fa0ac, 0x6f9a62, 0xc0c8cc, 0xa8b4bc, 0xd28a5a],
  },
  build,
};
