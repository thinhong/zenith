import { clamp, lerp, smoothstep } from '@/film/ease';

/**
 * What a person looks like at a given age. One model plays the whole life, so
 * age is carried by a handful of cues, the way an anime shows it: size and a
 * large head for a child, grey hair, glasses, a bent back and a slower pace
 * for the old. Pure, so the ages at which each cue appears are tested.
 */
export interface Look {
  /** Body scale against the adult model. */
  scale: number;
  /** Extra head scale on top of the body scale. A child's head is large for its body. */
  headScale: number;
  /** 0 is the hair's own colour, 1 is silver. */
  grey: number;
  /** 0 stands straight, 1 is an old back and neck. */
  stoop: number;
  glasses: boolean;
  /** Speed of gestures and of the walk: 1 young, lower when old. */
  pace: number;
  /** 0 is the life's own clothes colour, 1 is the soft colour of old age. */
  fade: number;
}

export const AGE = {
  /** A child grows into the adult model between these ages. */
  childUntil: 16,
  greyFrom: 48,
  greyFull: 74,
  stoopFrom: 62,
  stoopFull: 84,
  glassesFrom: 55,
  slowFrom: 58,
  slowFull: 84,
  /** The slowest pace, at the very end. */
  slowest: 0.55,
} as const;

export function lookAt(ageYears: number): Look {
  const age = clamp(ageYears, 0, 110);
  // Height grows fastest in childhood and stops in the mid-teens.
  const growth = smoothstep(4, AGE.childUntil, age);
  return {
    scale: lerp(0.62, 1, growth),
    headScale: lerp(1.2, 1, growth),
    grey: smoothstep(AGE.greyFrom, AGE.greyFull, age),
    stoop: smoothstep(AGE.stoopFrom, AGE.stoopFull, age),
    glasses: age >= AGE.glassesFrom,
    pace: lerp(1, AGE.slowest, smoothstep(AGE.slowFrom, AGE.slowFull, age)),
    fade: smoothstep(40, 75, age),
  };
}
