import { describe, expect, it } from 'vitest';
import { buildRoofscape, type RoofStyle } from './roofscape';
import { mulberry32 } from './seed';
import type { Lot } from './lots';

const STYLE: RoofStyle = {
  tile: [0x111111, 0x222222],
  grandTile: [0x999999],
  deck: [0x333333],
  clutter: [0x444444],
  pitchedShare: 0.5,
  pitchedMaxM: 18,
  wingShare: 0.3,
  crowns: true,
  crownTint: [0x555555],
  ledge: { everyM: 10, thicknessM: 0.3, overhangM: 0.2, colours: [0x888888] },
  chimney: { share: 0.5, colours: [0x666666] },
  deckTop: { share: 0.3, colours: [0x777777] },
};

function lot(over: Partial<Lot> = {}): Lot {
  return {
    id: 0,
    x: 0,
    z: 0,
    wM: 20,
    dM: 14,
    use: 'home',
    heightM: 9,
    style: 'low',
    jitter: 0.5,
    ...over,
  };
}

describe('buildRoofscape', () => {
  it('puts nothing on a park', () => {
    expect(buildRoofscape(mulberry32(1), [lot({ use: 'park', heightM: 0 })], STYLE)).toEqual([]);
  });

  it('gives every building exactly one roof, plus one per wing', () => {
    const lots = Array.from({ length: 200 }, (_, i) =>
      lot({ id: i, heightM: 4 + (i % 60), style: i % 60 > 40 ? 'tower' : 'low' }),
    );
    // A garden on a deck is also a flat quad, so it is turned off here: this
    // test is about there being exactly one roof, not about what is on it.
    const noWings = buildRoofscape(mulberry32(2), lots, {
      ...STYLE,
      wingShare: 0,
      deckTop: { share: 0, colours: [0x777777] },
    });
    const tops = noWings.filter((s) => s.kind === 'gable' || s.kind === 'flat');
    expect(tops.length).toBe(lots.length);
    // Wings only ever add, never replace.
    const withWings = buildRoofscape(mulberry32(2), lots, STYLE);
    expect(withWings.length).toBeGreaterThan(noWings.length);
  });

  it('puts a garden on some flat decks and never on a ridged roof', () => {
    const flats = Array.from({ length: 60 }, (_, i) => lot({ id: i, heightM: 30, style: 'slab' }));
    const bare = buildRoofscape(mulberry32(9), flats, {
      ...STYLE,
      pitchedShare: 0,
      deckTop: { share: 0, colours: [0x777777] },
    });
    const planted = buildRoofscape(mulberry32(9), flats, { ...STYLE, pitchedShare: 0 });
    expect(planted.filter((s) => s.kind === 'flat').length).toBeGreaterThan(
      bare.filter((s) => s.kind === 'flat').length,
    );

    const ridged = buildRoofscape(mulberry32(9), flats, { ...STYLE, pitchedShare: 1, pitchedMaxM: 99 });
    expect(ridged.some((s) => s.kind === 'flat')).toBe(false);
  });

  it('never pitches a roof on a tall building', () => {
    const lots = Array.from({ length: 80 }, (_, i) => lot({ id: i, heightM: 60, style: 'tower' }));
    const roofs = buildRoofscape(mulberry32(3), lots, STYLE);
    expect(roofs.some((s) => s.kind === 'gable')).toBe(false);
  });

  it('crowns some tall buildings and never a short one', () => {
    const towers = Array.from({ length: 120 }, (_, i) => lot({ id: i, heightM: 80, style: 'tower' }));
    const tall = buildRoofscape(mulberry32(4), towers, STYLE);
    // High up: only a crown reaches there, and not every tower gets one.
    const crowned = tall.filter((s) => s.kind === 'box' && s.y > 70);
    expect(crowned.length).toBeGreaterThan(20);
    expect(crowned.length).toBeLessThan(towers.length * 2);

    const shorts = Array.from({ length: 120 }, (_, i) => lot({ id: i, heightM: 8 }));
    const short = buildRoofscape(mulberry32(4), shorts, STYLE);
    expect(short.filter((s) => s.y > 20).length).toBe(0);
  });

  it('keeps a deck inside the walls, so the wall reads as a parapet', () => {
    const roofs = buildRoofscape(mulberry32(5), [lot({ heightM: 30, style: 'slab' })], STYLE);
    const deck = roofs.find((s) => s.kind === 'flat');
    if (!deck) throw new Error('no deck');
    expect(deck.wM).toBeLessThan(20);
    expect(deck.dM).toBeLessThan(14);
    expect(deck.y).toBeLessThan(30);
  });

  it('lays a ridge along the long side', () => {
    const wide = buildRoofscape(mulberry32(6), [lot({ wM: 30, dM: 10 })], { ...STYLE, pitchedShare: 1 });
    const deep = buildRoofscape(mulberry32(6), [lot({ wM: 10, dM: 30 })], { ...STYLE, pitchedShare: 1 });
    const a = wide.find((s) => s.kind === 'gable');
    const b = deep.find((s) => s.kind === 'gable');
    if (!a || !b) throw new Error('no ridge');
    expect(a.rotY).toBe(0);
    expect(b.rotY).toBeCloseTo(Math.PI / 2, 6);
    // The ridge runs the long way in both, once the turn is taken into account.
    expect(a.wM).toBeGreaterThan(a.dM);
    expect(b.wM).toBeGreaterThan(b.dM);
  });

  it('is deterministic for a seed', () => {
    const lots = Array.from({ length: 50 }, (_, i) => lot({ id: i, heightM: 5 + i }));
    const a = buildRoofscape(mulberry32(7), lots, STYLE);
    const b = buildRoofscape(mulberry32(7), lots, STYLE);
    expect(a).toEqual(b);
  });

  it('never puts a roof below the ground', () => {
    const lots = Array.from({ length: 100 }, (_, i) => lot({ id: i, heightM: 0.3 + i * 0.1 }));
    for (const s of buildRoofscape(mulberry32(8), lots, STYLE)) {
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.wM).toBeGreaterThan(0);
      expect(s.dM).toBeGreaterThan(0);
      expect(s.hM).toBeGreaterThan(0);
    }
  });
});
