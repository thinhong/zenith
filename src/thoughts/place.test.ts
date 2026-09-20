import { describe, expect, it } from 'vitest';
import { placePill, type PlaceLimits } from '@/thoughts/place';

const LIMITS: PlaceLimits = {
  width: 1280,
  height: 800,
  edgePx: 140,
  gapPx: 30,
  spreadPx: 150,
  nudgeLimit: 5,
  maxStemPx: 120,
};

describe('placePill', () => {
  it('sits a lone pill straight on the head', () => {
    const placed = placePill(640, 400, [], LIMITS);
    expect(placed).toEqual({ pillX: 640, pillY: 400, tailPx: 0, stemPx: 0 });
  });

  it('slides a pill in off the edge and leans the tail back to the head', () => {
    const placed = placePill(20, 400, [], LIMITS);
    expect(placed?.pillX).toBe(140);
    // The tail has to reach back the whole way, or it points at nobody.
    expect(placed?.tailPx).toBe(-120);
    expect((placed?.pillX ?? 0) + (placed?.tailPx ?? 0)).toBe(20);
  });

  it('slides a pill in off the right edge too', () => {
    const placed = placePill(1270, 400, [], LIMITS);
    expect(placed?.pillX).toBe(1140);
    expect((placed?.pillX ?? 0) + (placed?.tailPx ?? 0)).toBe(1270);
  });

  it('lifts a pill clear of one already there and threads it back down', () => {
    const placed = placePill(640, 400, [{ x: 640, y: 400 }], LIMITS);
    expect(placed?.pillY).toBe(370);
    // The thread makes up the difference, so the pair still reads as one.
    expect(placed?.stemPx).toBe(30);
    expect((placed?.pillY ?? 0) + (placed?.stemPx ?? 0)).toBe(400);
  });

  it('leaves a pill alone when the other is far enough sideways', () => {
    const placed = placePill(640, 400, [{ x: 900, y: 400 }], LIMITS);
    expect(placed?.pillY).toBe(400);
    expect(placed?.stemPx).toBe(0);
  });

  it('refuses a pill it cannot lift clear without stranding it', () => {
    // A head with five pills already stacked above it. Every lift clashes
    // again, so it ends 150 px up, past what a thread can plausibly join.
    const taken = [
      { x: 640, y: 400 },
      { x: 640, y: 370 },
      { x: 640, y: 340 },
      { x: 640, y: 310 },
      { x: 640, y: 280 },
    ];
    expect(placePill(640, 400, taken, LIMITS)).toBeUndefined();
  });

  it('allows a lift that stops just inside the limit', () => {
    // Four clashes, so 120 px up: the last placement that still reads.
    const taken = [
      { x: 640, y: 400 },
      { x: 640, y: 370 },
      { x: 640, y: 340 },
      { x: 640, y: 310 },
    ];
    const placed = placePill(640, 400, taken, LIMITS);
    expect(placed?.pillY).toBe(280);
    expect(placed?.stemPx).toBe(120);
  });

  it('never pushes a pill below its own head', () => {
    const placed = placePill(640, 400, [{ x: 640, y: 420 }], LIMITS);
    expect(placed?.pillY).toBeLessThanOrEqual(400);
    expect(placed?.stemPx).toBeGreaterThanOrEqual(0);
  });

  it('keeps both pills inside a frame narrower than twice the edge allowance', () => {
    const narrow: PlaceLimits = { ...LIMITS, width: 200 };
    expect(placePill(10, 400, [], narrow)?.pillX).toBe(100);
    expect(placePill(190, 400, [], narrow)?.pillX).toBe(100);
  });

  it('does not modify the pills already placed', () => {
    const taken = [{ x: 640, y: 400 }];
    placePill(640, 400, taken, LIMITS);
    expect(taken).toEqual([{ x: 640, y: 400 }]);
  });
});
