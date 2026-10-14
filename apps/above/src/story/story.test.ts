import { describe, expect, it } from 'vitest';
import { ERA_ORDER } from '@/world/eras';
import { DAYS, dayFor } from '@/story/days';
import { createRun } from '@/story/run';
import { firstThat, holds, problemsWith, type DayScript } from '@/story/script';

interface Played {
  /** More decisions were needed than were given. */
  needs: boolean;
  scenes: string[];
  closing: string | null;
  flags: string[];
}

/**
 * Plays a day with a fixed list of decisions: at each person met on the way,
 * whether to stop (1) or walk past (0); at each reply, which one.
 */
function play(day: DayScript, decisions: readonly number[]): Played {
  const run = createRun(day);
  const scenes: string[] = [];
  const passed = new Set<string>();
  let used = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const view = run.view();
    if (view.phase === 'ending') {
      return { needs: false, scenes, closing: view.closing, flags: [...view.flags].sort() };
    }
    if (view.phase === 'going') {
      const scene = view.scene;
      if (!scene) throw new Error('going nowhere');
      if (!scenes.includes(scene.id)) scenes.push(scene.id);
      const extra = run.waiting().find((each) => !passed.has(`${scene.id}/${each.who}`));
      if (extra) {
        if (used >= decisions.length) return { needs: true, scenes, closing: null, flags: [] };
        if (decisions[used++] === 1) run.talkTo(extra.who);
        else passed.add(`${scene.id}/${extra.who}`);
        continue;
      }
      run.talk();
      continue;
    }
    if (view.options) {
      if (used >= decisions.length) return { needs: true, scenes, closing: null, flags: [] };
      run.choose(decisions[used++] === 1 ? 1 : 0);
      continue;
    }
    if (!view.line) throw new Error('talking, but nothing to show');
    run.next();
  }
  throw new Error('the day never ended');
}

/** Every way through a day. */
function everyWay(day: DayScript): Played[] {
  const done: Played[] = [];
  const queue: number[][] = [[]];
  while (queue.length > 0) {
    const prefix = queue.shift() ?? [];
    const result = play(day, prefix);
    if (result.needs) {
      queue.push([...prefix, 0], [...prefix, 1]);
      continue;
    }
    done.push(result);
  }
  return done;
}

describe('the days', () => {
  it('has one for every era on the dial', () => {
    for (const era of ERA_ORDER) expect(dayFor(era)?.era).toBe(era);
  });

  for (const day of DAYS) {
    describe(day.title, () => {
      it('names only places and people it has, and every line fits its pill', () => {
        expect(problemsWith(day)).toEqual([]);
      });

      it('ends every way it can be played, and every scene is somebody’s day', () => {
        const ways = everyWay(day);
        expect(ways.length).toBeGreaterThan(8);
        const reached = new Set(ways.flatMap((way) => way.scenes));
        for (const scene of day.scenes) expect(reached.has(scene.id)).toBe(true);
        for (const way of ways) {
          expect(way.closing).toBeTruthy();
          // Home at the start and home at the end.
          expect(day.scenes.find((scene) => scene.id === way.scenes[0])?.at).toBe('home');
          expect(day.scenes.find((scene) => scene.id === way.scenes[way.scenes.length - 1])?.at).toBe('home');
        }
      });

      it('lets the replies change how it ends', () => {
        const endings = new Set(everyWay(day).map((way) => way.closing));
        const possible = new Set(day.close.map((close) => close.text));
        // Every closing thought is reachable by somebody.
        for (const text of possible) expect(endings.has(text)).toBe(true);
      });

      it('moves the clock forward only', () => {
        for (const way of everyWay(day)) {
          const hours = way.scenes.map((id) => day.scenes.find((scene) => scene.id === id)?.hour ?? 0);
          for (let i = 1; i < hours.length; i++) expect(hours[i]).toBeGreaterThan(hours[i - 1] ?? 0);
        }
      });
    });
  }

  it('has the same grey cat in every era', () => {
    for (const day of DAYS) {
      const cat = Object.values(day.cast).find((each) => each.kind === 'cat');
      expect(cat).toBeDefined();
      const lines = day.scenes.flatMap((scene) => scene.extras ?? []).filter((extra) => day.cast[extra.who]?.kind === 'cat');
      expect(lines.length).toBeGreaterThan(0);
    }
  });
});

describe('createRun', () => {
  const day = dayFor('myth');
  if (!day) throw new Error('no Wyrmrest day');

  it('starts on the way to the first scene, and talks only when asked', () => {
    const run = createRun(day);
    expect(run.view().phase).toBe('going');
    run.next();
    expect(run.view().phase).toBe('going');
    run.talk();
    expect(run.view().phase).toBe('talking');
    expect(run.view().line?.kind).toBe('think');
  });

  it('waits for a reply, and the reply sets its flag', () => {
    const run = createRun(day);
    run.skipTo(1);
    run.talk();
    for (let i = 0; i < 20 && !run.view().options; i++) run.next();
    expect(run.view().options).not.toBeNull();
    // The question stays in view with the replies.
    expect(run.view().line?.text).toBe('Good crust. Not hers, though. Is it.');
    run.next();
    expect(run.view().options).not.toBeNull();
    run.choose(0);
    expect(run.view().flags.has('honest')).toBe(true);
  });

  it('lets somebody met on the way be spoken to once, and then goes on', () => {
    const run = createRun(day);
    run.skipTo(1);
    expect(run.waiting().map((each) => each.who)).toEqual(['cat']);
    expect(run.talkTo('cat')).toBe(true);
    expect(run.view().extra).toBe('cat');
    run.next();
    run.choose(0);
    run.next();
    expect(run.view().phase).toBe('going');
    expect(run.view().sceneIndex).toBe(1);
    expect(run.talkTo('cat')).toBe(false);
    expect(run.view().flags.has('fedCat')).toBe(true);
  });

  it('skips a scene whose flags do not hold', () => {
    const modern = dayFor('modern');
    if (!modern) throw new Error('no 2020 day');
    const ways = everyWay(modern);
    for (const way of ways) {
      expect(way.scenes.includes('late') && way.scenes.includes('water')).toBe(false);
    }
  });
});

describe('conditions', () => {
  it('reads every flag and every negation', () => {
    const flags = new Set(['a', 'b']);
    expect(holds(['a', 'b'], flags)).toBe(true);
    expect(holds(['a', '!b'], flags)).toBe(false);
    expect(holds(['!c'], flags)).toBe(true);
    expect(holds(undefined, flags)).toBe(true);
    expect(firstThat([{ when: ['c'], text: 'no' }, { text: 'yes' }], flags)).toBe('yes');
  });
});
