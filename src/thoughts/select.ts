import type { ThoughtPlace } from '@/thoughts/content';

/**
 * Which people are thinking out loud, and what. Pure: no three.js, no DOM, so
 * the rules can be tested without a GPU (AGENTS.md 3).
 *
 * The rule that matters is the hold. A thought stays with the same person for
 * at least eight seconds, or the street reads as a slot machine rather than as
 * people (PLAN.md M3 task 2).
 */
export interface ThoughtCandidate {
  agent: number;
  place: ThoughtPlace;
  distanceM: number;
}

export interface ThoughtSlot {
  agent: number;
  place: ThoughtPlace;
  /** Index into the thought list for `place`. */
  text: number;
  /** When this thought was given, in seconds since the world started. */
  sinceS: number;
}

export interface SelectOptions {
  max: number;
  holdS: number;
  /** Chooses a thought for a place. Injected so this module stays pure. */
  pick: (place: ThoughtPlace, agent: number) => number;
}

export function selectThoughts(
  current: readonly ThoughtSlot[],
  candidates: readonly ThoughtCandidate[],
  nowS: number,
  options: SelectOptions,
): ThoughtSlot[] {
  const nearest = [...candidates].sort((a, b) => a.distanceM - b.distanceM);
  const byAgent = new Map<number, ThoughtCandidate>();
  for (const candidate of nearest) {
    if (!byAgent.has(candidate.agent)) byAgent.set(candidate.agent, candidate);
  }

  const kept: ThoughtSlot[] = [];
  const held = new Set<number>();
  for (const slot of current) {
    const candidate = byAgent.get(slot.agent);
    // Walked out of range: the thought goes with them.
    if (!candidate || held.has(slot.agent)) continue;
    held.add(slot.agent);
    if (candidate.place !== slot.place && nowS - slot.sinceS >= options.holdS) {
      kept.push({
        agent: slot.agent,
        place: candidate.place,
        text: options.pick(candidate.place, slot.agent),
        sinceS: nowS,
      });
    } else {
      kept.push(slot);
    }
    if (kept.length >= options.max) break;
  }

  for (const candidate of nearest) {
    if (kept.length >= options.max) break;
    if (held.has(candidate.agent)) continue;
    held.add(candidate.agent);
    kept.push({
      agent: candidate.agent,
      place: candidate.place,
      text: options.pick(candidate.place, candidate.agent),
      sinceS: nowS,
    });
  }

  return kept;
}

/**
 * A steady choice per person and place, so the same person keeps the same
 * thought rather than flickering between them frame to frame.
 */
export function steadyPick(agent: number, place: ThoughtPlace, count: number): number {
  if (count <= 0) return 0;
  let hash = agent * 2654435761;
  for (let i = 0; i < place.length; i++) hash = (hash ^ place.charCodeAt(i)) * 16777619;
  return Math.abs(hash % count);
}
