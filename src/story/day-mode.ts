import { Vector3 } from 'three';
import { clipPlanesFor, type CameraRig, type ViewState } from '@/core/camera';
import { WALK, smoothstep } from '@/state/altitude';
import { createActors, type ActorPlace } from '@/story/actors';
import { castPlaces, wayBetween, type Spot } from '@/story/cast';
import { dayFor } from '@/story/days';
import { createGuide } from '@/story/guide';
import { createRun, type Run } from '@/story/run';
import type { Beat, DayScript } from '@/story/script';
import { createStoryUi } from '@/story/ui';
import { inSight, type Ground } from '@/walk/body';
import { townGround } from '@/walk/town';
import { createWalker, walkFovDeg } from '@/walk/walker';
import type { EraLayout } from '@/world/eras';
import { createGridIndex, distanceToSegment, rectBounds, toRectFrame } from '@/world/geometry2d';
import { LAYER_Y } from '@/world/ground';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { toLocal } from '@/world/frame';
import type { Lot } from '@/world/lots';
import type { World } from '@/world/world';

/**
 * One ordinary day, lived on foot (PLAN.md 5, "A day").
 *
 * You come down out of the sky into somebody's eyes on their doorstep at
 * dawn, and walk their day: to the places it happens, to the people in it,
 * replying as you choose. At night the day ends where it began and the view
 * lifts back into the sky, and the worry that filled the street shrinks with
 * everything else. Altitude is still the meaning; this is only its lowest
 * point.
 *
 * The words are data (story/days/), the playing of them is pure
 * (story/run.ts), where the places are is seeded (story/cast.ts), and the
 * walking is walk/. This file is the glue, the camera flights in and out,
 * and the clock, which the day moves on itself.
 */
export const DAY = {
  descendS: 5.2,
  riseS: 8,
  /** Where the rise ends: above the last place of the day, looking down at it. */
  riseHeightM: 430,
  riseTilt: 0.58,
  /** The day moves on while you walk, slowly: about a quarter of an hour a minute. */
  clockHoursPerS: 1 / 240,
  /** How long the clock takes to run on to the next part of the day. */
  sweepS: 3.2,
  /** The first words on the glass, and how long they stay. */
  hintS: 8,
  /** Check the light's way this often, and redo it if you have wandered this far from it. */
  rerouteS: 2,
  strayM: 24,
  /** The latest the clock is let run to. */
  lastHour: 23.8,
  /** How far in from the edge of the glass the light's echo sits when the light is out of view. */
  beaconInsetPx: 34,
  /**
   * A part of the day that happens where you already stand, like the first,
   * at your own door: whoever it is with waits this far out, facing you, not
   * on the very spot you are standing on.
   */
  standOutWithinM: 1.5,
  standOutM: 3,
  /** Inside a walled garden there is no room out front: they wait this far to the side instead. */
  standBesideM: 1.8,
} as const;

export interface DayMode {
  active: () => boolean;
  /** A day can begin now: one is written for this era and no change of era is under way. */
  canStart: () => boolean;
  /** `instant` skips the flight down; `scene` starts later in the day, for checking one scene. */
  start: (options?: { instant?: boolean; scene?: number }) => boolean;
  /** Every frame. The view to use while a day is on, or null when it is not. */
  update: (dtS: number) => ViewState | null;
  resize: (width: number, height: number) => void;
  /** For the HUD. */
  info: () => string;
}

export interface DayModeOptions {
  world: World;
  rig: CameraRig;
  /** Where pointer and touch input come from: the canvas. */
  surface: HTMLElement;
  reducedMotion: boolean;
  seed: number;
  /** Told when a day begins and when it is over, to put the rest of the UI away and back. */
  onEnter: () => void;
  onLeave: () => void;
}

type Mode = 'off' | 'descending' | 'walking' | 'rising';

/** Everybody who speaks a line in some beats. */
function speakers(beats: readonly Beat[], into: Set<string>): void {
  for (const beat of beats) {
    if ('say' in beat && beat.who && beat.who !== 'me') into.add(beat.who);
    else if ('choose' in beat) for (const option of beat.choose) speakers(option.then, into);
    else if ('when' in beat) {
      speakers(beat.then, into);
      speakers(beat.otherwise ?? [], into);
    }
  }
}

/**
 * Flat pieces lower than this are something to stand on: a square, a lawn, a
 * path, a plinth, a bridge. Roof decks are the flat pieces higher up. And a
 * box or a disc on the ground no taller than this is a step up onto it: a
 * deck, a bridge plank, an island.
 */
const UNDERFOOT_MAX_M = 0.6;

/**
 * The height of whatever is underfoot: a square or a lawn, a carriageway, a
 * pavement, the ground. Without the squares and lawns a person standing on
 * one was sunk to the shins in it, and the ring under them was hidden.
 */
function surfaceOf(layout: EraLayout): (x: number, z: number) => number {
  const roads = layout.roads;
  const index = createGridIndex(24);
  roads.edges.forEach((edge, i) => {
    const a = roads.nodes[edge.a];
    const b = roads.nodes[edge.b];
    if (!a || !b) return;
    const pad = edge.widthM / 2 + PAVEMENT_M;
    index.insert(i, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
  });
  const flats = layout.structures.filter(
    (each) =>
      (each.kind === 'flat' && each.y < UNDERFOOT_MAX_M) ||
      ((each.kind === 'box' || each.kind === 'round') && each.y === 0 && each.hM <= UNDERFOOT_MAX_M),
  );
  const first = roads.edges.length;
  flats.forEach((flat, j) => {
    const box = rectBounds(flat);
    index.insert(first + j, box.minX, box.minZ, box.maxX, box.maxZ);
  });
  return (x, z) => {
    let y = 0;
    index.query(x, z, x, z, (i) => {
      if (i >= first) {
        const flat = flats[i - first];
        if (!flat) return;
        const top = flat.kind === 'flat' ? flat.y : flat.y + flat.hM;
        if (flat.kind === 'round') {
          if (Math.hypot(x - flat.x, z - flat.z) <= flat.wM / 2) y = Math.max(y, top);
          return;
        }
        const local = toRectFrame(flat, x, z);
        if (Math.abs(local.x) <= flat.wM / 2 && Math.abs(local.z) <= flat.dM / 2) y = Math.max(y, top);
        return;
      }
      const edge = roads.edges[i];
      const a = edge ? roads.nodes[edge.a] : undefined;
      const b = edge ? roads.nodes[edge.b] : undefined;
      if (!edge || !a || !b) return;
      const d = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
      if (d < edge.widthM / 2) y = Math.max(y, LAYER_Y.road);
      else if (d < edge.widthM / 2 + PAVEMENT_M) y = Math.max(y, LAYER_Y.pavement);
    });
    return y;
  };
}

function ease(t: number): number {
  return smoothstep(0, 1, t);
}

export function createDayMode(options: DayModeOptions): DayMode {
  const { world, rig } = options;
  const camera = rig.camera;
  let mode: Mode = 'off';
  let day: DayScript | null = null;
  let run: Run | null = null;
  let spots: Record<string, Spot> = {};
  let roads: RoadGraph | null = null;
  let lotsById: ReadonlyMap<number, Lot> = new Map();
  let heightAt: (x: number, z: number) => number = () => 0;
  let clockWasPaused = false;

  // The flights in and out.
  const fromPos = new Vector3();
  const fromLook = new Vector3();
  const toPos = new Vector3();
  const toLook = new Vector3();
  const look = new Vector3();
  const inEye = new Vector3();
  const onGlass = new Vector3();
  let flightS = 0;
  let fovFrom = camera.fov;
  let fovTo = camera.fov;
  /** The lens of the view from above, to go back to at the end. */
  let aboveFovDeg = camera.fov;
  let closingText: string | null = null;

  let sweep: { from: number; to: number; s: number } | null = null;
  let sceneShown = -1;
  let pathScene = -1;
  let rerouteS = 0;
  let hintS = 0;
  let lingering: ActorPlace[] = [];
  let current: ActorPlace[] = [];
  let talkingTo: string | null = null;
  /** Whether this part of the day's people wait a few steps out from its place (DAY.standOutM). */
  let standOutScene = -1;
  let standOut = false;
  /** The mouse was let go on purpose, to click a reply, so no menu. */
  let released = false;
  let aspect = 1;

  const actors = createActors();
  const guide = createGuide();
  world.scene.add(actors.group, guide.group);
  actors.group.visible = false;

  const ui = createStoryUi({
    onChoose: (index) => choose(index),
    onInteract: () => interact(),
    onRise: () => {
      ui.menu(false);
      beginRise(null);
    },
    onResume: () => ui.menu(false),
  });

  const walker = createWalker({
    camera,
    surface: options.surface,
    groundY: (x, z) => heightAt(x, z),
    reducedMotion: options.reducedMotion,
    onInteract: () => interact(),
  });

  window.addEventListener('keydown', (e) => {
    if (mode !== 'walking') return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') choose(0);
    else if (e.code === 'Digit2' || e.code === 'Numpad2') choose(1);
    else if (e.code === 'Escape') ui.menu(!ui.menuOpen());
  });
  document.addEventListener('pointerlockchange', () => {
    if (mode !== 'walking') return;
    if (document.pointerLockElement) {
      released = false;
      return;
    }
    // Esc, which the browser keeps for itself while the mouse is held.
    if (!released) ui.menu(true);
    released = false;
  });

  function cast(id: string) {
    return day?.cast[id];
  }

  function placeActors(): void {
    if (!day || !run) return;
    const view = run.view();
    const scene = view.scene;
    const next: ActorPlace[] = [];
    if (scene) {
      const spot = spots[scene.at];
      const here = new Set<string>();
      if (scene.with) here.add(scene.with);
      speakers(scene.talk, here);
      let k = 0;
      if (spot) {
        if (standOutScene !== view.sceneIndex) {
          standOutScene = view.sceneIndex;
          standOut = Math.hypot(spot.x - walker.x, spot.z - walker.z) < DAY.standOutWithinM;
        }
        // Out in front, facing back at you; or, behind a garden wall, to one side.
        const beside = standOut && spot.approach !== undefined;
        const sideX = -spot.faceZ;
        const sideZ = spot.faceX;
        const out = standOut && !beside ? DAY.standOutM : 0;
        const across = beside ? DAY.standBesideM : 0;
        const baseX = spot.x + spot.faceX * out + sideX * across;
        const baseZ = spot.z + spot.faceZ * out + sideZ * across;
        const faceX = beside ? -sideX : standOut ? -spot.faceX : spot.faceX;
        const faceZ = beside ? -sideZ : standOut ? -spot.faceZ : spot.faceZ;
        for (const id of here) {
          const who = cast(id);
          if (!who || who.kind === 'voice') continue;
          // Side by side along the street, the one who is waiting in the middle.
          const along = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * 1.4 * Math.ceil(k / 2);
          k++;
          const x = baseX - faceZ * along;
          const z = baseZ + faceX * along;
          next.push({
            id,
            kind: who.kind ?? 'person',
            x,
            y: heightAt(x, z),
            z,
            faceX,
            faceZ,
            clothes: who.clothes,
            scale: who.scale ?? 1,
            marked: id === scene.with && view.phase === 'going',
          });
        }
      }
      for (const extra of scene.extras ?? []) {
        const who = cast(extra.who);
        const at = spots[extra.at];
        if (!who || who.kind === 'voice' || !at || next.some((each) => each.id === extra.who)) continue;
        const [along, out] = extra.offset ?? [2, 1];
        const x = at.x - at.faceZ * along + at.faceX * out;
        const z = at.z + at.faceX * along + at.faceZ * out;
        next.push({
          id: extra.who,
          kind: who.kind ?? 'person',
          x,
          y: heightAt(x, z),
          z,
          faceX: -at.faceX,
          faceZ: -at.faceZ,
          clothes: who.clothes,
          scale: who.scale ?? 1,
          marked: false,
        });
      }
    }
    current = next;
    const ids = new Set(next.map((each) => each.id));
    actors.set([...lingering.filter((each) => !ids.has(each.id)), ...current]);
  }

  /** Whoever is close enough to talk to, the person the scene is about first. */
  function nearestTalkable(): { id: string; name: string } | null {
    if (!run || !day) return null;
    const view = run.view();
    const scene = view.scene;
    if (view.phase !== 'going' || !scene) return null;
    if (scene.with) {
      const head = actors.head(scene.with);
      if (head && Math.hypot(head.x - walker.x, head.z - walker.z) < WALK.talkM) {
        return { id: scene.with, name: cast(scene.with)?.name ?? '' };
      }
    }
    for (const extra of run.waiting()) {
      const head = actors.head(extra.who);
      if (head && Math.hypot(head.x - walker.x, head.z - walker.z) < WALK.talkM) {
        return { id: extra.who, name: cast(extra.who)?.name ?? '' };
      }
    }
    return null;
  }

  /**
   * Where on the glass to echo the light when it is out of view: on the edge,
   * on the side to turn to. Null while it can be seen, or there is none.
   */
  function beaconAt(): { x: number; y: number } | null {
    if (!guide.group.visible) return null;
    const width = options.surface.clientWidth;
    const height = options.surface.clientHeight;
    // In the eye's own frame: x to the right, y up, looking down -z.
    const p = inEye.copy(guide.group.position).applyMatrix4(camera.matrixWorldInverse);
    const ahead = p.z < -0.5;
    if (ahead) {
      const glass = onGlass.copy(guide.group.position).project(camera);
      if (Math.abs(glass.x) < 0.94 && Math.abs(glass.y) < 0.94) return null;
    }
    let dx = p.x;
    let dy = p.y;
    if (!ahead) {
      // Behind: to the side it is on, a little low, never straight up.
      dx = (dx >= 0 ? 1 : -1) * Math.max(Math.abs(dx), 1);
      dy = Math.min(dy, 0) * 0.2;
    }
    const angle = Math.atan2(dy, dx);
    const halfW = width / 2 - DAY.beaconInsetPx;
    const halfH = height / 2 - DAY.beaconInsetPx;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.min(Math.abs(cos) > 1e-6 ? halfW / Math.abs(cos) : Infinity, Math.abs(sin) > 1e-6 ? halfH / Math.abs(sin) : Infinity);
    return { x: width / 2 + cos * reach, y: height / 2 - sin * reach };
  }

  function interact(): void {
    if (mode !== 'walking' || !run || ui.menuOpen()) return;
    const view = run.view();
    if (view.phase === 'talking') {
      if (!view.options) run.next();
      return;
    }
    const near = nearestTalkable();
    if (!near) return;
    const scene = view.scene;
    if (scene && near.id === scene.with) run.talk();
    else run.talkTo(near.id);
  }

  function choose(index: 0 | 1): void {
    if (mode !== 'walking' || !run || !run.view().options) return;
    run.choose(index);
  }

  function beginSweep(toHour: number): void {
    const from = world.clock.hourOfDay;
    if (toHour <= from + 0.02) return;
    sweep = { from, to: toHour, s: 0 };
  }

  /** The place of the day whose walled garden (x, z) is in, if any. */
  function gardenAround(x: number, z: number): Spot | null {
    for (const spot of Object.values(spots)) {
      if (!spot.approach) continue;
      const lot = lotsById.get(spot.lotId);
      const garden = lot?.garden;
      if (!lot || !garden) continue;
      const local = toLocal(lot, x, z);
      const inFront = local.z < -lot.dM / 2 + 0.2 && local.z > -(lot.dM / 2 + garden.depthM) - 0.2;
      if (inFront && Math.abs(local.x) < lot.wM / 2 + garden.sideM + 0.2) return spot;
    }
    return null;
  }

  function routeGuide(): void {
    if (!run || !roads) return;
    const view = run.view();
    const scene = view.scene;
    const spot = scene ? spots[scene.at] : undefined;
    if (view.phase !== 'going' || !spot) {
      guide.setPath([], []);
      pathScene = -1;
      return;
    }
    if (Math.hypot(spot.x - walker.x, spot.z - walker.z) < WALK.arriveM) {
      guide.setPath([], []);
      pathScene = view.sceneIndex;
      return;
    }
    // Out through the gate of whatever garden you are standing in, and in
    // through the gate of the one you are going to.
    const inside = gardenAround(walker.x, walker.z);
    const from = { x: walker.x, z: walker.z, approach: inside?.approach };
    const path = wayBetween(roads, from, spot);
    guide.setPath(path.x, path.z);
    pathScene = view.sceneIndex;
    rerouteS = 0;
  }

  function beginRise(closing: string | null): void {
    if (mode !== 'walking') return;
    mode = 'rising';
    closingText = closing;
    flightS = 0;
    const eyes = walker.eyes();
    fromPos.set(eyes.x, eyes.y, eyes.z);
    fromLook.set(eyes.lookX, eyes.lookY, eyes.lookZ);
    toLook.set(walker.x, 0, walker.z);
    toPos.set(walker.x, DAY.riseHeightM, walker.z + DAY.riseHeightM * DAY.riseTilt);
    fovFrom = camera.fov;
    walker.setActive(false);
    // The walker hands back the lens it was given, and after a flight down
    // that was already the wide one: go back to the view from above's own.
    fovTo = aboveFovDeg;
    camera.fov = fovFrom;
    camera.updateProjectionMatrix();
    guide.setPath([], []);
    ui.say(null);
    ui.line(null);
    ui.aim(null);
    ui.choices(null);
    ui.prompt(null);
    ui.waiting(false);
    ui.hint(null);
    ui.beacon(null);
    ui.menu(false);
    world.hush(false);
  }

  function finish(): void {
    mode = 'off';
    rig.controls.target.set(toLook.x, 0, toLook.z);
    camera.position.copy(toPos);
    camera.fov = fovTo;
    camera.updateProjectionMatrix();
    rig.controls.enabled = true;
    rig.controls.update();
    ui.closing(null);
    ui.setVisible(false);
    actors.set([]);
    actors.group.visible = false;
    lingering = [];
    current = [];
    world.clock.paused = clockWasPaused;
    world.sight(null);
    day = null;
    run = null;
    options.onLeave();
  }

  /** The view while the camera is flying in or out: its height is the altitude. */
  function flightView(): ViewState {
    return {
      altitudeM: Math.max(WALK.eyeM, camera.position.y),
      targetX: look.x,
      targetZ: look.z,
      eyeX: camera.position.x,
      eyeY: camera.position.y,
      eyeZ: camera.position.z,
    };
  }

  function fly(t: number, lift: boolean): void {
    // Across first and down after on the way in; up first and across after on the way out.
    const across = ease(Math.min(1, lift ? t * 1.25 : t * 1.5));
    const down = ease(lift ? Math.min(1, t * 1.1) : Math.max(0, t * 1.15 - 0.15));
    camera.position.set(
      fromPos.x + (toPos.x - fromPos.x) * across,
      fromPos.y + (toPos.y - fromPos.y) * down,
      fromPos.z + (toPos.z - fromPos.z) * across,
    );
    look.lerpVectors(fromLook, toLook, ease(t));
    camera.lookAt(look);
    camera.fov = fovFrom + (fovTo - fovFrom) * ease(t);
    // The near plane follows the height, or the street is cut open under the
    // eye at the bottom of the way down, and at the start of the way up.
    const clip = clipPlanesFor(camera.position.y, WALK.nearM);
    camera.near = clip.near;
    camera.far = clip.far;
    camera.updateProjectionMatrix();
  }

  return {
    active: () => mode !== 'off',
    canStart: () => mode === 'off' && !world.busy() && dayFor(world.era.current) !== undefined,
    start: (startOptions = {}) => {
      if (mode !== 'off' || world.busy()) return false;
      const found = dayFor(world.era.current);
      if (!found) return false;
      day = found;
      aboveFovDeg = camera.fov;
      const layout = world.layout();
      const ground: Ground = townGround(layout, world.terrain);
      roads = layout.roads;
      lotsById = new Map(layout.lots.map((lot) => [lot.id, lot]));
      heightAt = surfaceOf(layout);
      spots = castPlaces(found, layout, world.terrain, ground, options.seed);
      run = createRun(found);
      walker.setGround(ground);
      world.sight((x, z) => inSight(ground, walker.x, walker.z, x, z));
      world.closeAll();
      clockWasPaused = world.clock.paused;
      world.clock.paused = true;
      sceneShown = -1;
      pathScene = -1;
      standOutScene = -1;
      lingering = [];
      talkingTo = null;
      sweep = null;
      hintS = DAY.hintS;

      const home = spots.home ?? { x: 0, z: 0, faceX: 0, faceZ: 1, lotId: -1 };
      walker.place(home.x, home.z, home.faceX, home.faceZ);
      const first = startOptions.scene ?? 0;
      if (first > 0) {
        run.skipTo(first);
        const scene = run.view().scene;
        const spot = scene ? spots[scene.at] : undefined;
        if (spot?.approach) {
          // At the gate, looking in at the door.
          const dx = spot.x - spot.approach.x;
          const dz = spot.z - spot.approach.z;
          const length = Math.hypot(dx, dz) || 1;
          walker.place(spot.approach.x, spot.approach.z, dx / length, dz / length);
        } else if (spot && spot.lotId < 0) {
          // A landmark faces the view it is there for: stand a few steps
          // behind it and look the same way.
          walker.place(spot.x - spot.faceX * 4, spot.z - spot.faceZ * 4, spot.faceX, spot.faceZ);
        } else if (spot) {
          // A few steps short of the place, looking at it.
          walker.place(spot.x + spot.faceX * 5, spot.z + spot.faceZ * 5, -spot.faceX, -spot.faceZ);
        }
        world.clock.hourOfDay = scene?.hour ?? world.clock.hourOfDay;
      }

      rig.controls.enabled = false;
      actors.group.visible = true;
      ui.setVisible(true);
      ui.closing(null);
      options.onEnter();
      placeActors();

      const openingHour = run.view().scene?.hour ?? 6;
      if (startOptions.instant || options.reducedMotion) {
        world.clock.hourOfDay = openingHour;
        mode = 'walking';
        walker.setActive(true);
        ui.veil(0);
        return true;
      }
      mode = 'descending';
      flightS = 0;
      beginSweep(openingHour);
      if (world.clock.hourOfDay > openingHour) world.clock.hourOfDay = openingHour;
      fromPos.copy(camera.position);
      fromLook.set(rig.controls.target.x, 0, rig.controls.target.z);
      look.copy(fromLook);
      const eyes = walker.eyes();
      toPos.set(eyes.x, eyes.y, eyes.z);
      toLook.set(eyes.lookX, eyes.lookY, eyes.lookZ);
      fovFrom = camera.fov;
      fovTo = walkFovDeg(aspect);
      return true;
    },
    update: (dtS) => {
      if (mode === 'off' || !run || !day) return null;

      if (sweep) {
        sweep.s += dtS;
        const t = ease(Math.min(1, sweep.s / DAY.sweepS));
        world.clock.hourOfDay = sweep.from + (sweep.to - sweep.from) * t;
        if (sweep.s >= DAY.sweepS) sweep = null;
      }

      if (mode === 'descending') {
        flightS += dtS;
        const t = Math.min(1, flightS / DAY.descendS);
        fly(t, false);
        actors.update(dtS, { id: null, x: 0, z: 0 });
        if (t >= 1) {
          mode = 'walking';
          walker.setActive(true);
        }
        return flightView();
      }

      if (mode === 'rising') {
        flightS += dtS;
        const t = Math.min(1, flightS / DAY.riseS);
        fly(t, true);
        // The last thought hangs a while and goes before the town is small.
        const fade = Math.min(1, flightS / 1.2) * (1 - smoothstep(0.55, 0.85, t));
        ui.closing(closingText, fade);
        if (t >= 1) {
          finish();
          return null;
        }
        return flightView();
      }

      // --- walking --------------------------------------------------------------
      let view = run.view();
      const talking = view.phase === 'talking';
      walker.setHeld(talking || ui.menuOpen());
      walker.update(dtS);
      if (!sweep && !ui.menuOpen() && !talking) {
        world.clock.hourOfDay = Math.min(DAY.lastHour, world.clock.hourOfDay + dtS * DAY.clockHoursPerS);
      }

      if (view.phase === 'ending') {
        beginRise(view.closing);
        return walker.view();
      }

      if (view.sceneIndex !== sceneShown) {
        // On to the next part of the day: whoever was at the last place stays
        // there until the next conversation begins; the clock runs on.
        lingering = current.map((each) => ({ ...each, marked: false }));
        sceneShown = view.sceneIndex;
        placeActors();
        if (view.scene) beginSweep(view.scene.hour);
        pathScene = -1;
      }

      const scene = view.scene;
      const spot = scene ? spots[scene.at] : undefined;
      if (view.phase === 'going' && scene && spot) {
        const away = Math.hypot(spot.x - walker.x, spot.z - walker.z);
        // A moment alone happens as soon as you are there.
        if (!scene.with && away < WALK.arriveM) {
          run.talk();
          view = run.view();
        }
      }

      if (view.phase === 'talking' && lingering.length > 0 && !view.extra) {
        lingering = [];
        placeActors();
      }
      // The ring under whoever is waiting only while they are waiting.
      const marked = current.some((each) => each.marked);
      const waitingHere = !!scene?.with && current.some((each) => each.id === scene.with);
      if (marked !== (view.phase === 'going' && waitingHere)) placeActors();

      // The light, re-routed now and then if you wander off its way.
      if (view.phase === 'going') {
        rerouteS += dtS;
        if (pathScene !== view.sceneIndex) routeGuide();
        else if (rerouteS > DAY.rerouteS) {
          rerouteS = 0;
          if (spot && Math.hypot(spot.x - walker.x, spot.z - walker.z) > WALK.arriveM) {
            const light = guide.group.position;
            if (Math.hypot(light.x - walker.x, light.z - walker.z) > DAY.strayM) routeGuide();
          }
        }
      } else if (pathScene !== -1) {
        guide.setPath([], []);
        pathScene = -1;
      }
      guide.update(dtS, walker.x, walker.z, heightAt(walker.x, walker.z));

      talkingTo = view.phase === 'talking' ? (view.extra ?? scene?.with ?? null) : null;
      actors.update(dtS, { id: talkingTo, x: walker.x, z: walker.z });
      world.hush(view.phase === 'talking');

      // --- the words ----------------------------------------------------------
      camera.updateMatrixWorld();
      if (view.phase === 'talking') {
        ui.aim(null);
        ui.prompt(null);
        const line = view.line;
        if (line && line.kind === 'think') {
          ui.line(line.text, 'think');
          ui.say(null);
        } else if (line && line.who === 'me') {
          ui.line(line.text, 'me');
          ui.say(null);
        } else if (line) {
          const who = cast(line.who);
          if (who?.kind === 'voice') {
            ui.line(line.text, 'voice', who.name);
            ui.say(null);
          } else {
            ui.line(null);
            const head = actors.head(line.who);
            let at: { x: number; y: number } | null = null;
            if (head) {
              const point = new Vector3(head.x, head.y + 0.35, head.z).project(camera);
              if (point.z < 1 && Math.abs(point.x) < 0.95 && point.y < 0.95 && point.y > -0.6) {
                const width = options.surface.clientWidth;
                const height = options.surface.clientHeight;
                at = { x: (point.x * 0.5 + 0.5) * width, y: (1 - (point.y * 0.5 + 0.5)) * height - 8 };
              }
            }
            ui.say(line.text, who?.name, at);
          }
        } else {
          ui.line(null);
          ui.say(null);
        }
        if (view.options && walker.pointerLocked()) {
          released = true;
          walker.releasePointer();
        }
        ui.choices(view.options);
        ui.waiting(!view.options && line !== null);
        ui.beacon(null);
      } else {
        ui.say(null);
        ui.line(null);
        ui.choices(null);
        ui.waiting(false);
        const menu = ui.menuOpen();
        const near = menu ? null : nearestTalkable();
        const catNear = near && cast(near.id)?.kind === 'cat';
        ui.prompt(near ? (catNear ? 'Crouch by the cat' : `Talk to ${near.name}`) : null);
        const away = spot ? Math.hypot(spot.x - walker.x, spot.z - walker.z) : 0;
        ui.aim(!menu && !near && away > WALK.arriveM ? run.aim() : null);
        ui.beacon(menu ? null : beaconAt());
      }

      if (ui.menuOpen()) {
        ui.hint(null);
      } else if (hintS > 0) {
        hintS -= dtS;
        ui.hint(
          ui.touch
            ? 'Left thumb to walk, right thumb to look around'
            : 'Click to look around. W A S D to walk. Esc for the menu',
        );
      } else if (!ui.touch && !walker.pointerLocked() && view.phase !== 'talking') {
        ui.hint('Click to look around');
      } else {
        ui.hint(null);
      }
      return walker.view();
    },
    resize: (width, height) => {
      aspect = width / Math.max(height, 1);
      walker.resize(width, height);
    },
    info: () => {
      if (mode === 'off' || !run || !day) return '';
      const view = run.view();
      return `day: ${day.title}, ${view.scene?.id ?? 'end'} (${view.phase})`;
    },
  };
}
