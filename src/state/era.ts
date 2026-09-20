import type { EraId } from '@/world/eras';

/**
 * Which era is showing, and how far through a change we are. Pure: no three.js,
 * so the timing can be tested without a GPU.
 *
 * A change takes three seconds (PLAN.md 4.6). The old city sinks into the
 * ground while the new one rises out of it, and the people are moved across
 * halfway, when both are half height and nobody can see the join.
 */
export const ERA_TRANSITION_S = 3;

/** How far through the change the agents are moved to the new layout. */
export const RESEAT_AT = 0.5;

export interface EraState {
  current: EraId;
  /** The era sinking out of view, or null when nothing is changing. */
  leaving: EraId | null;
  /** 0 at the start of a change, 1 when it is done. */
  progress: number;
  /** True once the agents have been moved across for this change. */
  reseated: boolean;
}

export function createEraState(start: EraId): EraState {
  return { current: start, leaving: null, progress: 1, reseated: true };
}

export function isChanging(state: EraState): boolean {
  return state.leaving !== null;
}

/**
 * Starts a change. Asking for the era that is already showing does nothing;
 * asking during a change replaces the target, so a viewer spinning the dial
 * does not queue up a backlog of eras.
 */
export function beginEraChange(state: EraState, to: EraId): boolean {
  if (to === state.current && !isChanging(state)) return false;
  state.leaving = state.current === to ? state.leaving : state.current;
  state.current = to;
  state.progress = 0;
  state.reseated = false;
  return state.leaving !== null;
}

/**
 * `overS` is how long the whole change should take. A viewer who has asked
 * their system for less movement gets a cut instead of a three-second sink
 * and rise, which is the one place in Zenith where a lot of the picture moves
 * without them having asked it to.
 */
export function advanceEraChange(state: EraState, dtS: number, overS = ERA_TRANSITION_S): void {
  if (!isChanging(state)) return;
  state.progress = Math.min(1, state.progress + dtS / Math.max(1e-3, overS));
  if (state.progress >= 1) {
    state.leaving = null;
    state.reseated = true;
  }
}

/** Smootherstep, so the sink and the rise have no corners at either end. */
export function eraEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}
