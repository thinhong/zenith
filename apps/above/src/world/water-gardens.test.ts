import { describe, expect, it } from 'vitest';
import { toLocal, toWorld } from '@/world/frame';
import type { Lot } from '@/world/lots';
import { lakeDepthAt, lakeRadiusAt, type Lake } from '@/world/plan';
import { mulberry32 } from '@/world/seed';
import { buildHeart, buildWaterGardens, HEART, wetTest, WATER_GARDEN, type WaterGardenStyle } from '@/world/water-gardens';

const STYLE: WaterGardenStyle = {
  moss: [0x86a062],
  water: 0x9ab2c3,
  rim: 0xd6d0c4,
  stone: [0xc9c3b6],
  rock: [0x8f8b83],
  gravel: 0xd8d2c6,
  cedar: [0xb3845a],
  roof: [0x5f615d],
  post: 0x5e605c,
  hallRoof: 0x4b5054,
  timber: 0x5b4636,
  gold: 0xc9a23f,
  wood: 0x587c42,
  reed: 0x6f8a4c,
  lawn: 0x8c9d70,
  paper: 0xf0e9dc,
  redMaple: 0xb45a3c,
  redShare: 0.12,
};

function park(id: number, x: number, z: number, wM: number, dM: number, rotY = 0): Lot {
  return { id, x, z, wM, dM, rotY, use: 'park', heightM: 0, style: 'low', jitter: 0.3, street: true };
}

const SQUARE = { x: 0, z: 0, wM: 150, dM: 150, rotY: 0.4 };

describe('water gardens', () => {
  it('keeps every pond inside its park, and off the side it is entered from', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const lot = park(0, 200, -40, 44, 36, seed * 0.7);
      const gardens = buildWaterGardens(mulberry32(seed), [lot], STYLE);
      expect(gardens.ponds.length).toBeGreaterThan(0);
      for (const pond of gardens.ponds) {
        const local = toLocal(lot, pond.x, pond.z);
        expect(Math.abs(local.x) + pond.radiusM).toBeLessThanOrEqual(lot.wM / 2);
        expect(local.z + pond.radiusM).toBeLessThanOrEqual(lot.dM / 2);
        expect(local.z - pond.radiusM).toBeGreaterThanOrEqual(-lot.dM / 2 + WATER_GARDEN.frontDryM - WATER_GARDEN.rimM - 1e-6);
      }
    }
  });

  it('plants no tree in the water, and some trees in every garden', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const lots = [park(0, 200, -40, 44, 36, 0.3), park(1, -150, 90, 18, 14)];
      const gardens = buildWaterGardens(mulberry32(seed), lots, STYLE);
      const wet = wetTest(gardens);
      const onIsland = (x: number, z: number): boolean =>
        gardens.islands.some((island) => Math.hypot(x - island.x, z - island.z) < island.radiusM);
      for (const tree of gardens.trees) {
        if (onIsland(tree.x, tree.z)) continue;
        expect(wet(tree.x, tree.z)).toBe(false);
      }
      expect(gardens.trees.length).toBeGreaterThan(10);
    }
  });

});

describe('the heart of town', () => {
  const heart = buildHeart(mulberry32(3), SQUARE, STYLE, 500);
  const wet = wetTest({ ponds: [], dry: heart.dry, islands: heart.islands }, [heart.pond]);
  const local = (x: number, z: number): { x: number; z: number } => toWorld(SQUARE, x, z);

  it('turns the pond with the square', () => {
    // Its shore, laid out in the square's own frame, is where the turned pond says it is.
    const unturned: Lake = { x: 0, z: HEART.pond.z, radiusM: HEART.pond.radiusM, lobes: HEART.pond.lobes };
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const r = lakeRadiusAt(unturned, angle);
      const onShore = local(Math.cos(angle) * r, HEART.pond.z + Math.sin(angle) * r);
      expect(Math.abs(lakeDepthAt([heart.pond], onShore.x, onShore.z))).toBeLessThan(0.05);
    }
  });

  it('stands the hall in the water, on floors that can be walked', () => {
    const hall = heart.lots[0];
    expect(hall).toBeDefined();
    if (!hall) return;
    expect(lakeDepthAt([heart.pond], hall.x, hall.z)).toBeGreaterThan(5);
    // Round the hall, on its stone, it is dry; a little way off the stone, water.
    const front = local(0, HEART.hallZ + HEART.base.dM / 2 - 1);
    expect(wet(front.x, front.z)).toBe(false);
    const past = local(0, HEART.hallZ + HEART.base.dM / 2 + 3);
    expect(wet(past.x, past.z)).toBe(true);
    // The galleries out to the towers and back to the shore are dry all along.
    for (const t of [0.2, 0.5, 0.8]) {
      const out = local(HEART.base.wM / 2 + t * (HEART.tower.x - HEART.tower.baseM / 2 - HEART.base.wM / 2), HEART.hallZ);
      expect(wet(out.x, out.z)).toBe(false);
      const tail = local(0, HEART.hallZ - HEART.base.dM / 2 - t * 10);
      expect(wet(tail.x, tail.z)).toBe(false);
    }
    // Its towers stand in the water too, and every room is inside the square.
    for (const lot of heart.lots) {
      expect(lakeDepthAt([heart.pond], lot.x, lot.z)).toBeGreaterThan(2);
      const at = toLocal(SQUARE, lot.x, lot.z);
      expect(Math.abs(at.x) + lot.wM / 2).toBeLessThan(SQUARE.wM / 2);
      expect(Math.abs(at.z) + lot.dM / 2).toBeLessThan(SQUARE.dM / 2);
    }
    expect(heart.lots.map((lot) => lot.id)).toEqual([500, 501, 502]);
  });

  it('looks at the hall from a dry platform across the water', () => {
    expect(wet(heart.lookout.x, heart.lookout.z)).toBe(false);
    const hall = heart.lots[0];
    if (!hall) return;
    const toward = { x: hall.x - heart.lookout.x, z: hall.z - heart.lookout.z };
    const length = Math.hypot(toward.x, toward.z);
    expect(length).toBeGreaterThan(45);
    expect((toward.x * heart.lookout.faceX + toward.z * heart.lookout.faceZ) / length).toBeGreaterThan(0.99);
    // Open water between them: nothing to walk on halfway across.
    expect(wet(heart.lookout.x + toward.x / 2, heart.lookout.z + toward.z / 2)).toBe(true);
  });

  it('plants no tree in the water but on an island, and none outside the square', () => {
    for (const tree of heart.trees) {
      const onIsland = heart.islands.some((island) => Math.hypot(tree.x - island.x, tree.z - island.z) < island.radiusM);
      if (!onIsland) expect(lakeDepthAt([heart.pond], tree.x, tree.z)).toBeLessThan(-2);
      const at = toLocal(SQUARE, tree.x, tree.z);
      expect(Math.abs(at.x)).toBeLessThan(SQUARE.wM / 2);
      expect(Math.abs(at.z)).toBeLessThan(SQUARE.dM / 2);
    }
    expect(heart.trees.length).toBeGreaterThan(60);
  });

  it('is massive but low: wide as the square, and no taller than the trees behind it', () => {
    const tallest = Math.max(...heart.structures.map((s) => s.y + s.hM * (s.kind === 'hue' ? 1.14 : 1)));
    expect(tallest).toBeGreaterThan(12);
    expect(tallest).toBeLessThan(17);
    const halls = heart.structures.filter((s) => s.kind === 'hue');
    const spread = Math.max(...halls.map((s) => Math.abs(toLocal(SQUARE, s.x, s.z).x)));
    expect(spread).toBeGreaterThan(30);
  });
});
