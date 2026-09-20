import { describe, expect, it } from 'vitest';
import { buildFacade, type FacadeStyle } from '@/world/facade';
import type { Lot, LotUse } from '@/world/lots';
import { mulberry32 } from '@/world/seed';

const STYLE: FacadeStyle = {
  balcony: {
    share: 1,
    everyM: 3.6,
    perFloor: 2,
    depthM: 1.2,
    railM: 0.9,
    colours: [0xaaaaaa],
    railColours: [0x777777],
  },
  pilaster: { fromM: 20, share: 1, widthM: 0.4, depthM: 0.3, spacingM: 4, colours: [0xcccccc] },
  shopfront: {
    share: 1,
    heightM: 3.8,
    canopyDepthM: 1.5,
    colours: [0x666666],
    canopyColours: [0xbb5533],
  },
};

let nextId = 0;
function lot(use: LotUse, heightM: number, wM = 14, dM = 10): Lot {
  return { id: nextId++, x: 30, z: -20, wM, dM, heightM, use, jitter: 0.3, style: 'slab' };
}

/** The footprint a lot's own wall box occupies, plus how far trim may stick out. */
function within(piece: { x: number; z: number; wM: number; dM: number }, l: Lot, slackM: number) {
  return (
    Math.abs(piece.x - l.x) + piece.wM / 2 <= l.wM / 2 + slackM &&
    Math.abs(piece.z - l.z) + piece.dM / 2 <= l.dM / 2 + slackM
  );
}

describe('buildFacade', () => {
  it('puts nothing on a park', () => {
    expect(buildFacade(mulberry32(1), [lot('park', 0)], STYLE)).toEqual([]);
  });

  it('tags every piece with the lot it belongs to, so opening takes it away', () => {
    const l = lot('home', 30);
    const out = buildFacade(mulberry32(1), [l], STYLE);
    expect(out.length).toBeGreaterThan(0);
    for (const piece of out) expect(piece.lotId).toBe(l.id);
  });

  it('draws everything as trim, so it can be switched off in one move', () => {
    const out = buildFacade(mulberry32(2), [lot('home', 30), lot('work', 60)], STYLE);
    for (const piece of out) expect(piece.kind).toBe('trim');
  });

  it('keeps every piece against its own wall, not floating off it', () => {
    const l = lot('home', 30);
    const out = buildFacade(mulberry32(3), [l], STYLE);
    const reach = Math.max(STYLE.balcony.depthM, STYLE.shopfront.canopyDepthM) + 0.1;
    for (const piece of out) expect(within(piece, l, reach)).toBe(true);
  });

  it('never puts anything above the roof', () => {
    const l = lot('home', 30);
    for (const piece of buildFacade(mulberry32(4), [l], STYLE)) {
      expect(piece.y + piece.hM).toBeLessThanOrEqual(l.heightM);
    }
  });

  it('never puts a balcony at pavement level', () => {
    // Balconies only, so nothing else is in the way: a balcony at the
    // pavement is a step, and the first one belongs on the first floor.
    const only: FacadeStyle = {
      ...STYLE,
      pilaster: { ...STYLE.pilaster, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    const out = buildFacade(mulberry32(5), [lot('home', 30)], only);
    expect(out.length).toBeGreaterThan(0);
    for (const piece of out) expect(piece.y).toBeGreaterThanOrEqual(STYLE.balcony.everyM - 0.01);
  });

  it('gives a taller home more balconies than a short one', () => {
    const short = buildFacade(mulberry32(6), [lot('home', 11)], STYLE).length;
    const tall = buildFacade(mulberry32(6), [lot('home', 34)], STYLE).length;
    expect(tall).toBeGreaterThan(short);
  });

  it('puts the wanted number of balconies on each floor of each side', () => {
    const only: FacadeStyle = {
      ...STYLE,
      pilaster: { ...STYLE.pilaster, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    // 30 m at 3.6 m a storey leaves 7 floors above the first.
    const floors = Math.floor((30 - 3.6) / 3.6);
    const out = buildFacade(mulberry32(20), [lot('home', 30)], only);
    // A slab and a rail, on both sides, twice a floor.
    expect(out.length).toBe(floors * 2 * STYLE.balcony.perFloor * 2);
  });

  it('leaves gaps between the balconies on one wall', () => {
    const only: FacadeStyle = {
      ...STYLE,
      balcony: { ...STYLE.balcony, perFloor: 3 },
      pilaster: { ...STYLE.pilaster, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    const l = lot('home', 12);
    const slabs = buildFacade(mulberry32(21), [l], only).filter((p) => p.hM < 0.2);
    expect(slabs.length).toBeGreaterThan(2);
    // Three balconies over a 14 m wall, each a fifth of it: they cannot touch.
    // One side, one floor: the first, which every such building has.
    const firstFloor = STYLE.balcony.everyM;
    const onOneSide = slabs
      .filter((p) => p.z > l.z && Math.abs(p.y - firstFloor) < 0.01)
      .sort((a, b) => a.x - b.x);
    expect(onOneSide.length).toBe(3);
    for (let i = 1; i < onOneSide.length; i++) {
      const left = onOneSide[i - 1];
      const right = onOneSide[i];
      if (!left || !right) continue;
      expect(right.x - right.wM / 2).toBeGreaterThan(left.x + left.wM / 2);
    }
  });

  it('caps the balconies on a very tall building', () => {
    const tall = buildFacade(mulberry32(7), [lot('home', 300)], STYLE).length;
    const taller = buildFacade(mulberry32(7), [lot('home', 900)], STYLE).length;
    expect(taller).toBe(tall);
  });

  it('puts no balconies on a workplace', () => {
    const home = buildFacade(mulberry32(8), [lot('home', 30)], STYLE).length;
    const work = buildFacade(mulberry32(8), [lot('work', 30)], STYLE).length;
    expect(work).toBeLessThan(home);
  });

  it('leaves a short building without pilasters', () => {
    const style: FacadeStyle = { ...STYLE, balcony: { ...STYLE.balcony, share: 0 } };
    expect(buildFacade(mulberry32(9), [lot('work', 8)], style).length).toBeLessThan(
      buildFacade(mulberry32(9), [lot('work', 60)], style).length,
    );
  });

  it('fits the ribs inside the wall rather than off its corners', () => {
    const style: FacadeStyle = {
      ...STYLE,
      balcony: { ...STYLE.balcony, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    const l = lot('work', 60, 9, 9);
    for (const piece of buildFacade(mulberry32(10), [l], style)) {
      expect(within(piece, l, style.pilaster.depthM)).toBe(true);
    }
  });

  it('caps a rib at one storey when the era asks for a verandah post', () => {
    const posts: FacadeStyle = {
      ...STYLE,
      balcony: { ...STYLE.balcony, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
      pilaster: { ...STYLE.pilaster, fromM: 3, maxHeightM: 3.2 },
    };
    const out = buildFacade(mulberry32(30), [lot('work', 40)], posts);
    expect(out.length).toBeGreaterThan(0);
    for (const piece of out) expect(piece.hM).toBeLessThanOrEqual(3.2);
  });

  it('runs a rib the whole wall when no cap is given', () => {
    const ribs: FacadeStyle = {
      ...STYLE,
      balcony: { ...STYLE.balcony, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    const out = buildFacade(mulberry32(31), [lot('work', 40)], ribs);
    expect(Math.max(...out.map((p) => p.hM))).toBeGreaterThan(30);
  });

  it('honours a share of zero', () => {
    const none: FacadeStyle = {
      balcony: { ...STYLE.balcony, share: 0 },
      pilaster: { ...STYLE.pilaster, share: 0 },
      shopfront: { ...STYLE.shopfront, share: 0 },
    };
    expect(buildFacade(mulberry32(11), [lot('home', 60)], none)).toEqual([]);
  });

  it('builds the same city twice from the same seed', () => {
    const lots = [lot('home', 24), lot('work', 55), lot('market', 9)];
    expect(buildFacade(mulberry32(12), lots, STYLE)).toEqual(
      buildFacade(mulberry32(12), lots, STYLE),
    );
  });

  it('skips a building too small for a shopfront', () => {
    const style: FacadeStyle = {
      ...STYLE,
      balcony: { ...STYLE.balcony, share: 0 },
      pilaster: { ...STYLE.pilaster, share: 0 },
    };
    expect(buildFacade(mulberry32(13), [lot('market', 9, 3, 3)], style)).toEqual([]);
  });
});
