import { firstThat, holds, type Beat, type DayScript, type Extra, type Scene } from '@/story/script';

/**
 * Plays a day. Pure: it knows nothing of where anybody is standing. The walk
 * mode decides when the person has arrived and calls `talk`; this decides
 * what is said, what can be replied, and what comes next.
 *
 * Phases:
 * - `going`: on the way to the current scene's place. The aim is showing.
 * - `talking`: a conversation is running, with the scene's person or with
 *   somebody met on the way (`extra`).
 * - `ending`: the last scene is over. The closing thought is showing and the
 *   view rises.
 */
export type Phase = 'going' | 'talking' | 'ending';

export interface Line {
  kind: 'say' | 'think';
  text: string;
  /** A cast id, or 'me' for the person whose day it is. */
  who: string;
}

export interface RunView {
  phase: Phase;
  sceneIndex: number;
  scene: Scene | null;
  line: Line | null;
  options: readonly [string, string] | null;
  /** Who is being talked to on the way, when it is not the scene's person. */
  extra: string | null;
  flags: ReadonlySet<string>;
  /** The last thought, once the day is over. */
  closing: string | null;
}

export interface Run {
  view: () => RunView;
  /** What the person is thinking on the way to the current scene. */
  aim: () => string | null;
  /** Starts the current scene's conversation. Does nothing unless going. */
  talk: () => void;
  /** Starts a conversation with somebody met on the way. False if there is none to have. */
  talkTo: (who: string) => boolean;
  /** Extras in the current scene who have not been spoken to yet. */
  waiting: () => readonly Extra[];
  /** On to the next line. Does nothing while a reply is waiting to be picked. */
  next: () => void;
  choose: (index: 0 | 1) => void;
  /** Straight to a later scene, for the tests and for `?scene=` in a browser. */
  skipTo: (sceneIndex: number) => void;
}

interface Frame {
  beats: readonly Beat[];
  index: number;
  /** Who speaks a `say` that names nobody. */
  speaker: string;
}

export function createRun(day: DayScript): Run {
  const flags = new Set<string>();
  const spoken = new Set<string>();
  let phase: Phase = 'going';
  let sceneIndex = firstScene(0);
  let stack: Frame[] = [];
  let line: RunView['line'] = null;
  let options: RunView['options'] = null;
  let pendingChoice: Extract<Beat, { choose: unknown }> | null = null;
  let extra: string | null = null;
  let closing: string | null = null;

  function firstScene(from: number): number {
    for (let i = from; i < day.scenes.length; i++) {
      if (holds(day.scenes[i]?.when, flags)) return i;
    }
    return day.scenes.length;
  }

  function currentScene(): Scene | null {
    return day.scenes[sceneIndex] ?? null;
  }

  /** Runs forward to the next thing that has to be shown, or to the end of the talk. */
  function settle(): void {
    // A reply is picked with the question still in view: the line shown just
    // before a choice stays up with it.
    const shown = line;
    line = null;
    options = null;
    pendingChoice = null;
    for (;;) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        finishTalk();
        return;
      }
      const beat = frame.beats[frame.index];
      if (!beat) {
        stack.pop();
        continue;
      }
      frame.index++;
      if ('say' in beat) {
        line = { kind: 'say', text: beat.say, who: beat.who ?? frame.speaker };
        return;
      }
      if ('think' in beat) {
        line = { kind: 'think', text: beat.think, who: 'me' };
        return;
      }
      if ('choose' in beat) {
        pendingChoice = beat;
        options = [beat.choose[0].label, beat.choose[1].label];
        line = shown;
        return;
      }
      if ('when' in beat) {
        const branch = holds(beat.when, flags) ? beat.then : (beat.otherwise ?? []);
        stack.push({ beats: branch, index: 0, speaker: frame.speaker });
        continue;
      }
      for (const flag of beat.set) flags.add(flag);
    }
  }

  function finishTalk(): void {
    if (extra !== null) {
      extra = null;
      phase = 'going';
      return;
    }
    sceneIndex = firstScene(sceneIndex + 1);
    if (sceneIndex >= day.scenes.length) {
      phase = 'ending';
      closing = firstThat(day.close, flags);
      return;
    }
    phase = 'going';
  }

  function begin(beats: readonly Beat[], speaker: string): void {
    phase = 'talking';
    stack = [{ beats, index: 0, speaker }];
    settle();
  }

  return {
    view: () => ({
      phase,
      sceneIndex,
      scene: currentScene(),
      line,
      options,
      extra,
      flags,
      closing,
    }),
    aim: () => {
      const scene = currentScene();
      return phase === 'going' && scene ? firstThat(scene.aim, flags) : null;
    },
    talk: () => {
      const scene = currentScene();
      if (phase !== 'going' || !scene) return;
      begin(scene.talk, scene.with ?? 'me');
    },
    talkTo: (who) => {
      const scene = currentScene();
      if (phase !== 'going' || !scene) return false;
      const found = (scene.extras ?? []).find((each) => each.who === who);
      const key = `${scene.id}/${who}`;
      if (!found || spoken.has(key)) return false;
      spoken.add(key);
      extra = who;
      begin(found.talk, who);
      return true;
    },
    waiting: () => {
      const scene = currentScene();
      if (!scene) return [];
      return (scene.extras ?? []).filter((each) => !spoken.has(`${scene.id}/${each.who}`));
    },
    next: () => {
      if (phase !== 'talking' || pendingChoice) return;
      settle();
    },
    choose: (index) => {
      if (phase !== 'talking' || !pendingChoice) return;
      const option = pendingChoice.choose[index];
      for (const flag of option.set ?? []) flags.add(flag);
      const frame = stack[stack.length - 1];
      stack.push({ beats: option.then, index: 0, speaker: frame?.speaker ?? 'me' });
      settle();
    },
    skipTo: (index) => {
      stack = [];
      line = null;
      options = null;
      pendingChoice = null;
      extra = null;
      sceneIndex = firstScene(Math.max(0, index));
      phase = sceneIndex >= day.scenes.length ? 'ending' : 'going';
      closing = phase === 'ending' ? firstThat(day.close, flags) : null;
    },
  };
}
