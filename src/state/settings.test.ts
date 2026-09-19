import { describe, expect, it } from 'vitest';
import { ALTITUDE } from './altitude';
import { parseSettings } from './settings';

describe('parseSettings', () => {
  it('defaults to seed 1 and no overrides', () => {
    const s = parseSettings('', false);
    expect(s).toEqual({ seed: 1, reducedMotion: false, fixedHour: null, startAltitudeM: null });
  });

  it('reads the seed so a city can be shared', () => {
    expect(parseSettings('?seed=123', false).seed).toBe(123);
  });

  it('ignores a seed that is not a number', () => {
    expect(parseSettings('?seed=abc', false).seed).toBe(1);
  });

  it('clamps the debug overrides into range', () => {
    expect(parseSettings('?hour=99', false).fixedHour).toBe(24);
    expect(parseSettings('?alt=0', false).startAltitudeM).toBe(ALTITUDE.min);
    expect(parseSettings('?alt=99999', false).startAltitudeM).toBe(ALTITUDE.max);
  });

  it('passes reduced motion through', () => {
    expect(parseSettings('', true).reducedMotion).toBe(true);
  });
});
