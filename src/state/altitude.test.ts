import { describe, expect, it } from 'vitest';
import { altitudeBand, detailFactor, DETAIL, fogRange, smoothstep } from './altitude';

describe('altitudeBand', () => {
  it('maps metres to bands in order', () => {
    expect(altitudeBand(10)).toBe('street');
    expect(altitudeBand(100)).toBe('roof');
    expect(altitudeBand(800)).toBe('mountain');
    expect(altitudeBand(2000)).toBe('cloud');
    expect(altitudeBand(5000)).toBe('satellite');
  });
});

describe('smoothstep', () => {
  it('clamps and is monotonic', () => {
    expect(smoothstep(0, 10, -5)).toBe(0);
    expect(smoothstep(0, 10, 15)).toBe(1);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5);
  });
});

describe('fogRange', () => {
  it('keeps the ground under the viewer clear at every altitude', () => {
    for (const alt of [12, 300, 900, 3500, 6000]) {
      const { nearM, farM } = fogRange(alt);
      // the ground directly below is `alt` away and must sit inside the near plane
      expect(nearM).toBeGreaterThan(alt);
      expect(farM).toBeGreaterThan(nearM);
    }
  });
});

describe('detailFactor', () => {
  it('is on low down, off high up, and smooth between', () => {
    expect(detailFactor(DETAIL.windows, 100)).toBe(1);
    expect(detailFactor(DETAIL.windows, 5000)).toBe(0);
    const mid = detailFactor(DETAIL.windows, (DETAIL.windows.onM + DETAIL.windows.offM) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
