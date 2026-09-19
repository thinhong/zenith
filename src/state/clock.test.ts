import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, DAY_LENGTH_S, wrapHour } from './clock';

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
