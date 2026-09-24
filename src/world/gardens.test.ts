import { describe, expect, it } from 'vitest';
import { WALK } from '@/state/altitude';
import { toWorld } from '@/world/frame';
import { buildGardens, gateApproach, measureGardens, type GardenStyle } from '@/world/gardens';
import { rectsOverlap, segmentRectDistance, type OrientedRect } from '@/world/geometry2d';
import type { Lot } from '@/world/lots';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';

const GARDEN_TEST_STYLE: GardenStyle = {
  depthM: [1.6, 3.4],
  sideM: 0.9,
  wall: {
    heightM: 2.1,
    lowM: 0.8,
    thicknessM: 0.22,
    gateM: 1.4,
    plaster: [0xe9e4da],
    boards: [0x6a6b66],
    boardShare: 0,
  },
  hedge: { share: 0, heightM: 1.1, thicknessM: 0.7, colours: [0x587a45] },
  openShare: 0,
  bed: [0x7f9a5c],
  stone: [0xdcd7cc],
};
const STYLE = GARDEN_TEST_STYLE;

const HALF_ROAD = 4.5;

/** One straight street 200 m long, running east along z = 0. */
function street(): RoadGraph {
  return {
    nodes: [
      { id: 0, x: 0, z: 0 },
      { id: 1, x: 200, z: 0 },
    ],
    edges: [{ a: 0, b: 1, kind: 'street', widthM: HALF_ROAD * 2, lengthM: 200 }],
    adjacency: [[0], [0]],
  };
}

/** A house north of the street, set back from the pavement, facing it across its -z side. */
function house(id: number, x: number, overrides: Partial<Lot> = {}): Lot {
  const dM = 10;
  return {
    id,
    x,
    z: HALF_ROAD + PAVEMENT_M + 4 + dM / 2,
    wM: 10,
    dM,
    rotY: 0,
    use: 'home',
    heightM: 6,
    style: 'low',
    jitter: 0.4,
    street: true,
    ...overrides,
  };
}

function gardened(lots: Lot[], style: GardenStyle = STYLE): ReturnType<typeof buildGardens> {
  measureGardens(lots, street(), style);
  return buildGardens(mulberry32(3), lots, style);
}

describe('front gardens', () => {
  it('walls a garden in front of a house on a street, clear of the pavement', () => {
    const lot = house(0, 50);
    const { barriers } = gardened([lot]);
    expect(lot.garden).toBeDefined();
    expect(lot.garden?.depthM ?? 0).toBeGreaterThanOrEqual(STYLE.depthM[0]);
    expect(lot.garden?.depthM ?? 99).toBeLessThanOrEqual(STYLE.depthM[1] + 1e-6);
    expect(barriers.length).toBeGreaterThanOrEqual(4);
    for (const wall of barriers) {
      expect(segmentRectDistance(0, 0, 200, 0, wall)).toBeGreaterThan(HALF_ROAD + PAVEMENT_M);
    }
  });

  it('leaves the gate in line with the door, wide enough to walk through', () => {
    const lot = house(0, 50);
    const { barriers } = gardened([lot]);
    const gate = gateApproach(lot);
    expect(gate).not.toBeNull();
    const door = toWorld(lot, 0, -(lot.dM / 2 + 1.4));
    for (const wall of barriers) {
      expect(segmentRectDistance(gate?.x ?? 0, gate?.z ?? 0, door.x, door.z, wall)).toBeGreaterThan(WALK.radiusM);
    }
  });

  it('narrows a garden to fit beside the next one, and never crosses it', () => {
    // 1.2 m apart: room for two narrow gardens, not for two at the full reach.
    const a = house(0, 50);
    const b = house(1, 61.2);
    const { barriers } = gardened([a, b]);
    expect(a.garden?.sideM).toBe(0.3);
    expect(b.garden?.sideM).toBe(0.3);
    const split = (a.x + a.wM / 2 + b.x - b.wM / 2) / 2;
    const left = barriers.filter((wall) => wall.x < split);
    const right = barriers.filter((wall) => wall.x > split);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    for (const one of left) {
      for (const other of right) expect(rectsOverlap(one, other)).toBe(false);
    }
    const rect = (lot: Lot): OrientedRect => ({ x: lot.x, z: lot.z, wM: lot.wM, dM: lot.dM, rotY: lot.rotY });
    for (const wall of left) expect(rectsOverlap(wall, rect(b))).toBe(false);
    for (const wall of right) expect(rectsOverlap(wall, rect(a))).toBe(false);
  });

  it('keeps some gardens with a hedge and leaves some open, with no wall to walk round', () => {
    const lots = Array.from({ length: 12 }, (_, i) => house(i, 20 + i * 14));
    const { barriers, structures } = gardened(lots, { ...STYLE, openShare: 1 });
    expect(barriers).toHaveLength(0);
    // Open gardens still have their bed and stones.
    expect(structures.filter((piece) => piece.kind === 'flat').length).toBeGreaterThan(lots.length);
    const hedged = gardened(
      Array.from({ length: 3 }, (_, i) => house(i, 20 + i * 14)),
      { ...STYLE, hedge: { ...STYLE.hedge, share: 1 } },
    );
    expect(hedged.structures.some((piece) => piece.hM === STYLE.hedge.heightM)).toBe(true);
  });

  it('puts no garden on a park or in front of a market', () => {
    const park = house(0, 50, { use: 'park', heightM: 0 });
    const market = house(1, 80, { use: 'market' });
    const { structures } = gardened([park, market]);
    expect(park.garden).toBeUndefined();
    expect(market.garden).toBeUndefined();
    expect(structures).toHaveLength(0);
  });
});
