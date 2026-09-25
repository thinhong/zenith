import { describe, expect, it } from 'vitest';
import { AGE, lookAt } from './age';

describe('lookAt', () => {
  it('makes a child small with a large head, and an adult the model as it is', () => {
    const child = lookAt(6);
    expect(child.scale).toBeLessThan(0.75);
    expect(child.headScale).toBeGreaterThan(1.1);
    const adult = lookAt(25);
    expect(adult.scale).toBe(1);
    expect(adult.headScale).toBe(1);
  });

  it('keeps a young adult young', () => {
    const young = lookAt(19);
    expect(young.grey).toBe(0);
    expect(young.stoop).toBe(0);
    expect(young.glasses).toBe(false);
    expect(young.pace).toBe(1);
  });

  it('makes the old grey, bent, slower and bespectacled', () => {
    const old = lookAt(80);
    expect(old.grey).toBe(1);
    expect(old.stoop).toBeGreaterThan(0.5);
    expect(old.glasses).toBe(true);
    expect(old.pace).toBeLessThan(0.7);
    expect(old.pace).toBeGreaterThanOrEqual(AGE.slowest);
  });

  it('greys gradually, never backwards', () => {
    let last = -1;
    for (let age = 0; age <= 100; age += 1) {
      const grey = lookAt(age).grey;
      expect(grey).toBeGreaterThanOrEqual(last);
      last = grey;
    }
  });
});
