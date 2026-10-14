import { describe, expect, it } from 'vitest';
import { WALK } from '@/state/altitude';
import { castPlaces, wayBetween, type Spot } from '@/story/cast';
import { DAYS } from '@/story/days';
import { canStand, moveBody } from '@/walk/body';
import { townGround } from '@/walk/town';
import { buildLayout, eraById } from '@/world/eras';
import type { RoadGraph } from '@/world/roads';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

/**
 * Walks from one spot to another the way the light leads: out through a
 * garden gate, along the roads, in at the far gate, bumping into whatever is
 * in the way. Returns how close it got.
 */
function walk(ground: ReturnType<typeof townGround>, graph: RoadGraph, from: Spot, to: Spot): number {
  const path = wayBetween(graph, from, to);
  let x = from.x;
  let z = from.z;
  for (let i = 1; i < path.x.length; i++) {
    const tx = path.x[i] ?? x;
    const tz = path.z[i] ?? z;
    // Head for the next waypoint a step at a time, as somebody holding W would.
    for (let step = 0; step < 400; step++) {
      const dx = tx - x;
      const dz = tz - z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) break;
      const k = Math.min(1, 1.5 / d);
      const next = moveBody(ground, x, z, dx * k, dz * k, WALK.radiusM);
      if (Math.hypot(next.x - x, next.z - z) < 1e-4) break;
      x = next.x;
      z = next.z;
    }
  }
  return Math.hypot(to.x - x, to.z - z);
}

describe('castPlaces', () => {
  for (const day of DAYS) {
    for (const seed of [1, 2, 3]) {
      it(`finds every place of ${day.title} in town ${seed}, and each can be walked to`, () => {
        const era = eraById(day.era);
        if (!era) throw new Error(`no era ${day.era}`);
        const terrain = buildTerrain(mulberry32(seed));
        const layout = buildLayout(era, mulberry32(seed), terrain);
        const ground = townGround(layout, terrain);
        const spots = castPlaces(day, layout, terrain, ground, seed);

        for (const id of Object.keys(day.places)) {
          const spot = spots[id];
          expect(spot, id).toBeDefined();
          if (!spot) continue;
          expect(canStand(ground, spot.x, spot.z, WALK.radiusM), id).toBe(true);
          expect(Math.hypot(spot.faceX, spot.faceZ)).toBeCloseTo(1, 3);
        }
        // Two places are never the same building.
        const lots = Object.values(spots).map((spot) => spot.lotId).filter((id) => id >= 0);
        expect(new Set(lots).size).toBe(lots.length);

        // From each scene to the next, as the day goes.
        for (let i = 1; i < day.scenes.length; i++) {
          const from = spots[day.scenes[i - 1]?.at ?? ''];
          const to = spots[day.scenes[i]?.at ?? ''];
          if (!from || !to) throw new Error('scene with no place');
          const left = walk(ground, layout.roads, from, to);
          expect(left, `${day.scenes[i - 1]?.id} to ${day.scenes[i]?.id}`).toBeLessThan(WALK.talkM);
          expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeLessThan(700);
        }
      });
    }
  }

  it('casts the same places twice from the same seed', () => {
    const day = DAYS[2];
    if (!day) throw new Error('no day');
    const era = eraById(day.era);
    if (!era) throw new Error('no era');
    const terrain = buildTerrain(mulberry32(4));
    const layout = buildLayout(era, mulberry32(4), terrain);
    const ground = townGround(layout, terrain);
    expect(castPlaces(day, layout, terrain, ground, 4)).toEqual(castPlaces(day, layout, terrain, ground, 4));
  });
});
