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
import { POOL } from '@/agents/pool';
import { availableEras, buildLayout, ERA_POPULATION } from '@/world/eras';
import { mulberry32 } from '@/world/seed';
import { buildTerrain } from '@/world/terrain';

const BUILT_ERAS = availableEras();

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

describe('every era is as busy as every other', () => {
  it('asks for the same population', () => {
    for (const era of BUILT_ERAS) {
      expect(era.population.people, era.name).toBe(ERA_POPULATION);
    }
  });

  it('has the homes to actually hold them', () => {
    // A wish is not a population. `populate` will not put more people in a
    // town than homes * perHomeLot, and 2300 is built high on few plots: it
    // asked for 13,000 and quietly got 8,260 until this was checked.
    for (const era of BUILT_ERAS) {
      const layout = buildLayout(era, mulberry32(1), buildTerrain(mulberry32(1)));
      const homes = layout.lots.filter((lot) => lot.use === 'home').length;
      expect(homes * POOL.perHomeLot, `${era.name} ceiling`).toBeGreaterThanOrEqual(ERA_POPULATION);
    }
  });

  it('keeps the pool big enough for any of them', () => {
    expect(POOL.maxPeople).toBeGreaterThanOrEqual(ERA_POPULATION);
  });
});

describe('a change for a viewer who wants less movement', () => {
  it('finishes in one frame instead of sinking and rising', () => {
    const state = createEraState('modern');
    beginEraChange(state, 'citadel');
    advanceEraChange(state, 1 / 60, 0);
    expect(state.progress).toBe(1);
    expect(isChanging(state)).toBe(false);
  });

  it('still takes the full three seconds by default', () => {
    const state = createEraState('modern');
    beginEraChange(state, 'citadel');
    advanceEraChange(state, 1 / 60);
    expect(state.progress).toBeLessThan(0.02);
    expect(isChanging(state)).toBe(true);
  });
});
