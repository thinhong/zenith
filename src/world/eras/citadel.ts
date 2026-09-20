import { smoothstep } from '@/state/altitude';
import { CITADEL_THOUGHTS } from '@/thoughts/citadel-content';
import type { Era, EraBuild, EraPalette, Structure, VehicleProfile } from '@/world/eras';
import {
  avenueCorridors,
  buildBlocks,
  buildLots,
  LOTS,
  type Lot,
  type LotProfile,
  type LotUse,
} from '@/world/lots';
import { LAYER_Y } from '@/world/ground';
import { buildRoadGraph, createGraph, largestComponent, type RoadGraph } from '@/world/roads';
import { buildRoofscape, type RoofStyle } from '@/world/roofscape';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import { range, type Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';

/**
 * The citadel, about 1800. The place is Hue: a square walled citadel with a
 * moat and a gate in each side, a smaller enclosure inside it, and a line of
 * halls down the central axis, with the town packed outside the wall.
 *
 * The way it is drawn comes from docs/reference/citadel-style.png: orange-gold
 * tile roofs against violet walls, pale stone courtyards, heavy tree cover.
 * The violet is what makes that picture read, so it is not quietly drifted
 * towards brick red for realism (PLAN.md 5 and the decisions log).
 *
 * Everything is boxes, flattened pyramids and flat quads, like every other era.
 */
/**
 * Hue at about a third of life size. The plan is the real one; the distances
 * are not, because the whole settlement is now 460 m in radius and the real
 * citadel alone is two kilometres across. What matters is that the parts stay
 * in proportion to each other and that a person can walk from the gate to the
 * throne hall inside one slot of the day.
 */
const CITADEL = {
  /** Half the width of the outer wall square, in metres. */
  wallHalfM: 175,
  wallThicknessM: 8,
  wallHeightM: 7,
  /** The opening in the middle of each side. */
  gateWidthM: 20,
  moatWidthM: 16,
  /** The inner enclosure, where the halls are. */
  innerHalfM: 74,
  innerThicknessM: 5,
  innerHeightM: 5,
  /** Grid pitch of the lanes. Tighter than a modern city. */
  pitchM: 26,
  laneWidthM: 4.5,
} as const;

const TILE = {
  lit: 0xf2ac66,
  sun: 0xdc9450,
  shade: 0xc07a3e,
  grey: 0x9aa2ac,
  dull: 0xaf9472,
  dark: 0x7c6d5c,
} as const;
const WALL = { violet: 0x9b87bc, shade: 0x7d6e9c } as const;
const STONE = 0xdcd6bf;
/**
 * The moat, which is not the sea. Standing water under a wall is darker and
 * greener than open water, and using the era's `water` for both made a bright
 * cyan ribbon that shouted louder than the citadel it surrounds.
 */
const MOAT = 0x3f5e63;

const PALETTE: EraPalette = {
  townGround: 0x8a8a5c,
  land: 0x7c9052,
  water: 0x4884a8,
  road: 0x9c8c6e,
  pavement: 0xa89a7e,
  roof: TILE.sun,
  canopy: 0x4a7038,
  trunk: 0x584737,
  lampOn: 0xffcf86,
  // Half the compounds have a tree, which is what the reference is full of.
  courtyardChance: 0.62,
  // Village trees: a mango over the yard is as wide as the house.
  canopyScale: 1.55,
  canopyRound: 0x568038,
  roundShare: 0.55,
  bush: 0x5c8440,
  bushesPerTree: 0.55,
  // No street lighting in 1800.
  lamps: false,
  // Oil lamps, not the grid: a few dim windows, and most of the town dark.
  windowsLit: 0.08,
  windowGlow: 0.3,
  // An oil flame, which is oranger than anything electric.
  windowTint: [1.0, 0.64, 0.26],
  building: {
    // The halls and the gate houses: violet walls under orange tile.
    temple: [WALL.violet, 0x978aa8, 0x7d7290],
    // Offices of the court, plainer but still inside the wall.
    work: [0x8d8397, 0xbeb7a4, 0x9b93a3],
    // The town outside: timber and ochre.
    home: [0xac9576, 0x9c8568, 0xb8a284, 0x948068],
    market: [0xb29c7b, 0xbfab89, 0xa69274],
    park: [0x000000],
    water: [0x000000],
  },
  clothes: [0xdcd7c8, 0xc4b9a2, 0xa1927c, 0xcac0ac, 0xb0a48c, 0xd2cabc, 0x8e8474],
};

const VEHICLES: VehicleProfile = {
  // Ox carts on the lanes, and porters with handcarts.
  major: {
    lengthM: 3.2,
    heightM: 1.7,
    widthM: 1.6,
    speedMS: { min: 1.4, max: 2.2 },
    colours: [0x8a7454, 0x74603f, 0x9b8461],
  },
  minor: {
    lengthM: 1.5,
    heightM: 1.1,
    widthM: 0.8,
    speedMS: { min: 1.1, max: 1.7 },
    colours: [0x7f6d52, 0x6b5a45, 0x94836a],
  },
  minorShare: 0.7,
  // A quiet town: a tenth of the traffic of the modern city.
  density: 0.22,
};

const ROOF_STYLE: RoofStyle = {
  // A town roof is weathered tile in several states, with some grey slate and
  // some dark thatch. All orange reads as a theme park.
  tile: [TILE.sun, TILE.shade, TILE.grey, TILE.dull, TILE.lit, TILE.shade, TILE.grey, TILE.dark],
  // The halls keep the reference's gold, and never take a town roof.
  grandTile: [TILE.lit, TILE.sun],
  deck: [0xa08a6c, 0x92795c, 0xad9878],
  clutter: [0x9e957f],
  // Every building, and the halls are all well under the height cut.
  pitchedShare: 1,
  pitchedMaxM: 40,
  wingShare: 0.34,
  crowns: false,
  crownTint: [STONE],
  ledge: { everyM: 4.2, thicknessM: 0.26, overhangM: 0.3, colours: [0x8f8271, 0xa39683] },
  chimney: { share: 0.12, colours: [0x9c8a72] },
  // A flat roof in 1800 is a drying floor, not a plant room.
  deckTop: { share: 0.4, colours: [0xb8a884, 0xa2986f] },
};

const STREET_STYLE: StreetStyle = {
  // A compound wall round the yard is what a town of 1800 is made of.
  wallShare: 0.6,
  wallHeightM: 1.4,
  wallColours: [0xa89778, 0x97886c, 0xb5a488],
  // Handcarts left at the side of a lane, not parked vehicles.
  parkedShare: 0.22,
  parked: { lengthM: 1.7, widthM: 0.9, heightM: 0.8, colours: [0x8a7458, 0x76603f, 0x9b8461] },
  // No poles: nothing in 1800 carries a wire.
  poleShare: 0,
  poleColour: 0x000000,
  /**
   * 1800 has no street furniture in the municipal sense, so this is what a
   * market street actually has standing on it: a low timber bench outside a
   * shop, a glazed pot with something growing in it, and the stone posts at a
   * gate. Sparser than 2020, because most lanes have none of it.
   */
  furniture: {
    share: 0.44,
    stepM: 13,
    benchColours: [0x7c6d5c, 0x6f5a42, 0x8a7454],
    planterColours: [0xa8865c, 0x8e6b46, 0xb59468],
    plantColours: [0x4a7038, 0x568038, 0x3f6030],
    bollardColour: 0xb0a888,
  },
};

const CITADEL_LOTS: LotProfile = {
  // A town of small compounds, not of city blocks: a house here is about ten
  // metres across, so a block holds a dozen of them with yards between.
  lotsPerBlock: () => ({ min: 4, max: 10 }),
  // Nothing in 1800 is tall, so the limit rarely bites; it stops a shrine on
  // a sliver of a plot from becoming a tower.
  maxAspect: 3.2,
  minLotSideM: 3.2,
  // Twice the minimum side plus the setbacks: a split that happens has to be a
  // split that survives, or the last one of every block is thrown away.
  splitFloorM: 7.5,
  setbackM: 1,
  parkChance: (d) => 0.1 + 0.16 * smoothstep(0.35, 1, d),
  weights: (d) => {
    const court = 1 - smoothstep(0.18, 0.42, d);
    const town = smoothstep(0.3, 0.6, d);
    return {
      // Shrines are rare in the town; the violet is for the precinct.
      temple: 0.012 + 0.44 * court,
      work: 0.06 + 0.3 * court,
      home: 0.1 + 0.62 * town,
      market: 0.06 + 0.12 * (1 - court) * (1 - town * 0.4),
      park: 0.05 + 0.07 * town,
    };
  },
  heightFor: (rng, use, d) => {
    const court = 1 - smoothstep(0.18, 0.45, d);
    switch (use) {
      case 'temple':
        return range(rng, 9, 13) + 5 * court;
      case 'work':
        return range(rng, 5.5, 8.5) + 2 * court;
      case 'home':
        return range(rng, 4, 6.5);
      case 'market':
        return range(rng, 4, 6);
      default:
        return 0;
    }
  },
  // Nothing in 1800 is a tower, so everything draws in the low mesh.
  style: () => 'low',
};

/** Boxes, roofs and flat quads are the whole vocabulary. */
function box(x: number, y: number, z: number, wM: number, hM: number, dM: number, colour: number): Structure {
  return { kind: 'box', x, y, z, wM, hM, dM, rotY: 0, colour };
}

function roof(x: number, y: number, z: number, wM: number, hM: number, dM: number, colour: number): Structure {
  return { kind: 'roof', x, y, z, wM, hM, dM, rotY: 0, colour };
}

function flat(x: number, z: number, wM: number, dM: number, colour: number, y = 0.18): Structure {
  return { kind: 'flat', x, y, z, wM, hM: 1, dM, rotY: 0, colour };
}

/** True while a point is inside the square the wall encloses. */
function insideSquare(x: number, z: number, halfM: number): boolean {
  return Math.max(Math.abs(x), Math.abs(z)) < halfM;
}

/** How near a point on the wall is to the middle of the side it sits on. */
function distanceToGate(x: number, z: number, halfM: number): number {
  return Math.abs(x) > Math.abs(z) ? Math.abs(z) : Math.abs(x);
}

/**
 * Cuts the lanes where the wall stands, leaving only the gates. Both walls are
 * cut in one pass; whatever the water or the wall strands is then dropped, so
 * the graph the walkers use is still one connected piece.
 */
function cutAtWalls(graph: RoadGraph): RoadGraph {
  const kept = graph.edges.filter((edge) => {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) return false;
    for (const wall of [
      { halfM: CITADEL.wallHalfM, gateM: CITADEL.gateWidthM / 2 },
      { halfM: CITADEL.innerHalfM, gateM: CITADEL.gateWidthM / 2 },
    ]) {
      const inA = insideSquare(a.x, a.z, wall.halfM);
      const inB = insideSquare(b.x, b.z, wall.halfM);
      if (inA === inB) continue;
      // Walk the segment to where it meets the wall, then ask if that is a gate.
      let low = 0;
      let high = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        const px = a.x + (b.x - a.x) * mid;
        const pz = a.z + (b.z - a.z) * mid;
        if (insideSquare(px, pz, wall.halfM) === inA) low = mid;
        else high = mid;
      }
      const cx = a.x + (b.x - a.x) * low;
      const cz = a.z + (b.z - a.z) * low;
      // The inner enclosure opens to the south only, like Hue's.
      const southOnly = wall.halfM === CITADEL.innerHalfM;
      if (southOnly && cz < 0) return false;
      if (distanceToGate(cx, cz, wall.halfM) > wall.gateM) return false;
    }
    return true;
  });

  return largestComponent(
    createGraph(
      graph.nodes.map((node) => ({ x: node.x, z: node.z })),
      kept.map((edge) => ({ a: edge.a, b: edge.b, kind: edge.kind, widthM: edge.widthM })),
    ),
  );
}

/** The wall itself: two runs a side with the gate between them. */
function wallStructures(halfM: number, thickM: number, heightM: number, gateM: number, colour: number): Structure[] {
  const out: Structure[] = [];
  const run = halfM - gateM / 2;
  const offset = gateM / 2 + run / 2;
  for (const side of [-1, 1]) {
    for (const along of [-1, 1]) {
      // north and south runs
      out.push(box(along * offset, 0, side * halfM, run, heightM, thickM, colour));
      // east and west runs
      out.push(box(side * halfM, 0, along * offset, thickM, heightM, run, colour));
    }
  }
  return out;
}

/** A gate house: a violet base under two tiers of tile. */
function gateStructures(x: number, z: number, acrossX: boolean, colour: number): Structure[] {
  const w = acrossX ? 22 : 11;
  const d = acrossX ? 11 : 22;
  return [
    box(x, 0, z, w, 8, d, colour),
    roof(x, 8, z, w * 1.35, 3.2, d * 1.35, TILE.sun),
    box(x, 10.6, z, w * 0.6, 3.4, d * 0.6, colour),
    roof(x, 14, z, w * 0.95, 2.6, d * 0.95, TILE.lit),
  ];
}

/**
 * 1800 has no balconies and no plate glass, so the face of a building is a
 * timber verandah post and a deep eave. What is used here is the shopfront
 * alone, read as a shaded timber shop front under the overhang, and a light
 * rib on the few tall halls. Anything more would be importing a century.
 */
const FACADE_STYLE: FacadeStyle = {
  balcony: {
    share: 0,
    everyM: 3.4,
    perFloor: 1,
    depthM: 0.9,
    railM: 0.8,
    colours: [0x8a7454],
    railColours: [0x6b5a45],
  },
  /**
   * At this scale a rib is a verandah post, which is what actually holds up a
   * deep eave on a house of this period, so it starts at three metres rather
   * than at twelve: the town is made of small houses and none of them would
   * otherwise get anything. Timber, spaced as timber is.
   */
  pilaster: {
    fromM: 3,
    share: 0.66,
    widthM: 0.22,
    depthM: 0.19,
    spacingM: 2.6,
    colours: [0x8e3b2e, 0x7c6d5c, 0x94836a, 0x6f5a42],
  },
  shopfront: {
    share: 0.72,
    heightM: 2.6,
    canopyDepthM: 1.7,
    // Dark timber under the overhang, and a cloth awning over the door.
    colours: [0x6f5a42, 0x5d4a37, 0x7c6650],
    canopyColours: [0xc07a3e, 0xa8632f, 0xb08a52],
  },
};

function* build(rng: Rng, terrain: TerrainSpec): EraBuild {
  const shape = { pitchM: CITADEL.pitchM, streetWidthM: CITADEL.laneWidthM, avenueCount: 0, ringWidthM: 9 };
  const grid = buildRoadGraph(rng, terrain, shape);
  yield;
  const roads = cutAtWalls(grid);
  yield;

  const blocks = buildBlocks(terrain, shape).filter((block) => {
    // The precinct is laid out by hand, and nothing stands on the wall.
    if (insideSquare(block.x, block.z, CITADEL.innerHalfM + 13)) return false;
    return !onWall(block.x, block.z);
  });
  yield;

  const lots = buildLots(
    rng,
    terrain,
    blocks,
    avenueCorridors(roads),
    CITADEL_LOTS,
    terrain.cityRadiusM,
  ).filter((lot) => !onWall(lot.x, lot.z));

  // The halls, down the axis, south to north. These are lots so that people
  // walk to them, not scenery.
  const halls: Lot[] = [];
  const add = (x: number, z: number, wM: number, dM: number, heightM: number, use: LotUse): void => {
    halls.push({
      id: lots.length + halls.length,
      x,
      z,
      wM,
      dM,
      use,
      heightM,
      style: 'low',
      jitter: rng(),
    });
  };
  const hallPlan = [
    { z: 46, wM: 40, dM: 16, heightM: 12 },
    { z: 8, wM: 32, dM: 14, heightM: 10.5 },
    { z: -24, wM: 26, dM: 12, heightM: 9 },
    { z: -50, wM: 20, dM: 10, heightM: 8 },
  ];
  for (const plan of hallPlan) {
    add(0, plan.z, plan.wM, plan.dM, plan.heightM, 'temple');
    // Two smaller pavilions flank each hall, which is what fills the enclosure.
    const offset = plan.wM / 2 + 17;
    for (const side of [-1, 1]) {
      add(side * offset, plan.z - 3, 13, 9, plan.heightM * 0.55, 'work');
      add(side * offset, plan.z + 14, 10, 7, plan.heightM * 0.45, 'work');
    }
  }
  // A row of offices along the inside of the enclosure's east and west walls.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      add(side * 58, -56 + i * 28, 11, 14, range(rng, 4.5, 6), 'work');
    }
  }
  const all = [...lots, ...halls].map((lot, index) => ({ ...lot, id: index }));

  yield;

  const structures: Structure[] = [];

  // Moat, then wall, then gates, outermost first.
  const moatMid = CITADEL.wallHalfM + CITADEL.wallThicknessM / 2 + CITADEL.moatWidthM / 2 + 4;
  const moatSpan = moatMid * 2 + CITADEL.moatWidthM;
  // Above the road layer, not below it. At 0.22 the lanes running along the
  // outside of the wall were drawn over the top and cut the moat into a dashed
  // line, which read as a row of blue tiles rather than as water.
  for (const side of [-1, 1]) {
    structures.push(flat(0, side * moatMid, moatSpan, CITADEL.moatWidthM, MOAT, LAYER_Y.road + 0.05));
    structures.push(flat(side * moatMid, 0, CITADEL.moatWidthM, moatSpan, MOAT, LAYER_Y.road + 0.05));
  }

  structures.push(
    ...wallStructures(
      CITADEL.wallHalfM,
      CITADEL.wallThicknessM,
      CITADEL.wallHeightM,
      CITADEL.gateWidthM,
      WALL.violet,
    ),
  );
  for (const side of [-1, 1]) {
    structures.push(...gateStructures(0, side * CITADEL.wallHalfM, true, WALL.violet));
    structures.push(...gateStructures(side * CITADEL.wallHalfM, 0, false, WALL.violet));
  }

  // The inner enclosure, open to the south.
  structures.push(
    ...wallStructures(
      CITADEL.innerHalfM,
      CITADEL.innerThicknessM,
      CITADEL.innerHeightM,
      CITADEL.gateWidthM,
      WALL.shade,
    ),
  );
  structures.push(...gateStructures(0, CITADEL.innerHalfM, true, WALL.shade));

  // Paved courtyards between the halls, and the great forecourt.
  structures.push(flat(0, 27, 46, 22, STONE));
  structures.push(flat(0, -6, 38, 19, STONE));
  structures.push(flat(0, -34, 31, 16, STONE));
  structures.push(flat(0, 63, 36, 26, STONE));
  structures.push(flat(0, 112, 34, 71, STONE));

  yield;

  // Every building gets a ridged tile roof with the eaves hanging past the
  // walls. Nothing in 1800 has a flat deck, a water tank or a crown.
  structures.push(...buildRoofscape(rng, all, ROOF_STYLE));
  yield;
  structures.push(...buildStreetscape(rng, roads, all, STREET_STYLE));
  yield;
  structures.push(...buildFacade(rng, all, FACADE_STYLE));

  return { roads, lots: all, structures, cityRadiusM: terrain.cityRadiusM };
}

function onWall(x: number, z: number): boolean {
  for (const wall of [
    { halfM: CITADEL.wallHalfM, bandM: CITADEL.wallThicknessM / 2 + CITADEL.moatWidthM + 11 },
    { halfM: CITADEL.innerHalfM, bandM: CITADEL.innerThicknessM / 2 + 7 },
  ]) {
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (Math.abs(edge - wall.halfM) < wall.bandM) return true;
  }
  return false;
}

export const CITADEL_ERA: Era = {
  id: 'citadel',
  year: 1800,
  name: 'Citadel',
  palette: PALETTE,
  lots: CITADEL_LOTS,
  vehicles: VEHICLES,
  thoughts: CITADEL_THOUGHTS,
  population: { people: 8000, vehicles: 220 },
  interior: {
    wall: 0xdcd2bc,
    floor: 0x9c8462,
    core: 0x8e7a5c,
    furniture: [0x6f5a3e, 0x84694a, 0x5c4a33, 0x9a8460],
  },
  build,
};

export { CITADEL, LOTS as MODERN_LOT_LIMITS };
