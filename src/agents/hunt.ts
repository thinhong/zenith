/**
 * What happens when a hero and a beast notice each other.
 *
 * Pure: no three.js, no pool, no randomness that is not handed in, so the
 * whole fight can be stepped and checked without a GPU (AGENTS.md 3).
 *
 * It is deliberately a small machine. Four states and one timer, and the
 * pair moves through them together: both notice, both close, both fight,
 * one breaks off. There is no health, no damage and no winner worth the
 * name, because the piece is not a game and a fight it could lose would
 * change what the whole thing is about. What a viewer sees from above is two
 * shapes circling, closing, striking at each other for a few seconds, and
 * then one of them going home. That reads as a fight. Anything more would
 * only be visible in numbers nobody is shown.
 */

export const HUNT = {
  roam: 0,
  /** Closing on the other one. */
  hunt: 1,
  /** Within reach, trading blows. */
  fight: 2,
  /** Broken off and running. */
  flee: 3,
} as const;

export type HuntState = (typeof HUNT)[keyof typeof HUNT];

export interface HuntRules {
  /** How far off a hero notices a beast, in metres. */
  senseM: number;
  /** How close the two get before the fight starts. */
  engageM: number;
  /** Past this, a chase is given up: a hero will not follow one for ever. */
  loseInterestM: number;
  /** How long a fight lasts, in seconds. */
  fightS: number;
  /** How long the loser runs afterwards. */
  fleeS: number;
}

export interface Engagement {
  hero: HuntState;
  beast: HuntState;
  /** Seconds left in the current state, where the state has a clock. */
  timerS: number;
}

export const IDLE: Engagement = { hero: HUNT.roam, beast: HUNT.roam, timerS: 0 };

/**
 * Advances one pair by `dtS`. `distanceM` is how far apart they are now;
 * moving them is the caller's business, because that needs the pool.
 *
 * `paired` is false when the hero has no beast in the world to look at, which
 * is the ordinary case for most heroes most of the time.
 */
export function stepEngagement(
  current: Engagement,
  distanceM: number,
  dtS: number,
  rules: HuntRules,
  paired = true,
): Engagement {
  const timerS = Math.max(0, current.timerS - dtS);

  // Running away finishes on its own clock, wherever the other one is.
  if (current.beast === HUNT.flee) {
    if (timerS > 0) return { hero: current.hero, beast: HUNT.flee, timerS };
    return IDLE;
  }

  if (current.hero === HUNT.fight) {
    if (timerS > 0) return { hero: HUNT.fight, beast: HUNT.fight, timerS };
    // Time is up. The beast breaks off and runs; the hero lets it go.
    return { hero: HUNT.roam, beast: HUNT.flee, timerS: rules.fleeS };
  }

  if (current.hero === HUNT.hunt) {
    if (!paired || distanceM > rules.loseInterestM) return IDLE;
    if (distanceM <= rules.engageM) {
      return { hero: HUNT.fight, beast: HUNT.fight, timerS: rules.fightS };
    }
    return { hero: HUNT.hunt, beast: HUNT.hunt, timerS };
  }

  // Wandering. A beast close enough to see is a beast worth walking towards.
  if (paired && distanceM <= rules.senseM) {
    return { hero: HUNT.hunt, beast: HUNT.hunt, timerS: 0 };
  }
  return IDLE;
}

/**
 * How far through the current strike the pair is, 0 to 1 and back, so the
 * caller can lunge them at each other. Zero whenever they are not fighting.
 *
 * Several strikes over one fight rather than one long shove: a fight that
 * eases in and out once reads as an embrace.
 */
export function strikePhase(state: Engagement, rules: HuntRules, strikes = 3): number {
  if (state.hero !== HUNT.fight) return 0;
  const throughS = rules.fightS - state.timerS;
  const each = rules.fightS / Math.max(1, strikes);
  const t = (throughS % each) / each;
  return Math.sin(t * Math.PI);
}
