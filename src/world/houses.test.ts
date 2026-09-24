import { describe, expect, it } from 'vitest';
import { rectsOverlap, segmentRectDistance, type OrientedRect } from '@/world/geometry2d';
import { buildHouses, HOUSES, houseKind, type HouseKind, type HouseStyle } from '@/world/houses';
import type { Lot } from '@/world/lots';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';

const STYLE: HouseStyle = {
  walls: {
    home: [0xefeae1],
    work: [0xece7dd],
    market: [0xd8ccb6],
    temple: [0xe9e4da],
    park: [0x000000],
    water: [0x000000],
  },
  plaster: [0xece7dd],
  boards: [0x686963],
  cedar: [0xb3845a],
  glass: [0x6b7478],
  stone: [0xd9d3c7],
  post: 0x5e605c,
  roof: { dark: [0x5f615d], pale: [0xd6cfc1], moss: [0x7b8f5a], paleShare: 0.2, mossShare: 0.1, thicknessM: 0.26 },
  shrineRoof: [0x5d6a62],
  hallRoof: [0x8a7a67],
  homes: { low: { pavilion: 0.3, gabled: 0.25, court: 0.2 }, tall: { stacked: 0.3, gabled: 0.2, court: 0.2 } },
  screen: { share: 1, spacingM: 0.16 },
};

const HALF_ROAD = 2.5;
const FRONT_Z = HALF_ROAD + PAVEMENT_M + 4;

/** One straight lane 400 m long, running east along z = 0. */
function lane(): RoadGraph {
  return {
    nodes: [
      { id: 0, x: 0, z: 0 },
      { id: 1, x: 400, z: 0 },
    ],
    edges: [{ a: 0, b: 1, kind: 'street', widthM: HALF_ROAD * 2, lengthM: 400 }],
    adjacency: [[0], [0]],
  };
}

function lot(id: number, x: number, overrides: Partial<Lot> = {}): Lot {
  const dM = overrides.dM ?? 11;
  return {
    id,
    x,
    z: FRONT_Z + dM / 2,
    wM: 13,
    dM,
    rotY: 0,
    use: 'home',
    heightM: 6.4,
    style: 'low',
    jitter: 0.4,
    street: true,
    ...overrides,
  };
}

/** Every piece that stands on the ground, as a rectangle: to check it against the lane and the other lots. */
function footprints(pieces: readonly { kind: string; x: number; y: number; z: number; wM: number; dM: number; rotY: number }[]): OrientedRect[] {
  return pieces.filter((p) => p.y === 0 && p.kind === 'box').map((p) => ({ x: p.x, z: p.z, wM: p.wM, dM: p.dM, rotY: p.rotY }));
}

describe('houseKind', () => {
  it('gives each use its own kind of building', () => {
    expect(houseKind(lot(0, 0, { use: 'market' }), STYLE, 0.5)).toBe('hall');
    expect(houseKind(lot(0, 0, { use: 'temple' }), STYLE, 0.5)).toBe('shrine');
    expect(houseKind(lot(0, 0, { use: 'work', wM: 12 }), STYLE, 0.5)).toBe('studio');
  });

  it('only makes a pavilion of one storey, and only stacks two', () => {
    expect(houseKind(lot(0, 0, { heightM: 6.4 }), STYLE, 0.05)).toBe('stacked');
    expect(houseKind(lot(0, 0, { heightM: 3.8 }), STYLE, 0.05)).toBe('pavilion');
    expect(houseKind(lot(0, 0, { heightM: 3.8 }), STYLE, 0.4)).toBe('gabled');
    expect(houseKind(lot(0, 0, { heightM: 6.4 }), STYLE, 0.95)).toBe('garden');
    // A court needs a lot big enough to reach round.
    expect(houseKind(lot(0, 0, { heightM: 3.8, wM: 9 }), STYLE, 0.7)).toBe('gabled');
  });

  it('makes a mix of homes along a street', () => {
    const kinds = new Set<HouseKind>();
    for (let i = 0; i < 60; i++) {
      kinds.add(houseKind(lot(i, 0, { heightM: i % 2 === 0 ? 3.8 : 6.6 }), STYLE, (i * 0.618) % 1));
    }
    for (const kind of ['garden', 'pavilion', 'stacked', 'gabled', 'court'] as const) expect(kinds.has(kind)).toBe(true);
  });
});

describe('buildHouses', () => {
  // A row of every kind, with the gaps a garden town leaves between houses.
  const row = (): Lot[] => {
    const lots: Lot[] = [];
    let x = 20;
    const variants: Partial<Lot>[] = [
      { heightM: 3.8 },
      { heightM: 6.6 },
      { heightM: 6.6, wM: 14, dM: 12 },
      { use: 'work', wM: 12, heightM: 5.5 },
      { use: 'market', wM: 14, heightM: 3.6 },
      { use: 'temple', wM: 12, dM: 12, heightM: 7.5 },
      { heightM: 3.8 },
      { heightM: 6.6 },
    ];
    variants.forEach((v, i) => {
      const next = lot(i, 0, v);
      next.x = x + next.wM / 2;
      lots.push(next);
      x += next.wM + 4 + (i % 3);
    });
    return lots;
  };

  it('never lets two buildings reach into each other, at any height', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const lots = row();
      const { structures } = buildHouses(mulberry32(seed), lots, lane(), STYLE);
      const byLot = new Map<number, OrientedRect[]>();
      for (const piece of structures) {
        if (piece.lotId === undefined || piece.kind === 'trim') continue;
        const list = byLot.get(piece.lotId) ?? [];
        list.push({ x: piece.x, z: piece.z, wM: piece.wM, dM: piece.dM, rotY: piece.rotY });
        byLot.set(piece.lotId, list);
      }
      const ids = [...byLot.keys()];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          for (const a of byLot.get(ids[i] ?? -1) ?? []) {
            for (const b of byLot.get(ids[j] ?? -1) ?? []) expect(rectsOverlap(a, b)).toBe(false);
          }
        }
      }
    }
  });

  it('keeps everything that stands on the ground off the lane and its verge', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const lots = row();
      const { structures } = buildHouses(mulberry32(seed), lots, lane(), STYLE);
      for (const piece of footprints(structures)) {
        expect(segmentRectDistance(0, 0, 400, 0, piece)).toBeGreaterThan(HALF_ROAD + PAVEMENT_M);
      }
    }
  });

  it('keeps a roof out of the garden wall, and a court\'s wings off the land behind', () => {
    const lots = row();
    for (const each of lots) each.garden = { depthM: 2.4, sideM: 0.9 };
    const { structures, barriers } = buildHouses(mulberry32(2), lots, lane(), STYLE);
    for (const piece of structures) {
      if (piece.y < 3) continue;
      const front = piece.z - piece.dM / 2;
      expect(front).toBeGreaterThan(FRONT_Z - 2.4 - 0.05);
    }
    // Wings and plinths are walked round.
    for (const barrier of barriers) expect(barrier.wM * barrier.dM).toBeGreaterThan(0);
  });

  it('builds something different for each kind, and names the kind of every lot', () => {
    const lots = row();
    const { kinds, structures } = buildHouses(mulberry32(4), lots, lane(), STYLE);
    expect(kinds.size).toBe(lots.length);
    expect(kinds.get(3)).toBe('studio');
    expect(kinds.get(4)).toBe('hall');
    expect(kinds.get(5)).toBe('shrine');
    // The studio's folded roof is several ridges; the hall's roof stands on posts.
    expect(structures.filter((p) => p.lotId === 3 && p.kind === 'gable').length).toBeGreaterThanOrEqual(2);
    const hallPosts = structures.filter((p) => p.lotId === 4 && p.kind === 'box' && p.wM === HOUSES.postM);
    expect(hallPosts.length).toBeGreaterThanOrEqual(4);
    expect(structures.some((p) => p.lotId === 5 && p.kind === 'roof')).toBe(true);
  });
});
