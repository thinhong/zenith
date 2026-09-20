import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  SRGBColorSpace,
  Scene,
  type Material,
  type Mesh,
  type PerspectiveCamera,
  type Object3D,
} from 'three';
import { createPeople, type People } from '@/agents/people';
import { createMonsters, type Monsters } from '@/agents/monsters';
import { createTraffic, type Traffic } from '@/agents/traffic';
import { ALTITUDE, DETAIL, detailFactor, fogRange } from '@/state/altitude';
import type { ViewState } from '@/core/camera';
import { advanceClock, createClock, localHour, type Clock } from '@/state/clock';
import {
  advanceEraChange,
  beginEraChange,
  createEraState,
  eraEase,
  isChanging,
  RESEAT_AT,
  type EraState,
} from '@/state/era';
import { createBuildings, type Buildings } from '@/world/buildings';
import {
  availableEras,
  DEFAULT_ERA,
  eraById,
  type Era,
  type EraId,
  type EraLayout,
} from '@/world/eras';
import { createGround, type Ground } from '@/world/ground';
import {
  buildLotIndex,
  lotRoadNodes,
  lotsByUse,
  type Lot,
  type LotIndex,
  type LotUse,
} from '@/world/lots';
import { collectProps, createProps, type Props } from '@/world/props';
import { createRoads } from '@/world/road-mesh';
import { mulberry32 } from '@/world/seed';
import { createInteriors } from '@/world/interiors-mesh';
import { buildInterior } from '@/world/interior';
import { createStructures, type Structures } from '@/world/structures';
import { advanceClouds } from '@/world/atmosphere';
import { skyAt, type Rgb } from '@/world/sky';
import { buildTerrain, type TerrainSpec } from '@/world/terrain';
import { createThoughts, type Thoughts } from '@/thoughts/thoughts';

/**
 * Assembles one world from a seed and keeps it in step with altitude, the day
 * clock and the era. Systems never talk to each other; they all read the same
 * shared state (PLAN.md 4.1).
 *
 * The terrain is built once and shared by every era. Everything else, from the
 * roads to what people are worrying about, belongs to the era and is thrown
 * away when it sinks (PLAN.md 4.6).
 */
export interface World {
  scene: Scene;
  clock: Clock;
  terrain: TerrainSpec;
  era: EraState;
  eras: readonly Era[];
  /** Starts a change to another era. Ignored if it is already showing. */
  showEra: (id: EraId) => void;
  /** The era being built, if one is. The bar lights that stop while it waits. */
  pendingEra: () => EraId | null;
  /** The buildings standing open, so their insides can be watched. */
  opened: ReadonlySet<number>;
  /** Opens a building if it is shut, shuts it if it is open. */
  toggleOpen: (lotId: number) => void;
  closeAll: () => void;
  /** Which lot a click landed on, given a hit on one of the building meshes. */
  lotAt: (mesh: Object3D, instanceId: number) => Lot | undefined;
  update: (dtS: number, elapsedS: number, view: ViewState) => void;
  info: () => string;
  /** 0 in daylight, 1 at night. The bloom is a night effect (core/post.ts). */
  nightFactor: () => number;
}

export interface WorldOptions {
  seed: number;
  startHour: number | null;
  /**
   * The viewer has asked their system for less movement. The era change cuts
   * rather than cross-fading, and the clouds stop drifting. It was read from
   * the OS and then never passed to anything, so asking for reduced motion
   * changed nothing at all.
   */
  reducedMotion?: boolean;
  startEra: EraId | null;
  paused: boolean;
  camera: PerspectiveCamera;
  canvas: HTMLElement;
}

const SUN_DISTANCE_M = 1400;
const SHADOW = { mapSize: 4096, extentM: 560, nearM: 200, farM: 3600 } as const;

/** One era's own city: everything that sinks when the dial moves. */
/**
 * Lets go of everything in a group: geometries, materials and the GPU buffers
 * behind them.
 *
 * `scene.remove` only detaches. Nothing here used to be disposed at all, so
 * every era change orphaned a whole city: four building meshes with their
 * compiled node materials, three road meshes with three more, up to seven
 * structure meshes, the prop meshes, and the interiors mesh with its four
 * thousand instance buffers. Dialling back and forth through the eras climbed
 * without bound against the 300 MB budget in PLAN.md 3.1, and ended by losing
 * the WebGPU context.
 *
 * Materials are collected into a set first because the meshes share them: a
 * material disposed twice is not an error, but counting them once makes the
 * cost of a change something that can be reasoned about.
 */
function disposeGroup(group: Object3D): void {
  const materials = new Set<Material>();
  group.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) for (const one of material) materials.add(one);
    else materials.add(material);
  });
  for (const material of materials) material.dispose();
}

interface EraWorld {
  era: Era;
  layout: EraLayout;
  group: Group;
  byUse: Record<LotUse, number[]>;
  lotNodes: Int32Array;
  lotIndex: LotIndex;
  buildings: Buildings;
  props: Props;
  /** Null for an era that puts nothing on its lots beyond the buildings. */
  structures: Structures | null;
  setRoadOpacity: (value: number) => void;
  setOpen: (lotIds: ReadonlySet<number>, towardX: number, towardZ: number) => void;
  lotAt: (mesh: Object3D, instanceId: number) => Lot | undefined;
}

export function createWorld({
  seed,
  startHour,
  reducedMotion = false,
  startEra,
  paused,
  camera,
  canvas,
}: WorldOptions): World {
  const terrain = buildTerrain(mulberry32(seed));
  const eras = availableEras();
  // The viewer's own hour, unless ?hour= asked for a particular one.
  const clock = createClock(startHour ?? localHour());
  clock.paused = paused;

  const scene = new Scene();
  const background = new Color();
  const fog = new Fog(background, 1000, 6000);
  scene.background = background;
  scene.fog = fog;

  const ambient = new HemisphereLight(0xffffff, 0xffffff, 0.6);
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  sun.shadow.camera.left = -SHADOW.extentM;
  sun.shadow.camera.right = SHADOW.extentM;
  sun.shadow.camera.top = SHADOW.extentM;
  sun.shadow.camera.bottom = -SHADOW.extentM;
  sun.shadow.camera.near = SHADOW.nearM;
  sun.shadow.camera.far = SHADOW.farM;
  sun.shadow.bias = -0.0009;
  sun.shadow.intensity = 0.75;

  const first = (startEra ? eraById(startEra) : undefined) ?? eraById(DEFAULT_ERA) ?? eras[0];
  if (!first) throw new Error('no eras are built');

  const ground: Ground = createGround(
    terrain,
    first.palette.townGround,
    first.palette.land,
    first.palette.water,
  );
  scene.add(ambient, sun, sun.target, ground.group);

  /**
   * Builds one era's city in steps. The seed is shared, so every era stands on
   * the same land. Each step is sized to fit inside one frame; `update()` runs
   * one per frame, so changing era costs no dropped frame (PLAN.md 3.1).
   */
  function* eraWorldSteps(era: Era): Generator<void, EraWorld, void> {
    const layout = yield* era.build(mulberry32(seed), terrain);
    yield;
    const group = new Group();
    group.name = `era-${era.id}`;

    const roads = createRoads(layout.roads, era.palette.road, era.palette.pavement);
    yield;
    const buildings = createBuildings(layout.lots, {
      colours: era.palette.building,
      roof: era.palette.roof,
      // The citadel puts a proper tiled roof on every building itself.
      caps: layout.structures.length === 0,
      litShare: era.palette.windowsLit,
      glow: era.palette.windowGlow,
      glowTint: era.palette.windowTint,
    });
    yield;
    const propPalette = {
      canopy: era.palette.canopy,
      trunk: era.palette.trunk,
      lampOn: era.palette.lampOn,
      courtyardChance: era.palette.courtyardChance,
      canopyScale: era.palette.canopyScale,
      canopyRound: era.palette.canopyRound,
      roundShare: era.palette.roundShare,
      bush: era.palette.bush,
      bushesPerTree: era.palette.bushesPerTree,
      lamps: era.palette.lamps,
    };
    const placements = collectProps(
      mulberry32(seed + 17),
      terrain,
      layout.roads,
      layout.lots,
      propPalette,
    );
    yield;
    const props = createProps(placements, propPalette);

    yield;

    const structures = layout.structures.length > 0 ? createStructures(layout.structures) : null;
    const interiors = createInteriors();
    group.add(roads.group, buildings.group, props.group, interiors.group);
    if (structures) group.add(structures.group);
    group.traverse((object) => {
      object.castShadow = true;
      object.receiveShadow = true;
    });
    scene.add(group);
    yield;

    const byUse = lotsByUse(layout.lots);
    const lotIndex = buildLotIndex(layout.lots);
    yield;
    const lotNodes = lotRoadNodes(layout.lots, layout.roads);

    return {
      era,
      layout,
      group,
      byUse,
      lotNodes,
      lotIndex,
      buildings,
      props,
      structures,
      setRoadOpacity: roads.setOpacity,
      /**
       * Takes these buildings away, with their roofs and their water tanks,
       * and stands an open shell in their place. The camera always looks
       * down, so a building with no roof is a section drawing: this is why
       * opening one is better than making the whole town transparent.
       */
      setOpen: (lotIds, towardX, towardZ) => {
        buildings.setHidden(lotIds);
        structures?.setHidden(lotIds);
        interiors.clear();
        for (const id of lotIds) {
          const lot = layout.lots[id];
          if (lot && lot.heightM > 0) {
            interiors.add(lot.id, buildInterior(lot, era.interior, towardX, towardZ));
          }
        }
      },
      lotAt: (object, instanceId) => {
        const direct = buildings.lotAt(object, instanceId);
        if (direct) return direct;
        const owner = interiors.lotAt(object, instanceId);
        return owner === undefined ? undefined : layout.lots[owner];
      },
    };
  }

  /** Runs a build to the end. Used for the first city, with nothing on screen. */
  function buildEraWorld(era: Era): EraWorld {
    const steps = eraWorldSteps(era);
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
    }
  }

  /**
   * The buildings standing open. Cleared on a change of era, because a lot id
   * means nothing in the next one.
   */
  const opened = new Set<number>();
  /**
   * Where the viewer was standing when the open buildings were last built, as
   * a unit vector on the ground. When the camera swings far enough round, the
   * wall that was behind you is now the one in front, so they are rebuilt.
   */
  let openedTowardX = 0;
  let openedTowardZ = 1;

  /** The direction from the ground to the camera, flattened and normalised. */
  function viewToward(view: ViewState): { x: number; z: number } {
    const dx = camera.position.x - view.targetX;
    const dz = camera.position.z - view.targetZ;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) return { x: 0, z: 1 };
    return { x: dx / length, z: dz / length };
  }

  function rebuildOpen(toward: { x: number; z: number }): void {
    openedTowardX = toward.x;
    openedTowardZ = toward.z;
    current.setOpen(opened, toward.x, toward.z);
  }

  let lastView: ViewState = {
    altitudeM: ALTITUDE.start,
    targetX: 0,
    targetZ: 0,
    eyeX: 0,
    eyeY: ALTITUDE.start,
    eyeZ: 0,
  };
  let current = buildEraWorld(first);
  let leaving: EraWorld | null = null;
  /** The era being built, one step per frame. Null while nothing is coming. */
  let pending: { id: EraId; steps: Generator<void, EraWorld, void> } | null = null;
  const era = createEraState(first.id);

  const traffic: { system: Traffic } = {
    system: createTraffic({
      rng: mulberry32(seed + 3),
      graph: current.layout.roads,
      wanted: first.population.vehicles,
      profile: first.vehicles,
    }),
  };
  scene.add(traffic.system.group);

  const people: People = createPeople({
    rng: mulberry32(seed + 5),
    graph: current.layout.roads,
    lots: current.layout.lots,
    byUse: current.byUse,
    lotNodes: current.lotNodes,
    lotIndex: current.lotIndex,
    wanted: first.population.people,
    capacity: Math.max(...eras.map((each) => each.population.people)),
    startHour: clock.hourOfDay,
    clothes: first.palette.clothes,
    // People sealed inside a building are hidden by its walls, so they are not
    // drawn until it is opened.
    isOpen: (lotId) => opened.has(lotId),
  });
  scene.add(people.group);

  /**
   * Only the mythic age has anything living in it besides people, so this is
   * null the rest of the time and built and thrown away with the era, the
   * same as the traffic is.
   */
  let monsters: Monsters | null = null;
  function buildMonsters(): void {
    if (monsters) {
      scene.remove(monsters.group);
      disposeGroup(monsters.group);
      monsters = null;
    }
    if (!current.era.monsters) return;
    monsters = createMonsters({
      rng: mulberry32(seed + 7),
      graph: current.layout.roads,
      cityRadiusM: current.layout.cityRadiusM,
    });
    scene.add(monsters.group);
  }
  buildMonsters();

  const thoughts: Thoughts = createThoughts({
    people,
    camera,
    canvas,
    set: first.thoughts,
    // Only people you can see get to think out loud. Click a building open and
    // the people in it start talking; shut it and they go quiet again.
    isOpen: (lotId) => opened.has(lotId),
  });

  const fromTown = new Color();
  const toTown = new Color();
  const blendTown = new Color();
  const fromLand = new Color();
  const fromWater = new Color();
  const toLand = new Color();
  const toWater = new Color();
  const blendLand = new Color();
  const blendWater = new Color();
  setEraColours(first, fromTown, fromLand, fromWater);
  setEraColours(first, toTown, toLand, toWater);
  ground.setColours(fromTown, fromLand, fromWater);

  /**
   * Starts building the era. The cross-fade begins once it is built, a few
   * frames later; until then the bar shows the stop as pending.
   */
  function showEra(id: EraId): void {
    /**
     * What we will be showing once everything in flight has settled: the era
     * being built if one is, and otherwise the one on screen. During a
     * cross-fade `era.current` is already the era being faded in, so this is
     * the right question in every case.
     *
     * Asking for that era again has to do nothing at all. It used to fall
     * through and queue a rebuild of the era already on screen, and that
     * wedged the world: `beginEraChange` refuses a change to the era it is
     * already on, so it returned without starting one, while `advancePending`
     * had already pushed the visible city into `leaving` and squashed the new
     * copy to a thousandth of its height. Nothing then restored it. The old
     * city stayed in the scene forever, never removed; a flat copy of it was
     * painted over the roads; and because `current` pointed at the invisible
     * copy, clicking a building stopped opening anything until a different
     * era was picked. Pressing "2" and then "3" during the eight frames a
     * build takes was enough, and the bar invites it by lighting the pending
     * stop rather than the visible one.
     */
    const settlingOn = pending?.id ?? era.current;
    if (id === settlingOn) return;
    if (id === era.current && !isChanging(era)) {
      // Asked for the era already on screen while a different one was being
      // built. That means "never mind": drop the build rather than start one.
      pending = null;
      return;
    }
    const next = eraById(id);
    if (!next) return;
    pending = { id, steps: eraWorldSteps(next) };
  }

  /** Runs one step of the pending build, and starts the fade on the last one. */
  function advancePending(): void {
    if (!pending) return;
    const step = pending.steps.next();
    if (!step.done) return;

    const built = step.value;
    opened.clear();
    if (leaving) {
      // A second change while one is still running: drop the one already sinking.
      scene.remove(leaving.group);
      disposeGroup(leaving.group);
      leaving = null;
    }
    leaving = current;
    current = built;
    current.group.scale.y = 0.001;
    current.setRoadOpacity(0);
    setEraColours(leaving.era, fromTown, fromLand, fromWater);
    setEraColours(current.era, toTown, toLand, toWater);
    if (!beginEraChange(era, pending.id)) {
      // No cross-fade to run. `showEra` makes this unreachable, and it is
      // guarded anyway because the cost of being wrong is a world that never
      // comes back: put the new city on screen and drop the old one, so the
      // worst case is a hard cut instead of a blank.
      current.group.scale.y = 1;
      current.setRoadOpacity(1);
      scene.remove(leaving.group);
      disposeGroup(leaving.group);
      leaving = null;
      reseatAgents();
    }
    pending = null;
  }

  function reseatAgents(): void {
    people.reseat({
      graph: current.layout.roads,
      lots: current.layout.lots,
      byUse: current.byUse,
      lotNodes: current.lotNodes,
      lotIndex: current.lotIndex,
      clothes: current.era.palette.clothes,
      wanted: current.era.population.people,
      startHour: clock.hourOfDay,
    });
    scene.remove(traffic.system.group);
    disposeGroup(traffic.system.group);
    traffic.system = createTraffic({
      rng: mulberry32(seed + 3),
      graph: current.layout.roads,
      wanted: current.era.population.vehicles,
      profile: current.era.vehicles,
    });
    scene.add(traffic.system.group);
    buildMonsters();
    thoughts.setThoughts(current.era.thoughts);
  }

  return {
    scene,
    clock,
    terrain,
    era,
    eras,
    showEra,
    pendingEra: () => pending?.id ?? null,
    opened,
    toggleOpen: (lotId) => {
      if (opened.has(lotId)) opened.delete(lotId);
      else opened.add(lotId);
      rebuildOpen(viewToward(lastView));
    },
    closeAll: () => {
      if (opened.size === 0) return;
      opened.clear();
      rebuildOpen(viewToward(lastView));
    },
    lotAt: (mesh, instanceId) => current.lotAt(mesh, instanceId),
    nightFactor: () => skyAt(clock.hourOfDay).nightFactor,
    update: (dtS, elapsedS, view) => {
      lastView = view;
      // A quarter turn is enough to put a different pair of walls in the way.
      if (opened.size > 0) {
        const toward = viewToward(view);
        if (toward.x * openedTowardX + toward.z * openedTowardZ < 0.84) rebuildOpen(toward);
      }
      const altitudeM = view.altitudeM;
      advanceClock(clock, dtS);
      if (!reducedMotion) advanceClouds(elapsedS);
      advancePending();

      if (isChanging(era)) {
        advanceEraChange(era, dtS, reducedMotion ? 0 : undefined);
        const rise = eraEase(era.progress);
        current.group.scale.y = Math.max(0.001, rise);
        current.setRoadOpacity(rise);
        if (leaving) {
          leaving.group.scale.y = Math.max(0.001, 1 - rise);
          leaving.setRoadOpacity(1 - rise);
        }
        blendTown.copy(fromTown).lerp(toTown, rise);
        blendLand.copy(fromLand).lerp(toLand, rise);
        blendWater.copy(fromWater).lerp(toWater, rise);
        ground.setColours(blendTown, blendLand, blendWater);

        if (!era.reseated && era.progress >= RESEAT_AT) {
          era.reseated = true;
          reseatAgents();
        }
        if (!isChanging(era) && leaving) {
          scene.remove(leaving.group);
          disposeGroup(leaving.group);
          leaving = null;
          current.group.scale.y = 1;
          current.setRoadOpacity(1);
        }
      }

      const sky = skyAt(clock.hourOfDay);
      applyRgb(background, sky.sky);
      applyRgb(fog.color, sky.fog);
      const range = fogRange(altitudeM);
      fog.near = range.nearM;
      fog.far = range.farM;

      sun.target.position.set(view.targetX, 0, view.targetZ);
      sun.target.updateMatrixWorld();
      sun.position.set(
        view.targetX + sky.sunDir.x * SUN_DISTANCE_M,
        sky.sunDir.y * SUN_DISTANCE_M,
        view.targetZ + sky.sunDir.z * SUN_DISTANCE_M,
      );
      sun.castShadow = altitudeM < DETAIL.shadowMaxM;
      applyRgb(sun.color, sky.sunColor);
      sun.intensity = sky.sunIntensity;
      applyRgb(ambient.color, sky.ambientColor);
      applyRgb(ambient.groundColor, sky.bounceColor);
      ambient.intensity = sky.ambientIntensity;

      const night = sky.nightFactor;
      const windows = detailFactor(DETAIL.windows, altitudeM);
      const props = detailFactor(DETAIL.props, altitudeM);
      for (const world of [current, leaving]) {
        if (!world) continue;
        world.buildings.setNight(night);
        world.buildings.setDetail(windows);
        world.buildings.setFacade(detailFactor(DETAIL.facade, altitudeM));
        world.props.setNight(night);
        world.props.setDetail(props);
      }

      people.update(dtS, clock.hourOfDay, view);
      traffic.system.update(dtS, clock.hourOfDay, view);
      monsters?.update(dtS, view);
      thoughts.update(dtS, view);
    },
    info: () =>
      `seed: ${seed}  water: ${terrain.water.kind}\n` +
      `era: ${current.era.name} ${current.era.year}` +
      `${isChanging(era) ? ` (${(era.progress * 100).toFixed(0)}%)` : ''}\n` +
      `roads: ${current.layout.roads.edges.length}  lots: ${current.layout.lots.length}\n` +
      `people: ${people.count}  out: ${people.stats.outside}  drawn: ${people.stats.drawn}  walking: ${people.stats.walking}\n` +
      `vehicles: ${traffic.system.stats.active}  thoughts: ${thoughts.stats.shown}\n` +
      (monsters
        ? `monsters: ${monsters.stats.drawn} drawn  fights: ${monsters.stats.fights}\n`
        : '') +
      `agents: ${(people.stats.updateMs + traffic.system.stats.updateMs + (monsters?.stats.updateMs ?? 0)).toFixed(2)} ms\n` +
      `hour: ${formatHour(clock.hourOfDay)}${clock.paused ? ' (paused)' : ''}`,
  };
}

function setEraColours(era: Era, town: Color, land: Color, water: Color): void {
  town.set(era.palette.townGround);
  land.set(era.palette.land);
  water.set(era.palette.water);
}

function applyRgb(target: Color, rgb: Rgb): void {
  target.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
}

function formatHour(hourOfDay: number): string {
  const h = Math.floor(hourOfDay);
  const m = Math.floor((hourOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
