import { describe, expect, it } from 'vitest';
import type { Structure } from '@/world/eras';
import { directionToLocal, orientToFrame, toLocal, toWorld, type Frame } from '@/world/frame';
import { rotYAlong } from '@/world/geometry2d';

const piece = (x: number, z: number, rotY = 0): Structure => ({ kind: 'box', x, y: 0, z, wM: 1, hM: 1, dM: 1, rotY, colour: 0 });

describe('a lot frame', () => {
  const frame: Frame = { x: 40, z: -12, rotY: 0.9 };

  it('takes a point out to the world and back', () => {
    const world = toWorld(frame, 3, -7);
    const back = toLocal(frame, world.x, world.z);
    expect(back.x).toBeCloseTo(3);
    expect(back.z).toBeCloseTo(-7);
  });

  it('runs local x along the street a lot was turned to face', () => {
    const turned: Frame = { x: 0, z: 0, rotY: rotYAlong(3, 4) };
    const p = toWorld(turned, 5, 0);
    expect(p.x).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(4);
    const d = directionToLocal(turned, 3, 4);
    expect(d.x).toBeCloseTo(5);
    expect(d.z).toBeCloseTo(0);
  });

  it('turns what was laid out round an unturned lot, and only that', () => {
    const out = [piece(100, 100), piece(43, -12, 0.2), piece(40, -9)];
    orientToFrame(out, 1, frame);
    // The first piece belongs to someone else and is left where it was.
    expect(out[0]).toEqual(piece(100, 100));
    const offset = toWorld(frame, 3, 0);
    expect(out[1]?.x).toBeCloseTo(offset.x);
    expect(out[1]?.z).toBeCloseTo(offset.z);
    expect(out[1]?.rotY).toBeCloseTo(0.2 + frame.rotY);
    const behind = toWorld(frame, 0, 3);
    expect(out[2]?.x).toBeCloseTo(behind.x);
    expect(out[2]?.z).toBeCloseTo(behind.z);
  });

  it('leaves a lot laid square to the world alone', () => {
    const out = [piece(1, 2, 0.3)];
    orientToFrame(out, 0, { x: 0, z: 0, rotY: 0 });
    expect(out).toEqual([piece(1, 2, 0.3)]);
  });
});
