import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';

describe('parseSettings', () => {
  it('defaults to the start of the first life, running in real time', () => {
    const s = parseSettings('', false);
    expect(s.startS).toBe(0);
    expect(s.paused).toBe(false);
    expect(s.life).toBe(0);
    expect(s.captureFps).toBeNull();
    expect(s.debug).toBe(false);
  });

  it('reads a moment to hold for a screenshot', () => {
    const s = parseSettings('?t=31.5&pause=1&life=2&debug=1', true);
    expect(s.startS).toBe(31.5);
    expect(s.paused).toBe(true);
    expect(s.life).toBe(2);
    expect(s.debug).toBe(true);
    expect(s.reducedMotion).toBe(true);
  });

  it('reads a camera placed by hand, and ignores a broken one', () => {
    const s = parseSettings('?view=1,1.5,2,0,1,-1,35', false);
    expect(s.view).toEqual({ pos: [1, 1.5, 2], look: [0, 1, -1], fovDeg: 35 });
    expect(parseSettings('?view=1,2,3', false).view).toBeNull();
    expect(parseSettings('', false).view).toBeNull();
  });

  it('ignores nonsense', () => {
    const s = parseSettings('?t=abc&life=-3&capture=0', false);
    expect(s.startS).toBe(0);
    expect(s.life).toBe(0);
    expect(s.captureFps).toBeNull();
    expect(parseSettings('?capture=500', false).captureFps).toBe(60);
  });
});
