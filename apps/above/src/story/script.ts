import type { EraId } from '@/world/eras';

/**
 * One ordinary day, as data (PLAN.md 5, "A day"). The words live here and in
 * story/days/, never in the systems that show them (AGENTS.md 8).
 *
 * A day is a handful of scenes from waking to night. Each scene happens at a
 * place in town, usually with somebody waiting there, and is a short
 * conversation. A reply chosen in one scene sets flags; later lines, later
 * scenes and the last thought of the day read them. Nothing can be failed,
 * nothing is scored, nothing is timed. The day ends when its last scene does,
 * and you rise out of it.
 *
 * Places are named by role (home, work, the market), not by position. The
 * town is laid out from a seed, so which building is home is decided when
 * the day starts (story/cast.ts).
 */

/** Every flag named must be set, and every `!flag` must not be. */
export type Condition = readonly string[];

export type Beat =
  /** Somebody speaks. `who` is a cast id, or 'me'; by default the scene's own person. */
  | { say: string; who?: string }
  /** What the person whose day it is thinks, and does not say. */
  | { think: string }
  /** Two replies. Picking one sets its flags and plays its lines. */
  | { choose: readonly [Option, Option] }
  /** Lines that only play if the flags allow, and others if they do not. */
  | { when: Condition; then: readonly Beat[]; otherwise?: readonly Beat[] }
  | { set: readonly string[] };

export interface Option {
  /** What the button says. */
  label: string;
  set?: readonly string[];
  then: readonly Beat[];
}

export type PlaceKind = 'home' | 'work' | 'market' | 'park' | 'temple' | 'landmark' | 'shore';

export interface PlaceSpec {
  kind: PlaceKind;
  /** For `landmark`: which of the era's landmarks (EraLayout.landmarks). */
  landmark?: string;
  /** Distances are measured from this place, which must be listed before it. */
  from?: string;
  minM?: number;
  maxM?: number;
  /** How far out from the middle of town, as a share of the way to the edge. */
  reach?: readonly [number, number];
  /** Inside the era's wall, or outside it, for an era that has one. */
  zone?: 'inside' | 'outside';
  /** A park with room in it: one the plan kept open, not a garden plot. */
  big?: boolean;
}

export interface Character {
  name: string;
  /** Clothing colour. */
  clothes: number;
  /** 1 for a grown-up. A child is smaller. */
  scale?: number;
  /** A voice on the telephone is not standing anywhere. A machine floats. */
  kind?: 'person' | 'cat' | 'voice' | 'machine';
}

/** Somebody met on the way who does not have to be spoken to. */
export interface Extra {
  who: string;
  at: string;
  /** Metres from the place's spot: along the street, then out from the door. */
  offset?: readonly [number, number];
  talk: readonly Beat[];
}

export interface Aim {
  when?: Condition;
  text: string;
}

export interface Scene {
  id: string;
  /** The hour this part of the day begins. The clock is moved on to it. */
  hour: number;
  /** A scene that only happens if the flags allow. */
  when?: Condition;
  at: string;
  /** Who is waiting there. Nobody, for a moment alone. */
  with?: string;
  /**
   * What the person is thinking on the way there. It is the only direction
   * the day ever gives: no marker, no map, no list.
   */
  aim: readonly Aim[];
  talk: readonly Beat[];
  extras?: readonly Extra[];
}

export interface DayScript {
  era: EraId;
  /** For the tests and the HUD. Never shown in the world. */
  title: string;
  me: { name: string; age: number };
  /** Must include `home`, where the day starts and ends. */
  places: Readonly<Record<string, PlaceSpec>>;
  cast: Readonly<Record<string, Character>>;
  scenes: readonly Scene[];
  /** The last thought, while the day falls away below. The first that holds. */
  close: readonly Aim[];
}

export const SCRIPT = {
  /** Longest line anybody says or thinks. Two lines of a pill, at most. */
  maxLine: 72,
  /** Longest reply on a button. */
  maxLabel: 46,
} as const;

/** Whether the flags satisfy a condition. */
export function holds(condition: Condition | undefined, flags: ReadonlySet<string>): boolean {
  if (!condition) return true;
  for (const term of condition) {
    if (term.startsWith('!')) {
      if (flags.has(term.slice(1))) return false;
    } else if (!flags.has(term)) {
      return false;
    }
  }
  return true;
}

/** The first of these whose condition holds. */
export function firstThat(options: readonly Aim[], flags: ReadonlySet<string>): string | null {
  for (const option of options) if (holds(option.when, flags)) return option.text;
  return null;
}

/**
 * Everything wrong with a day, in words: a place or a person that does not
 * exist, a line too long for its pill, a flag read that nothing sets. Empty
 * means the day can be played.
 */
export function problemsWith(day: DayScript): string[] {
  const problems: string[] = [];
  const places = Object.keys(day.places);
  const cast = Object.keys(day.cast);
  if (!day.places.home) problems.push('no home');

  places.forEach((id, index) => {
    const spec = day.places[id];
    if (!spec) return;
    if (spec.from && !places.slice(0, index).includes(spec.from)) {
      problems.push(`place ${id} measures from ${spec.from}, which is not listed before it`);
    }
    if (spec.kind === 'landmark' && !spec.landmark) problems.push(`place ${id} names no landmark`);
  });

  const set = new Set<string>();
  const read = new Set<string>();
  const readCondition = (condition: Condition | undefined): void => {
    for (const term of condition ?? []) read.add(term.replace(/^!/, ''));
  };
  const line = (text: string, where: string): void => {
    if (text.length > SCRIPT.maxLine) problems.push(`${where}: line too long (${text.length}): ${text}`);
    if (text.trim() !== text || text.length === 0) problems.push(`${where}: empty or padded line`);
  };
  const walk = (beats: readonly Beat[], where: string, speaker: string | undefined): void => {
    for (const beat of beats) {
      if ('say' in beat) {
        line(beat.say, where);
        const who = beat.who ?? speaker;
        if (!who) problems.push(`${where}: a line with nobody to say it`);
        else if (who !== 'me' && !cast.includes(who)) problems.push(`${where}: ${who} is not in the cast`);
      } else if ('think' in beat) {
        line(beat.think, where);
      } else if ('choose' in beat) {
        for (const option of beat.choose) {
          if (option.label.length > SCRIPT.maxLabel) problems.push(`${where}: reply too long: ${option.label}`);
          for (const flag of option.set ?? []) set.add(flag);
          walk(option.then, where, speaker);
        }
      } else if ('when' in beat) {
        readCondition(beat.when);
        walk(beat.then, where, speaker);
        walk(beat.otherwise ?? [], where, speaker);
      } else {
        for (const flag of beat.set) set.add(flag);
      }
    }
  };

  const ids = new Set<string>();
  day.scenes.forEach((scene, index) => {
    const where = `scene ${scene.id}`;
    if (ids.has(scene.id)) problems.push(`${where}: id used twice`);
    ids.add(scene.id);
    if (index === 0 && scene.when) problems.push(`${where}: the first scene must always happen`);
    if (!places.includes(scene.at)) problems.push(`${where}: no place called ${scene.at}`);
    if (scene.with && !cast.includes(scene.with)) problems.push(`${where}: ${scene.with} is not in the cast`);
    if (scene.aim.length === 0) problems.push(`${where}: no aim`);
    readCondition(scene.when);
    for (const aim of scene.aim) {
      line(aim.text, where);
      readCondition(aim.when);
    }
    walk(scene.talk, where, scene.with);
    for (const extra of scene.extras ?? []) {
      if (!cast.includes(extra.who)) problems.push(`${where}: extra ${extra.who} is not in the cast`);
      if (!places.includes(extra.at)) problems.push(`${where}: extra at ${extra.at}, which is not a place`);
      walk(extra.talk, `${where}/${extra.who}`, extra.who);
    }
  });
  for (const close of day.close) {
    line(close.text, 'close');
    readCondition(close.when);
  }
  if (day.close.length === 0 || day.close[day.close.length - 1]?.when) {
    problems.push('the last closing thought must have no condition, so there always is one');
  }
  for (const flag of read) if (!set.has(flag)) problems.push(`flag ${flag} is read but never set`);
  return problems;
}
