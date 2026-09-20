import { describe, expect, it } from 'vitest';
import {
  advanceEraChange,
  beginEraChange,
  createEraState,
  eraEase,
  ERA_TRANSITION_S,
  isChanging,
  RESEAT_AT,
} from './era';

describe('era changes', () => {
  it('starts settled on one era', () => {
    const state = createEraState('modern');
    expect(state.current).toBe('modern');
    expect(isChanging(state)).toBe(false);
    expect(state.progress).toBe(1);
  });

  it('does nothing when asked for the era already showing', () => {
    const state = createEraState('modern');
    expect(beginEraChange(state, 'modern')).toBe(false);
    expect(isChanging(state)).toBe(false);
  });

  it('runs for the full three seconds and then settles', () => {
    const state = createEraState('modern');
    beginEraChange(state, 'citadel');
    expect(state.leaving).toBe('modern');
    expect(state.current).toBe('citadel');

    advanceEraChange(state, ERA_TRANSITION_S / 2);
    expect(state.progress).toBeCloseTo(0.5, 6);
    expect(isChanging(state)).toBe(true);

    advanceEraChange(state, ERA_TRANSITION_S / 2);
    expect(state.progress).toBe(1);
    expect(isChanging(state)).toBe(false);
    expect(state.current).toBe('citadel');
  });

  it('marks the agents as needing to move across, once', () => {
    const state = createEraState('modern');
    beginEraChange(state, 'citadel');
    expect(state.reseated).toBe(false);
    advanceEraChange(state, ERA_TRANSITION_S);
    expect(state.reseated).toBe(true);
  });

  it('retargets rather than queueing when the dial is spun', () => {
    const state = createEraState('modern');
    beginEraChange(state, 'citadel');
    advanceEraChange(state, 1);
    beginEraChange(state, 'modern');
    // back to where it started, with the citadel now the one sinking
    expect(state.current).toBe('modern');
    expect(state.progress).toBe(0);
    advanceEraChange(state, ERA_TRANSITION_S);
    expect(isChanging(state)).toBe(false);
  });

  it('does not advance when nothing is changing', () => {
    const state = createEraState('modern');
    advanceEraChange(state, 10);
    expect(state.progress).toBe(1);
  });
});

describe('eraEase', () => {
  it('runs from 0 to 1 with flat ends', () => {
    expect(eraEase(0)).toBe(0);
    expect(eraEase(1)).toBe(1);
    expect(eraEase(0.5)).toBeCloseTo(0.5, 6);
    expect(eraEase(-1)).toBe(0);
    expect(eraEase(2)).toBe(1);
    // flat at both ends: the first tenth barely moves
    expect(eraEase(0.1)).toBeLessThan(0.02);
    expect(eraEase(0.9)).toBeGreaterThan(0.98);
  });

  it('never goes backwards', () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const value = eraEase(t);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it('is halfway through when the agents move across', () => {
    expect(eraEase(RESEAT_AT)).toBeCloseTo(0.5, 6);
  });
});
