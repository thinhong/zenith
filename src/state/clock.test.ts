import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, DAY_LENGTH_S, localHour, wrapHour } from './clock';

describe('wrapHour', () => {
  it('keeps the hour inside [0, 24)', () => {
    expect(wrapHour(0)).toBe(0);
    expect(wrapHour(23.5)).toBe(23.5);
    expect(wrapHour(24)).toBe(0);
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-1)).toBe(23);
  });
});

describe('advanceClock', () => {
  it('takes one day length to come back to the same hour', () => {
    const clock = createClock(6);
    advanceClock(clock, DAY_LENGTH_S);
    expect(clock.hourOfDay).toBeCloseTo(6, 6);
  });

  it('moves a quarter day in a quarter of the day length', () => {
    const clock = createClock(0);
    advanceClock(clock, DAY_LENGTH_S / 4);
    expect(clock.hourOfDay).toBeCloseTo(6, 6);
  });

  it('does not move while paused', () => {
    const clock = createClock(12);
    clock.paused = true;
    advanceClock(clock, 100);
    expect(clock.hourOfDay).toBe(12);
  });
});

describe('localHour', () => {
  it('reads the hour off the device clock', () => {
    // 09:30:00 local. Built with the local constructor on purpose: the point
    // is the viewer's own wall clock, not UTC.
    expect(localHour(new Date(2026, 8, 20, 9, 30, 0))).toBeCloseTo(9.5, 6);
  });

  it('carries the minutes and seconds, so dusk arrives gradually', () => {
    expect(localHour(new Date(2026, 8, 20, 17, 45, 36))).toBeCloseTo(17.76, 2);
  });

  it('gives midnight as zero, not twenty-four', () => {
    expect(localHour(new Date(2026, 8, 20, 0, 0, 0))).toBe(0);
  });

  it('stays inside the day at the last second of it', () => {
    const hour = localHour(new Date(2026, 8, 20, 23, 59, 59));
    expect(hour).toBeGreaterThan(23.9);
    expect(hour).toBeLessThan(24);
  });
});
