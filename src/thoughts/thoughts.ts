import { Vector3, type PerspectiveCamera } from 'three';
import type { NearbyPerson, People } from '@/agents/people';
import type { ViewState } from '@/core/camera';
import { DETAIL, detailFactor } from '@/state/altitude';
import { MODERN_THOUGHTS, thoughtsFor, type ThoughtPlace, type ThoughtSet } from '@/thoughts/content';
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
  /** Pills nearer than this vertically, within `spreadPx`, are nudged apart. */
  gapPx: 26,
  spreadPx: 130,
  nudgeLimit: 6,
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
}

export function createThoughts(options: ThoughtsOptions): Thoughts {
  const { people, camera, canvas } = options;
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

      const nearby = people.nearbyOutside(
        view.targetX,
        view.targetZ,
        THOUGHTS.radiusM,
        THOUGHTS.max,
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
        if (point.z > 1 || point.x < -1.2 || point.x > 1.2 || point.y < -1.2 || point.y > 1.2) {
          pill.style.opacity = '0';
          continue;
        }

        let screenX = (point.x * 0.5 + 0.5) * width;
        let screenY = (1 - (point.y * 0.5 + 0.5)) * height;
        for (let attempt = 0; attempt < THOUGHTS.nudgeLimit; attempt++) {
          const clash = placed.find(
            (other) =>
              Math.abs(other.y - screenY) < THOUGHTS.gapPx &&
              Math.abs(other.x - screenX) < THOUGHTS.spreadPx,
          );
          if (!clash) break;
          screenY = clash.y - THOUGHTS.gapPx;
        }
        placed.push({ x: screenX, y: screenY });

        const text = thoughtsFor(set, slot.place)[slot.text] ?? '';
        if (pill.textContent !== text) pill.textContent = text;
        const fadeIn = Math.min(1, (elapsedS - slot.sinceS) / THOUGHTS.fadeInS);
        pill.style.transform = `translate(-50%, -100%) translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px)`;
        pill.style.opacity = (strength * fadeIn).toFixed(3);
        shown++;
      }

      stats.shown = shown;
    },
  };
}
