import { describe, expect, it } from 'vitest';
import { selectThoughts, steadyPick, type ThoughtCandidate } from './select';
import { MODERN_THOUGHTS, THOUGHT_PLACES } from './content';

const pick = (place: string, agent: number): number => (agent + place.length) % 7;
const options = { max: 6, holdS: 8, pick };

function candidate(agent: number, distanceM: number, place: ThoughtCandidate['place'] = 'street'): ThoughtCandidate {
  return { agent, place, distanceM };
}

describe('selectThoughts', () => {
  it('never shows more than the cap', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(i, i));
    expect(selectThoughts([], candidates, 0, options)).toHaveLength(6);
  });

  it('takes the nearest people first', () => {
    const candidates = [candidate(9, 30), candidate(4, 5), candidate(7, 12)];
    const chosen = selectThoughts([], candidates, 0, { ...options, max: 2 });
    expect(chosen.map((s) => s.agent)).toEqual([4, 7]);
  });

  it('gives nobody two thoughts at once', () => {
    const candidates = [candidate(3, 1), candidate(3, 2), candidate(5, 4)];
    const chosen = selectThoughts([], candidates, 0, options);
    expect(new Set(chosen.map((s) => s.agent)).size).toBe(chosen.length);
  });

  it('keeps a thought with the same person while they stay in range', () => {
    const first = selectThoughts([], [candidate(2, 10)], 0, options);
    const later = selectThoughts(first, [candidate(2, 14)], 3, options);
    expect(later).toEqual(first);
  });

  it('holds the text for eight seconds even when the person changes what they are doing', () => {
    const first = selectThoughts([], [candidate(2, 10, 'street')], 0, options);
    const soon = selectThoughts(first, [candidate(2, 10, 'market')], 5, options);
    expect(soon[0]?.text).toBe(first[0]?.text);
    expect(soon[0]?.place).toBe('street');
    const after = selectThoughts(first, [candidate(2, 10, 'market')], 9, options);
    expect(after[0]?.place).toBe('market');
    expect(after[0]?.sinceS).toBe(9);
  });

  it('drops a thought when its person walks out of range', () => {
    const first = selectThoughts([], [candidate(2, 10), candidate(8, 20)], 0, options);
    const later = selectThoughts(first, [candidate(8, 20)], 20, options);
    expect(later.map((s) => s.agent)).toEqual([8]);
  });

  it('fills the space someone left with the next nearest', () => {
    const first = selectThoughts([], [candidate(1, 5)], 0, { ...options, max: 2 });
    const later = selectThoughts(first, [candidate(1, 5), candidate(6, 9)], 2, { ...options, max: 2 });
    expect(later.map((s) => s.agent).sort()).toEqual([1, 6]);
    expect(later.find((s) => s.agent === 1)?.sinceS).toBe(0);
  });

  it('returns nothing when nobody is near', () => {
    const first = selectThoughts([], [candidate(1, 5)], 0, options);
    expect(selectThoughts(first, [], 30, options)).toEqual([]);
  });
});

describe('steadyPick', () => {
  it('is stable for the same person and place', () => {
    for (let agent = 0; agent < 50; agent++) {
      expect(steadyPick(agent, 'work', 14)).toBe(steadyPick(agent, 'work', 14));
    }
  });

  it('stays inside the list', () => {
    for (const place of THOUGHT_PLACES) {
      const count = MODERN_THOUGHTS[place].length;
      for (let agent = 0; agent < 500; agent++) {
        const index = steadyPick(agent, place, count);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    }
  });

  it('spreads across the list rather than favouring one', () => {
    const seen = new Set<number>();
    for (let agent = 0; agent < 400; agent++) seen.add(steadyPick(agent, 'street', 14));
    expect(seen.size).toBeGreaterThan(8);
  });

  it('copes with an empty list', () => {
    expect(steadyPick(3, 'park', 0)).toBe(0);
  });
});

describe('steadyPick spread', () => {
  it('does not give a whole building the same thought', () => {
    // The bug: a 32-bit multiply in doubles loses its low bits once the agent
    // index is in the thousands, so everybody in one room picked line zero.
    const picks = new Set<number>();
    for (let agent = 1600; agent < 1660; agent++) picks.add(steadyPick(agent, 'work', 8));
    expect(picks.size).toBeGreaterThan(4);
  });

  it('spreads across the whole list, not just the first few', () => {
    const counts = new Array<number>(9).fill(0);
    for (let agent = 0; agent < 9000; agent++) {
      const pick = steadyPick(agent, 'home', 9);
      counts[pick] = (counts[pick] ?? 0) + 1;
    }
    // Every line gets used, and none of them takes more than a third.
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThan(3000);
  });

  it('keeps neighbours apart, not merely different', () => {
    let same = 0;
    for (let agent = 0; agent < 2000; agent++) {
      if (steadyPick(agent, 'street', 7) === steadyPick(agent + 1, 'street', 7)) same++;
    }
    // Chance alone would pair about a seventh of them; anything near all of
    // them means the hash is not mixing.
    expect(same).toBeLessThan(500);
  });

  it('still gives one person the same thought every time', () => {
    expect(steadyPick(4242, 'temple', 7)).toBe(steadyPick(4242, 'temple', 7));
  });
});
