import { describe, expect, it } from 'vitest';
import {
  AGENTS,
  ALTITUDE,
  altitudeBand,
  detailFactor,
  DETAIL,
  fogRange,
  NEAR_CUT,
  nearCutRange,
  smoothstep,
} from './altitude';

describe('altitudeBand', () => {
  it('maps metres to bands in order', () => {
    expect(altitudeBand(10)).toBe('street');
    expect(altitudeBand(100)).toBe('roof');
    expect(altitudeBand(800)).toBe('mountain');
    expect(altitudeBand(1500)).toBe('cloud');
    expect(altitudeBand(2400)).toBe('satellite');
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

describe('thought fade', () => {
  it('is gone by 70 m and unreadable by 60, as M3 asks', () => {
    expect(detailFactor(DETAIL.thoughts, 70)).toBe(0);
    expect(detailFactor(DETAIL.thoughts, 66)).toBe(0);
    expect(detailFactor(DETAIL.thoughts, 60)).toBeLessThan(0.25);
    expect(detailFactor(DETAIL.thoughts, 44)).toBe(1);
    expect(detailFactor(DETAIL.thoughts, 20)).toBe(1);
  });

  it('never shows text before the people it belongs to are drawn', () => {
    // figures appear far higher up than thoughts do, so a label can never
    // arrive before the person under it
    expect(DETAIL.thoughts.offM).toBeLessThan(AGENTS.figuresMaxM);
  });
});

describe('nearCutRange', () => {
  it('never reaches the point the camera is looking at', () => {
    for (let altitudeM = ALTITUDE.min; altitudeM <= ALTITUDE.max; altitudeM += 7) {
      const { fromM, toM } = nearCutRange(altitudeM);
      expect(fromM).toBeLessThan(toM);
      expect(toM).toBeLessThan(altitudeM * 0.5);
    }
  });

  it('stops growing past the street, so a tower top far below is left alone', () => {
    expect(nearCutRange(300)).toEqual({ fromM: NEAR_CUT.maxM, toM: NEAR_CUT.fadeMaxM });
    expect(nearCutRange(ALTITUDE.max)).toEqual({ fromM: NEAR_CUT.maxM, toM: NEAR_CUT.fadeMaxM });
  });
});
