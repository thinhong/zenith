import { describe, expect, it } from 'vitest';
import { seasonAt, skyAt, wrapHour } from './sky';

describe('skyAt', () => {
  it('is dark at night and lit at noon', () => {
    expect(skyAt(1).night).toBeGreaterThan(0.9);
    expect(skyAt(1).sun).toBe(0);
    expect(skyAt(12).night).toBe(0);
    expect(skyAt(12).sun).toBeGreaterThan(1);
  });

  it('turns the lamp on after dark only', () => {
    expect(skyAt(12).lamp).toBe(0);
    expect(skyAt(22).lamp).toBe(1);
  });

  it('moves the sun from left to right behind the window, and keeps it above the floor', () => {
    const morning = skyAt(8).sunDir;
    const evening = skyAt(17.5).sunDir;
    expect(morning[0]).toBeLessThan(0);
    expect(evening[0]).toBeGreaterThan(0);
    for (const hour of [6, 9, 12, 15, 18]) {
      const [x, y, z] = skyAt(hour).sunDir;
      expect(y).toBeGreaterThan(0);
      // Always from the window side of the room.
      expect(z).toBeLessThan(0);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it('wraps the hour, so a time-lapse can run for days', () => {
    expect(wrapHour(24 * 7 + 3)).toBeCloseTo(3);
    expect(skyAt(24 * 3 + 12).sun).toBeCloseTo(skyAt(12).sun);
  });
});

describe('seasonAt', () => {
  it('blossoms in spring, snows in winter', () => {
    expect(seasonAt(0.09).fall).toBe('petal');
    expect(seasonAt(0.36).fall).toBe('none');
    expect(seasonAt(0.62).fall).toBe('leaf');
    expect(seasonAt(0.86).fall).toBe('snow');
    expect(seasonAt(0.86).snow).toBeGreaterThan(0.5);
    expect(seasonAt(0.36).snow).toBe(0);
  });

  it('thins the crown in winter', () => {
    expect(seasonAt(0.86).density).toBeLessThan(seasonAt(0.36).density);
  });

  it('repeats every year', () => {
    expect(seasonAt(12.62).fall).toBe(seasonAt(0.62).fall);
    const w = seasonAt(5.3).weights;
    expect(w[0] + w[1] + w[2] + w[3]).toBeCloseTo(1);
  });
});
