import { Vector3, type PerspectiveCamera } from 'three';
import type { NearbyPerson, People } from '@/agents/people';
import type { ViewState } from '@/core/camera';
import { DETAIL, detailFactor } from '@/state/altitude';
import { MODERN_THOUGHTS, thoughtsFor, type ThoughtPlace, type ThoughtSet } from '@/thoughts/content';
import { placePill, type PlaceLimits } from '@/thoughts/place';
import { selectThoughts, steadyPick, type ThoughtSlot } from '@/thoughts/select';

/**
 * The thoughts above people's heads, in the street band only.
 *
 * They are DOM elements rather than sprites, so the text stays the same size
 * however far the camera is: what fades is the opacity, not the letters
 * (PLAN.md 5). The choosing is pure and lives in thoughts/select.ts; this file
 * owns the projection and the pills.
 */
const THOUGHTS = {
  max: 6,
  /** How close to the look-at point a person has to be to be heard. */
  radiusM: 40,
  holdS: 8,
  fadeInS: 0.5,
  /** How far above the head the pill floats, in metres. */
  liftM: 0.45,
  /**
   * And a little further, in pixels. A lift measured only in metres shrinks
   * with altitude, so over an opened building the pills came to rest on the
   * very crowd they belong to. This part of the gap is the same at every
   * height, which is the point: the stack clears the people underneath it.
   */
  liftPx: 22,
  /** Pills nearer than this vertically, within `spreadPx`, are nudged apart. */
  gapPx: 30,
  spreadPx: 150,
  nudgeLimit: 5,
  /**
   * How far a pill may be lifted off its own head before it is dropped
   * instead. Past this the thread back down is longer than the pill is wide
   * and the pair stops reading as one thing.
   *
   * It has to be under `nudgeLimit * gapPx`, or the lift can never reach it
   * and the rule is dead code: five lifts of thirty pixels is a hundred and
   * fifty, so at a hundred and fifty nothing was ever refused. A pill shoved
   * all the way to the top of the stack is the one to drop.
   */
  maxStemPx: 120,
  /** How close to the frame edge a pill's centre may sit. */
  edgePx: 140,
} as const;

export interface ThoughtStats {
  shown: number;
}

export interface Thoughts {
  update: (dtS: number, view: ViewState) => void;
  stats: ThoughtStats;
  /** Swaps in another era's worries. Anything showing is dropped. */
  setThoughts: (next: ThoughtSet) => void;
}

export interface ThoughtsOptions {
  people: People;
  camera: PerspectiveCamera;
  /** The element the scene is drawn into, for its size in pixels. */
  canvas: HTMLElement;
  set?: ThoughtSet;
  /**
   * Whether a building is standing open, so the people inside it can be seen.
   * Somebody sealed behind a wall gets no pill: the thought would hang over a
   * roof, attached to the building rather than to anybody in it.
   */
  isOpen?: (lotId: number) => boolean;
}

export function createThoughts(options: ThoughtsOptions): Thoughts {
  const { people, camera, canvas } = options;
  const isOpen = options.isOpen;
  let set = options.set ?? MODERN_THOUGHTS;

  const container = document.createElement('div');
  container.id = 'thoughts';
  document.body.appendChild(container);

  const pills: HTMLDivElement[] = [];
  for (let i = 0; i < THOUGHTS.max; i++) {
    const pill = document.createElement('div');
    pill.className = 'thought';
    pill.style.opacity = '0';
    container.appendChild(pill);
    pills.push(pill);
  }

  const stats: ThoughtStats = { shown: 0 };
  const point = new Vector3();
  let slots: ThoughtSlot[] = [];
  let elapsedS = 0;

  const pick = (place: ThoughtPlace, agent: number): number =>
    steadyPick(agent, place, thoughtsFor(set, place).length);

  function hideAll(): void {
    for (const pill of pills) pill.style.opacity = '0';
    stats.shown = 0;
  }

  return {
    stats,
    setThoughts: (next) => {
      set = next;
      slots = [];
      hideAll();
    },
    update: (dtS, view) => {
      elapsedS += dtS;
      const strength = detailFactor(DETAIL.thoughts, view.altitudeM);
      if (strength <= 0.002) {
        if (slots.length > 0) slots = [];
        hideAll();
        return;
      }

      const nearby = people.nearby(
        view.targetX,
        view.targetZ,
        THOUGHTS.radiusM,
        THOUGHTS.max,
        isOpen,
      );
      slots = selectThoughts(slots, nearby, elapsedS, {
        max: THOUGHTS.max,
        holdS: THOUGHTS.holdS,
        pick,
      });

      const byAgent = new Map<number, NearbyPerson>();
      for (const person of nearby) byAgent.set(person.agent, person);

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const limits: PlaceLimits = {
        width,
        height,
        edgePx: THOUGHTS.edgePx,
        gapPx: THOUGHTS.gapPx,
        spreadPx: THOUGHTS.spreadPx,
        nudgeLimit: THOUGHTS.nudgeLimit,
        maxStemPx: THOUGHTS.maxStemPx,
      };
      const placed: { x: number; y: number }[] = [];
      let shown = 0;

      for (let i = 0; i < pills.length; i++) {
        const pill = pills[i];
        const slot = slots[i];
        const person = slot ? byAgent.get(slot.agent) : undefined;
        if (!pill) continue;
        if (!slot || !person) {
          pill.style.opacity = '0';
          continue;
        }

        point.set(person.x, person.headM + THOUGHTS.liftM, person.z);
        point.project(camera);
        // project() puts anything behind the camera outside the near plane.
        if (point.z > 1 || point.x < -1.1 || point.x > 1.1 || point.y < -1.1 || point.y > 1.1) {
          pill.style.opacity = '0';
          continue;
        }

        // Where the head actually is. The pill may be moved off this; the tail
        // and the thread are what keep it attached to the person.
        const headX = (point.x * 0.5 + 0.5) * width;
        const headY = (1 - (point.y * 0.5 + 0.5)) * height - THOUGHTS.liftPx;
        const spot = placePill(headX, headY, placed, limits);
        if (!spot) {
          pill.style.opacity = '0';
          continue;
        }
        placed.push({ x: spot.pillX, y: spot.pillY });

        const text = thoughtsFor(set, slot.place)[slot.text] ?? '';
        if (pill.textContent !== text) pill.textContent = text;
        const fadeIn = Math.min(1, (elapsedS - slot.sinceS) / THOUGHTS.fadeInS);
        pill.style.transform = `translate(-50%, -100%) translate(${spot.pillX.toFixed(1)}px, ${spot.pillY.toFixed(1)}px)`;
        pill.style.setProperty('--tail', `calc(50% + ${spot.tailPx.toFixed(1)}px)`);
        pill.style.setProperty('--stem', `${spot.stemPx.toFixed(1)}px`);
        pill.style.opacity = (strength * fadeIn).toFixed(3);
        shown++;
      }

      stats.shown = shown;
    },
  };
}
