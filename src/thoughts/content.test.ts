import { describe, expect, it } from 'vitest';
import {
  MAX_THOUGHT_LENGTH,
  MODERN_THOUGHTS,
  THOUGHT_PLACES,
  thoughtsFor,
  type ThoughtPlace,
} from './content';

const ALL = THOUGHT_PLACES.flatMap((place) => MODERN_THOUGHTS[place]);

describe('MODERN_THOUGHTS', () => {
  it('has a set for every place and enough of them overall', () => {
    for (const place of THOUGHT_PLACES) {
      expect(MODERN_THOUGHTS[place].length).toBeGreaterThanOrEqual(10);
    }
    expect(ALL.length).toBeGreaterThanOrEqual(60);
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

  it('repeats nothing', () => {
    expect(new Set(ALL).size).toBe(ALL.length);
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
