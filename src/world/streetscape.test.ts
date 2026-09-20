import { describe, expect, it } from 'vitest';
import type { Lot } from '@/world/lots';
import type { RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildStreetscape, type StreetStyle } from '@/world/streetscape';

const STYLE: StreetStyle = {
  wallShare: 0,
  wallHeightM: 0.8,
  wallColours: [0x888888],
  parkedShare: 0,
  parked: { lengthM: 4, widthM: 1.8, heightM: 1.5, colours: [0x999999] },
  poleShare: 0,
  poleColour: 0xaaaaaa,
  furniture: {
    share: 1,
    stepM: 10,
    benchColours: [0x8a7a5c],
    planterColours: [0x9a9a96],
    plantColours: [0x4f7a3e],
    bollardColour: 0x6e747a,
  },
};

/** One straight street 200 m long, running east. */
function street(lengthM = 200): RoadGraph {
  return {
    nodes: [
      { id: 0, x: 0, z: 0 },
      { id: 1, x: lengthM, z: 0 },
    ],
    edges: [{ a: 0, b: 1, kind: 'street', widthM: 9, lengthM }],
    adjacency: [[0], [0]],
  };
}

const NO_LOTS: Lot[] = [];

describe('street furniture', () => {
  it('puts something on the pavement', () => {
    const out = buildStreetscape(mulberry32(1), street(), NO_LOTS, STYLE);
    expect(out.length).toBeGreaterThan(0);
  });

  it('draws it all as trim, so it switches off with the other fine detail', () => {
    const out = buildStreetscape(mulberry32(2), street(), NO_LOTS, STYLE);
    for (const piece of out) expect(piece.kind).toBe('trim');
  });

  it('keeps it off the carriageway', () => {
    const out = buildStreetscape(mulberry32(3), street(), NO_LOTS, STYLE);
    expect(out.length).toBeGreaterThan(0);
    // The street runs along z = 0 and is 9 m wide, so nothing may sit within
    // 4.5 m of the centreline: that is where the traffic is.
    for (const piece of out) expect(Math.abs(piece.z)).toBeGreaterThan(4.5);
  });

  it('keeps it clear of the junctions at either end', () => {
    const out = buildStreetscape(mulberry32(4), street(), NO_LOTS, STYLE);
    for (const piece of out) {
      expect(piece.x).toBeGreaterThan(3);
      expect(piece.x).toBeLessThan(197);
    }
  });

  it('stands everything on the ground, never buried or floating', () => {
    const out = buildStreetscape(mulberry32(5), street(), NO_LOTS, STYLE);
    for (const piece of out) {
      expect(piece.y).toBeGreaterThanOrEqual(0);
      expect(piece.y).toBeLessThan(1.2);
      expect(piece.hM).toBeGreaterThan(0);
    }
  });

  it('leaves a short street alone, so nothing lands in a junction', () => {
    expect(buildStreetscape(mulberry32(6), street(12), NO_LOTS, STYLE)).toEqual([]);
  });

  it('honours a share of zero', () => {
    const none: StreetStyle = { ...STYLE, furniture: { ...STYLE.furniture, share: 0 } };
    expect(buildStreetscape(mulberry32(7), street(), NO_LOTS, none)).toEqual([]);
  });

  it('plants nothing for an era with no planting', () => {
    const bare: StreetStyle = { ...STYLE, furniture: { ...STYLE.furniture, plantColours: [] } };
    const out = buildStreetscape(mulberry32(8), street(), NO_LOTS, bare);
    for (const piece of out) expect(piece.colour).not.toBe(0x4f7a3e);
  });

  it('leaves gaps rather than lining the whole street', () => {
    // A longer street should not simply be wall-to-wall furniture: some of
    // the slots are deliberately left empty.
    const out = buildStreetscape(mulberry32(9), street(400), NO_LOTS, STYLE);
    const slots = Math.floor((400 - 14) / STYLE.furniture.stepM);
    const occupied = new Set(out.map((p) => Math.round(p.x / STYLE.furniture.stepM)));
    expect(occupied.size).toBeLessThan(slots);
  });

  it('builds the same street twice from the same seed', () => {
    expect(buildStreetscape(mulberry32(10), street(), NO_LOTS, STYLE)).toEqual(
      buildStreetscape(mulberry32(10), street(), NO_LOTS, STYLE),
    );
  });
});
