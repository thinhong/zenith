import { describe, expect, it } from 'vitest';
import { nightFactorAt, skyAt, sunDirection } from './sky';

describe('nightFactorAt', () => {
  it('is fully night in the small hours and fully day at noon', () => {
    expect(nightFactorAt(2)).toBe(1);
    expect(nightFactorAt(12)).toBe(0);
    expect(nightFactorAt(23)).toBe(1);
  });

  it('fades in across dusk rather than switching', () => {
    const dusk = nightFactorAt(18.3);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(nightFactorAt(19)).toBeGreaterThan(dusk);
  });
});

describe('sunDirection', () => {
  it('stays above the horizon at every hour', () => {
    for (let h = 0; h <= 24; h += 0.25) expect(sunDirection(h).y).toBeGreaterThan(0);
  });

  it('is a unit vector', () => {
    for (const h of [0, 6, 12, 18, 23.5]) {
      const d = sunDirection(h);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });

  it('crosses from east to west over the day', () => {
    expect(sunDirection(7).x).toBeGreaterThan(sunDirection(17).x);
  });
});

describe('skyAt', () => {
  it('returns colours inside 0..1 and a brighter sun at noon than at midnight', () => {
    for (let h = 0; h <= 24; h += 0.5) {
      const s = skyAt(h);
      for (const c of [s.sky, s.fog, s.sunColor, s.ambientColor]) {
        expect(Math.min(c.r, c.g, c.b)).toBeGreaterThanOrEqual(0);
        expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(1);
      }
    }
    expect(skyAt(12).sunIntensity).toBeGreaterThan(skyAt(0).sunIntensity);
  });

  it('is continuous across the midnight seam', () => {
    const before = skyAt(23.99);
    const after = skyAt(0.01);
    expect(Math.abs(before.sky.r - after.sky.r)).toBeLessThan(0.02);
    expect(Math.abs(before.sky.b - after.sky.b)).toBeLessThan(0.02);
  });
});
