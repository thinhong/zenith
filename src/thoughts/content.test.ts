import { describe, expect, it } from 'vitest';
import {
  MAX_THOUGHT_LENGTH,
  MODERN_THOUGHTS,
  THOUGHT_PLACES,
  thoughtsFor,
  type ThoughtPlace,
  type ThoughtSet,
} from './content';
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
const ALL = SETS.flatMap(([, set]) => THOUGHT_PLACES.flatMap((place) => set[place]));

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
    for (const [name, set] of SETS) {
      const texts = THOUGHT_PLACES.flatMap((place) => set[place]);
      expect(new Set(texts).size, name).toBe(texts.length);
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

describe('thoughtsFor', () => {
  it('returns the set for a place', () => {
    expect(thoughtsFor(MODERN_THOUGHTS, 'work')).toBe(MODERN_THOUGHTS.work);
  });

  it('falls back to the street when a place has nothing', () => {
    const sparse = { ...MODERN_THOUGHTS, park: [] as readonly string[] };
    expect(thoughtsFor(sparse, 'park' as ThoughtPlace)).toBe(MODERN_THOUGHTS.street);
  });
});
