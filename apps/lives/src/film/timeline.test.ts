import { describe, expect, it } from 'vitest';
import { darkness, locate, totalDuration } from './timeline';

const SHOTS = [
  { id: 'a', durationS: 4, fadeInS: 2 },
  { id: 'b', durationS: 6 },
  { id: 'c', durationS: 5, fadeOutS: 1 },
];

describe('locate', () => {
  it('finds the shot on screen and how far into it we are', () => {
    expect(locate(SHOTS, 0).shot.id).toBe('a');
    expect(locate(SHOTS, 3.99).shot.id).toBe('a');
    const b = locate(SHOTS, 4);
    expect(b.shot.id).toBe('b');
    expect(b.localS).toBeCloseTo(0);
    expect(b.startS).toBe(4);
    expect(locate(SHOTS, 13).progress).toBeCloseTo(3 / 5);
  });

  it('loops, and each loop is the next life', () => {
    const total = totalDuration(SHOTS);
    expect(total).toBe(15);
    const again = locate(SHOTS, total + 1);
    expect(again.shot.id).toBe('a');
    expect(again.life).toBe(1);
    expect(locate(SHOTS, total * 3 + 14.5).life).toBe(3);
  });

  it('treats a negative time as the start', () => {
    expect(locate(SHOTS, -5).shot.id).toBe('a');
    expect(locate(SHOTS, -5).life).toBe(0);
  });

  it('refuses a film with no length', () => {
    expect(() => locate([], 1)).toThrow();
  });
});

describe('darkness', () => {
  it('fades up from black and down to black at the marked joins', () => {
    expect(darkness(locate(SHOTS, 0))).toBe(1);
    expect(darkness(locate(SHOTS, 1))).toBeCloseTo(0.5);
    expect(darkness(locate(SHOTS, 2.5))).toBe(0);
    expect(darkness(locate(SHOTS, 7))).toBe(0);
    expect(darkness(locate(SHOTS, 14.5))).toBeCloseTo(0.5);
    expect(darkness(locate(SHOTS, 14.999))).toBeCloseTo(1, 2);
  });
});
