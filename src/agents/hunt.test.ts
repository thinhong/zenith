import { describe, expect, it } from 'vitest';
import { HUNT, IDLE, stepEngagement, strikePhase, type Engagement, type HuntRules } from '@/agents/hunt';

const RULES: HuntRules = {
  senseM: 40,
  engageM: 3,
  loseInterestM: 70,
  fightS: 6,
  fleeS: 5,
};

/** Runs the pair for a while, closing the distance the way the caller would. */
function run(steps: number, distanceAt: (step: number) => number): Engagement[] {
  let state = IDLE;
  const seen: Engagement[] = [];
  for (let i = 0; i < steps; i++) {
    state = stepEngagement(state, distanceAt(i), 1 / 10, RULES);
    seen.push(state);
  }
  return seen;
}

describe('stepEngagement', () => {
  it('leaves a hero alone when there is nothing to see', () => {
    expect(stepEngagement(IDLE, 500, 0.1, RULES)).toEqual(IDLE);
  });

  it('leaves a hero alone when there is no beast in the world at all', () => {
    expect(stepEngagement(IDLE, 0, 0.1, RULES, false)).toEqual(IDLE);
  });

  it('starts the chase once the beast is near enough to see', () => {
    const next = stepEngagement(IDLE, RULES.senseM - 1, 0.1, RULES);
    expect(next.hero).toBe(HUNT.hunt);
    expect(next.beast).toBe(HUNT.hunt);
  });

  it('does not start it one metre too soon', () => {
    expect(stepEngagement(IDLE, RULES.senseM + 1, 0.1, RULES)).toEqual(IDLE);
  });

  it('joins the fight when they are within reach', () => {
    const chasing: Engagement = { hero: HUNT.hunt, beast: HUNT.hunt, timerS: 0 };
    const next = stepEngagement(chasing, RULES.engageM, 0.1, RULES);
    expect(next.hero).toBe(HUNT.fight);
    expect(next.timerS).toBe(RULES.fightS);
  });

  it('gives up a chase that runs too far', () => {
    const chasing: Engagement = { hero: HUNT.hunt, beast: HUNT.hunt, timerS: 0 };
    expect(stepEngagement(chasing, RULES.loseInterestM + 1, 0.1, RULES)).toEqual(IDLE);
  });

  it('gives up when the beast it was chasing is gone', () => {
    const chasing: Engagement = { hero: HUNT.hunt, beast: HUNT.hunt, timerS: 0 };
    expect(stepEngagement(chasing, 5, 0.1, RULES, false)).toEqual(IDLE);
  });

  it('holds the fight for its whole length and no longer', () => {
    let state: Engagement = { hero: HUNT.fight, beast: HUNT.fight, timerS: RULES.fightS };
    let ticks = 0;
    while (state.hero === HUNT.fight && ticks < 1000) {
      state = stepEngagement(state, 2, 0.1, RULES);
      ticks++;
    }
    // Within a tick: subtracting 0.1 sixty times does not land exactly on
    // zero, and the timer is float seconds rather than a tick count.
    expect(ticks).toBeGreaterThanOrEqual(Math.round(RULES.fightS / 0.1));
    expect(ticks).toBeLessThanOrEqual(Math.round(RULES.fightS / 0.1) + 1);
    expect(state.beast).toBe(HUNT.flee);
  });

  it('does not break off a fight just because they drift apart', () => {
    const fighting: Engagement = { hero: HUNT.fight, beast: HUNT.fight, timerS: 3 };
    expect(stepEngagement(fighting, 500, 0.1, RULES).hero).toBe(HUNT.fight);
  });

  it('lets the beast run, then settles both of them', () => {
    let state: Engagement = { hero: HUNT.roam, beast: HUNT.flee, timerS: RULES.fleeS };
    let ticks = 0;
    while (state.beast === HUNT.flee && ticks < 1000) {
      // Right next to the hero the whole time: fleeing must not restart it.
      state = stepEngagement(state, 1, 0.1, RULES);
      ticks++;
    }
    expect(ticks).toBeGreaterThanOrEqual(Math.round(RULES.fleeS / 0.1));
    expect(ticks).toBeLessThanOrEqual(Math.round(RULES.fleeS / 0.1) + 1);
    expect(state).toEqual(IDLE);
  });

  it('runs a whole hunt through, from noticing to going home', () => {
    // Closes at 4 m a second from 60 m, holds close through the fight, and
    // then the beast gets away. Without that last part the two are left
    // standing on each other and correctly start the whole thing again,
    // which is the behaviour wanted and not what this test is about.
    const seen = run(460, (step) => (step < 260 ? Math.max(1, 60 - step * 0.4) : 400));
    const states = seen.map((s) => s.hero);
    expect(states).toContain(HUNT.hunt);
    expect(states).toContain(HUNT.fight);
    expect(seen.some((s) => s.beast === HUNT.flee)).toBe(true);
    expect(seen[seen.length - 1]).toEqual(IDLE);
  });

  it('picks the fight up again if the two are still nose to nose', () => {
    // A beast that does not get away is fought again, which is what should
    // happen: the alternative is two shapes standing next to each other
    // ignoring one another for ever.
    const seen = run(400, () => 1);
    const fights = seen.filter(
      (state, i) => state.hero === HUNT.fight && seen[i - 1]?.hero !== HUNT.fight,
    );
    expect(fights.length).toBeGreaterThanOrEqual(2);
  });

  it('never leaves the two in states that do not belong together', () => {
    for (const state of run(300, (step) => Math.max(1, 60 - step * 0.4))) {
      if (state.hero === HUNT.fight) expect(state.beast).toBe(HUNT.fight);
      if (state.hero === HUNT.hunt) expect(state.beast).toBe(HUNT.hunt);
      expect(state.timerS).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('strikePhase', () => {
  it('is still while nobody is fighting', () => {
    expect(strikePhase(IDLE, RULES)).toBe(0);
    expect(strikePhase({ hero: HUNT.hunt, beast: HUNT.hunt, timerS: 0 }, RULES)).toBe(0);
  });

  it('stays within a single lunge either way', () => {
    for (let t = RULES.fightS; t >= 0; t -= 0.05) {
      const phase = strikePhase({ hero: HUNT.fight, beast: HUNT.fight, timerS: t }, RULES);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(1);
    }
  });

  it('strikes more than once in a fight', () => {
    let peaks = 0;
    let rising = false;
    let previous = 0;
    for (let t = RULES.fightS; t >= 0; t -= 0.02) {
      const phase = strikePhase({ hero: HUNT.fight, beast: HUNT.fight, timerS: t }, RULES);
      if (phase > previous) rising = true;
      else if (rising && phase < previous) {
        peaks++;
        rising = false;
      }
      previous = phase;
    }
    expect(peaks).toBeGreaterThanOrEqual(2);
  });
});
