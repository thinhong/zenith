import type { Role } from '@/agents/schedule';
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
  /** What kind of person this is, when the caller knows. */
  role?: Role;
}

export interface ThoughtSlot {
  agent: number;
  place: ThoughtPlace;
  /**
   * The line itself, not an index into a list. A person's pool depends on the
   * time of day as well as the place now, so an index taken at noon would
   * point at a different line after five o'clock. Keeping the words is what
   * lets a held thought stay put while the day moves under it.
   */
  text: string;
  /** When this thought was given, in seconds since the world started. */
  sinceS: number;
}

export interface SelectOptions {
  max: number;
  holdS: number;
  /**
   * Chooses the line for a person. Injected so this module stays pure: the
   * caller knows their role and the hour, and this module need not.
   */
  pick: (candidate: ThoughtCandidate) => string;
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
        text: options.pick(candidate),
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
      text: options.pick(candidate),
      sinceS: nowS,
    });
  }

  return kept;
}

/**
 * A steady choice per person and place, so the same person keeps the same
 * thought rather than flickering between them frame to frame.
 */
export function steadyPick(agent: number, place: string, count: number): number {
  if (count <= 0) return 0;
  // Math.imul, not `*`. A 32-bit multiply done in doubles passes 2^53 once the
  // agent index is in the thousands, and the low bits round away: every person
  // in a building then hashed to the same number, so opening an office showed
  // four people reading the same sentence back at each other.
  let hash = Math.imul(agent + 1, 2654435761);
  for (let i = 0; i < place.length; i++) {
    hash = Math.imul(hash ^ place.charCodeAt(i), 16777619);
  }
  // A final avalanche, so people sitting next to each other (and so numbered
  // next to each other) do not land on neighbouring lines either.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return Math.abs(hash % count);
}
