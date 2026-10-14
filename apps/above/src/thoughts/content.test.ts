import { describe, expect, it } from 'vitest';
import {
  MAX_THOUGHT_LENGTH,
  MODERN_THOUGHTS,
  THOUGHT_PLACES,
  thoughtPool,
  thoughtsFor,
  timeOfDay,
  TIMES_OF_DAY,
  type ThoughtPlace,
  type ThoughtSet,
} from './content';
import { HUMAN_THOUGHTS } from './human-content';
import { ROLES } from '@/agents/schedule';
import { AFTER_THOUGHTS } from './after-content';
import { CITADEL_THOUGHTS } from './citadel-content';
import { MYTH_THOUGHTS } from './myth-content';

// Every era's set has to hold to the same rules, so they are tested together.
const SETS: ReadonlyArray<[string, ThoughtSet, number]> = [
  ['modern', MODERN_THOUGHTS, 60],
  ['myth', MYTH_THOUGHTS, 40],
  ['citadel', CITADEL_THOUGHTS, 40],
  ['after', AFTER_THOUGHTS, 40],
];
/** Every line in a set: its places, then its roles, then its times of day. */
function linesOf(set: ThoughtSet): string[] {
  return [
    ...THOUGHT_PLACES.flatMap((place) => set[place]),
    ...ROLES.flatMap((role) => set.byRole?.[role] ?? []),
    ...TIMES_OF_DAY.flatMap((time) => set.byTime?.[time] ?? []),
  ];
}

const ALL = [...SETS.flatMap(([, set]) => linesOf(set)), ...linesOf(HUMAN_THOUGHTS)];

describe('MODERN_THOUGHTS', () => {
  it('has a set for every place and enough of them overall', () => {
    for (const [name, set, least] of SETS) {
      const total = THOUGHT_PLACES.flatMap((place) => set[place]);
      expect(total.length, name).toBeGreaterThanOrEqual(least);
      for (const place of THOUGHT_PLACES) {
        expect(set[place].length, `${name} ${place}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('keeps every thought to one short line', () => {
    for (const text of ALL) {
      expect(text.length).toBeLessThanOrEqual(MAX_THOUGHT_LENGTH);
      expect(text.trim()).toBe(text);
      expect(text).not.toContain('\n');
    }
  });

  it('writes in the first person and ends each sentence', () => {
    for (const text of ALL) {
      expect(/[.?]$/.test(text)).toBe(true);
      expect(text[0]).toBe(text[0]?.toUpperCase());
    }
    // Half carry a pronoun. The rest are first person in voice without one
    // ("Five more minutes.", "Enough for three days."), which is how people
    // actually think, so the bar is the voice and not the word count.
    const firstPerson = ALL.filter((t) => /\b(I|me|my)\b/i.test(t));
    expect(firstPerson.length / ALL.length).toBeGreaterThan(0.5);
    // Nothing is narrated from outside the person. "Thank you. Just thank you."
    // at a temple is still their own voice, so second person is not banned.
    for (const text of ALL) expect(/\b(he|she|they)\s+(thinks|wonders|feels)\b/i.test(text)).toBe(false);
  });

  it('repeats nothing inside one era', () => {
    for (const [name, set] of [...SETS, ['human', HUMAN_THOUGHTS, 0] as const]) {
      const texts = linesOf(set);
      const seen = new Set<string>();
      for (const text of texts) {
        expect(seen.has(text), `${name}: "${text}"`).toBe(false);
        seen.add(text);
      }
    }
  });

  it('speaks for every kind of person and every part of the day, in every era', () => {
    for (const [name, set] of SETS) {
      for (const role of ROLES) {
        expect(set.byRole?.[role]?.length ?? 0, `${name} ${role}`).toBeGreaterThanOrEqual(8);
      }
      for (const time of TIMES_OF_DAY) {
        expect(set.byTime?.[time]?.length ?? 0, `${name} ${time}`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('has a large enough bag that a person rarely hears the same line twice', () => {
    // Every context a person can be in, in every era: the pool they draw from
    // is their era's place, role and time, plus the human core's.
    for (const [name, set] of SETS) {
      for (const place of THOUGHT_PLACES) {
        for (const role of ROLES) {
          for (const time of TIMES_OF_DAY) {
            const pool = thoughtPool(set, { place, role, time }, HUMAN_THOUGHTS);
            expect(pool.length, `${name} ${place} ${role} ${time}`).toBeGreaterThanOrEqual(60);
          }
        }
      }
    }
  });

  it('carries a few of the same worries from one era to the next', () => {
    // The clothes change, the worries do not (PLAN.md 1). A handful of lines
    // deliberately appear in both sets, and that is the whole idea.
    const modern = new Set(THOUGHT_PLACES.flatMap((place) => MODERN_THOUGHTS[place]));
    const citadel = THOUGHT_PLACES.flatMap((place) => CITADEL_THOUGHTS[place]);
    const shared = citadel.filter((text) => modern.has(text));
    expect(shared.length).toBeGreaterThanOrEqual(3);
    expect(shared.length).toBeLessThan(citadel.length / 4);
  });

  it('keeps out what PLAN.md 7 says to keep out', () => {
    // brands, politics, and the kind of contempt the whole app is against
    const banned = [
      'google',
      'facebook',
      'apple',
      'honda',
      'iphone',
      'party',
      'government',
      'election',
      'communist',
      'stupid',
      'idiot',
      'pathetic',
      'loser',
      'hate myself',
      'worthless',
    ];
    for (const text of ALL) {
      for (const word of banned) expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('avoids the em dash, like the rest of the writing here', () => {
    for (const text of ALL) {
      expect(text).not.toContain('—');
      expect(text).not.toContain('–');
    }
  });
});

describe('HUMAN_THOUGHTS', () => {
  it('is large, because every era stands on it', () => {
    expect(linesOf(HUMAN_THOUGHTS).length).toBeGreaterThanOrEqual(240);
  });

  it('is true in all four worlds, so it names nothing from one of them', () => {
    // Anything here is thought by somebody in a myth town and somebody in
    // 2300 alike, so no machines, no clocks, no drinks or money with a name.
    // Whole words, or "business" is caught for containing a bus.
    const anachronisms = [
      'phones?', 'texts?', 'texted', 'emails?', 'screens?', 'scooters?', 'cars?', 'bus',
      'buses', 'trains?', 'coffee', 'tea', "o'clock", 'minutes?', 'dong', 'coins?',
      'dollars?', 'offices?', 'computers?', 'internet', 'mandarins?', 'dragons?', 'pods?',
      'spreadsheets?', 'wyrm', 'exam',
    ].map((word) => new RegExp(`\\b${word}\\b`, 'i'));
    const offenders = linesOf(HUMAN_THOUGHTS).filter((text) =>
      anachronisms.some((pattern) => pattern.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it('does not repeat a line an era already says', () => {
    const core = new Set(linesOf(HUMAN_THOUGHTS));
    for (const [name, set] of SETS) {
      for (const text of linesOf(set)) expect(core.has(text), `${name}: "${text}"`).toBe(false);
    }
  });
});

describe('timeOfDay', () => {
  it('divides the day the way people do', () => {
    expect(timeOfDay(6)).toBe('dawn');
    expect(timeOfDay(9.5)).toBe('morning');
    expect(timeOfDay(14)).toBe('afternoon');
    expect(timeOfDay(18)).toBe('evening');
    expect(timeOfDay(23)).toBe('night');
    expect(timeOfDay(2)).toBe('night');
  });

  it('turns over exactly on the hour', () => {
    expect(timeOfDay(4.99)).toBe('night');
    expect(timeOfDay(5)).toBe('dawn');
    expect(timeOfDay(20.99)).toBe('evening');
    expect(timeOfDay(21)).toBe('night');
  });

  it('wraps a clock past midnight', () => {
    expect(timeOfDay(24 + 9)).toBe('morning');
    expect(timeOfDay(-1)).toBe('night');
  });
});

describe('thoughtPool', () => {
  it('draws on the era and the core together', () => {
    const pool = thoughtPool(MODERN_THOUGHTS, { place: 'work', role: 'student', time: 'night' }, HUMAN_THOUGHTS);
    expect(pool).toContain(MODERN_THOUGHTS.work[0]);
    expect(pool).toContain(HUMAN_THOUGHTS.work[0]);
    expect(pool).toContain(HUMAN_THOUGHTS.byRole?.student?.[0]);
    expect(pool).toContain(HUMAN_THOUGHTS.byTime?.night?.[0]);
  });

  it('leaves out what belongs to somebody else', () => {
    const pool = thoughtPool(MODERN_THOUGHTS, { place: 'work', role: 'student', time: 'night' }, HUMAN_THOUGHTS);
    expect(pool).not.toContain(HUMAN_THOUGHTS.byRole?.retired?.[0]);
    expect(pool).not.toContain(HUMAN_THOUGHTS.byTime?.dawn?.[0]);
    expect(pool).not.toContain(HUMAN_THOUGHTS.market[0]);
  });

  it('holds each line once, however many lists it is in', () => {
    const pool = thoughtPool(MODERN_THOUGHTS, { place: 'home', role: 'retired', time: 'evening' }, HUMAN_THOUGHTS);
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('hands back the same list for the same context', () => {
    const context = { place: 'park', role: 'shop', time: 'dawn' } as const;
    expect(thoughtPool(MODERN_THOUGHTS, context, HUMAN_THOUGHTS)).toBe(
      thoughtPool(MODERN_THOUGHTS, context, HUMAN_THOUGHTS),
    );
  });
});

describe('thoughtsFor', () => {
  it('returns the set for a place', () => {
    expect(thoughtsFor(MODERN_THOUGHTS, 'work')).toBe(MODERN_THOUGHTS.work);
  });

  it('falls back to the street when a place has nothing', () => {
    const sparse = { ...MODERN_THOUGHTS, park: [] as readonly string[] };
    expect(thoughtsFor(sparse, 'park' as ThoughtPlace)).toBe(MODERN_THOUGHTS.street);
  });
});
