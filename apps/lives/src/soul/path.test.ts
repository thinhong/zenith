import { describe, expect, it } from 'vitest';
import { ROOM } from '@/film/stage';
import { SOUL, soulAt } from './path';

const chest = [-1.6, 1.0, -1.15] as const;

describe('soulAt', () => {
  it('starts at the chest and rises straight up out of it', () => {
    const start = soulAt(chest, 0).pos;
    expect(start[1]).toBeCloseTo(chest[1] + 0.02 * Math.sin(1), 5);
    const risen = soulAt(chest, SOUL.riseS).pos;
    expect(risen[1]).toBeCloseTo(chest[1] + SOUL.riseM, 1);
    expect(Math.abs(risen[2] - chest[2])).toBeLessThan(0.05);
  });

  it('leaves through the window and climbs out of sight', () => {
    const total = SOUL.riseS + SOUL.holdS + SOUL.crossS + SOUL.leaveS;
    const end = soulAt(chest, total).pos;
    expect(end[2]).toBeLessThan(ROOM.backZ - 3);
    expect(end[1]).toBeGreaterThan(4);
    // Where it crosses the wall it is inside the window's opening.
    let crossed = false;
    for (let t = 0; t < total; t += 0.01) {
      const a = soulAt(chest, t).pos;
      const b = soulAt(chest, t + 0.01).pos;
      if (a[2] >= ROOM.backZ && b[2] < ROOM.backZ) {
        crossed = true;
        expect(Math.abs(b[0] - ROOM.window.x)).toBeLessThan(ROOM.window.widthM / 2);
        expect(b[1]).toBeGreaterThan(ROOM.window.sillM);
        expect(b[1]).toBeLessThan(ROOM.window.topM);
      }
    }
    expect(crossed).toBe(true);
  });

  it('fades in as it appears', () => {
    expect(soulAt(chest, 0).glow).toBe(0);
    expect(soulAt(chest, 2).glow).toBe(1);
  });
});
