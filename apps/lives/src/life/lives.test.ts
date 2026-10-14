import { describe, expect, it } from 'vitest';
import { LIFE_COUNT, paletteFor } from './lives';

describe('paletteFor', () => {
  it('keeps the model as it is in the first life and changes it in the next', () => {
    expect(paletteFor(0).hairAmount).toBe(0);
    expect(paletteFor(1).hairAmount).toBeGreaterThan(0);
  });

  it('cycles through the lives', () => {
    expect(paletteFor(LIFE_COUNT)).toBe(paletteFor(0));
    expect(paletteFor(-1)).toBe(paletteFor(LIFE_COUNT - 1));
  });
});
