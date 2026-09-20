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
  /**
   * How far from the camera a person may be and still be heard, as a multiple
   * of the altitude, and never less than `radiusMinM`. It scales because the
   * higher the camera the more ground is in shot.
   */
  radiusPerAltitude: 1.6,
  radiusMinM: 45,
  /**
   * How many people to consider before picking six. Each one is projected to
   * the screen and scored, and the six best are the ones that speak, so this
   * has to be a good deal larger than `max` for the scoring to have anything
   * to choose between.
   */
  considered: 30,
  /**
   * How much being off to the side counts against a person, against being far
   * away. At 1.5, somebody at the edge of the frame has to be 2.5 times
   * closer than somebody in the middle of it to be picked instead.
   */
  centreBias: 1.5,
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

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      /**
       * Around the camera, not around the point it is looking at.
       *
       * These were picked by distance from the look-at target, and the
       * complaint was that the thoughts belonged to people far off rather
       * than to the ones filling the view. That is exactly what a tilted
       * camera does: the target is on the ground well beyond the near
       * pavement, so a ring drawn around it reaches past the people in front
       * of the viewer and picks up the ones behind them instead.
       */
      const radiusM = Math.max(THOUGHTS.radiusMinM, view.altitudeM * THOUGHTS.radiusPerAltitude);
      const nearby = people.nearby(
        view.eyeX,
        view.eyeZ,
        radiusM,
        THOUGHTS.considered,
        isOpen,
      );

      // Project every candidate once, drop the ones off screen, and score the
      // rest by how near the viewer they are and how near the middle of the
      // frame they land. `selectThoughts` picks the lowest scores, so the
      // score goes in as the distance it sorts on.
      const onScreen = new Map<number, { screenX: number; screenY: number }>();
      const scored: NearbyPerson[] = [];
      for (const person of nearby) {
        point.set(person.x, person.headM + THOUGHTS.liftM, person.z);
        point.project(camera);
        // project() puts anything behind the camera outside the near plane.
        if (point.z > 1 || point.x < -1.1 || point.x > 1.1 || point.y < -1.1 || point.y > 1.1) {
          continue;
        }
        const offCentre = Math.hypot(point.x, point.y);
        const dx = person.x - view.eyeX;
        const dy = person.headM - view.eyeY;
        const dz = person.z - view.eyeZ;
        const fromEyeM = Math.hypot(dx, dy, dz);
        scored.push({
          ...person,
          distanceM: fromEyeM * (1 + offCentre * THOUGHTS.centreBias),
        });
        onScreen.set(person.agent, {
          screenX: (point.x * 0.5 + 0.5) * width,
          screenY: (1 - (point.y * 0.5 + 0.5)) * height - THOUGHTS.liftPx,
        });
      }

      slots = selectThoughts(slots, scored, elapsedS, {
        max: THOUGHTS.max,
        holdS: THOUGHTS.holdS,
        pick,
      });

      const byAgent = new Map<number, NearbyPerson>();
      for (const person of scored) byAgent.set(person.agent, person);
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

        // Already projected when the candidates were scored.
        const where = onScreen.get(slot.agent);
        if (!where) {
          pill.style.opacity = '0';
          continue;
        }
        const headX = where.screenX;
        const headY = where.screenY;
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
