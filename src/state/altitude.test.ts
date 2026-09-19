import { describe, expect, it } from 'vitest';
import { altitudeBand, smoothstep } from './altitude';

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
