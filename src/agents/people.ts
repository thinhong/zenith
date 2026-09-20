import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Points,
  PointsMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ViewState } from '@/core/camera';
import { AGENTS, drawRadius } from '@/state/altitude';
import { buildWalkPath } from '@/agents/paths';
import {
  advanceAgent,
  agentX,
  agentZ,
  createAgentPool,
  placeAgent,
  POOL,
  populate,
  setPath,
  STATE,
} from '@/agents/pool';
import {
  desiredUse,
  destinationAt,
  destinationIndex,
  isIndoors,
  roleAt,
  type Destination,
} from '@/agents/schedule';
import type { Lot, LotIndex, LotUse } from '@/world/lots';
import {
  attachInstanceColors,
  createTintedInstanceMaterial,
  markColorsChanged,
  markDynamic,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';
import { figureGeometry } from '@/agents/figure';
import { OUTDOOR_SPREAD, spotInside, spotOutside, storeyHeightM, storeysIn } from '@/world/interior';
import { nearestNode, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * People walking between home, work, market, park and temple. The pool and the
 * routing are pure (agents/pool.ts, agents/paths.ts); this file owns the
 * three.js side and the per-frame budget.
 *
 * Time slicing: anyone near the look-at point moves every frame, everyone else
 * every eighth frame with eight times the step. Nobody can see a figure a
 * kilometre away update at 7 Hz, and it cuts the work by most of an order of
 * magnitude (PLAN.md 3.1, at most 4 ms per frame).
 */
const PEOPLE = {
  /** Most figures drawn at once. Only those near the look-at point are. */
  maxFigures: 4200,
  /** How many routes may be worked out in one frame. */
  /**
   * Routes worked out in one frame. The median frame costs about 1 ms; the
   * spikes are all here, so this is the number that sets the worst one.
   */
  pathsPerFrame: 6,
  /** How often a person reconsiders where they should be, in seconds. */
  thinkEveryS: { min: 1.5, max: 3.5 },
  /** How high a walking figure bobs, in metres (PLAN.md 5). */
  bobM: 0.05,
  bobRate: 7,
  sitScale: 0.6,
  /** A person is 1.7 m tall (PLAN.md 5). */
  heightM: 1.7,
  /**
   * A person is 1.7 m tall, which past about 300 m is under a pixel, so above
   * that they are drawn as dots instead. The dots are what the aerial view is
   * made of, so they are a little larger than life and carry the person's own
   * clothing colour: a single pale grey reads as dust on the roofs.
   */
  dotSizePx: 4.5,

} as const;

export interface PeopleStats {
  updateMs: number;
  outside: number;
  walking: number;
  drawn: number;
}

/** A person close enough to read a thought off, for thoughts/thoughts.ts. */
export interface NearbyPerson {
  agent: number;
  x: number;
  z: number;
  /** Height of the head above the ground, in metres. */
  headM: number;
  place: Destination | 'street';
  distanceM: number;
  /** The lot this person is inside, or -1 when they are out of doors. */
  insideLot: number;
}

/** Everything that changes when the world becomes a different era. */
export interface ReseatOptions {
  graph: RoadGraph;
  lots: readonly Lot[];
  byUse: Record<LotUse, number[]>;
  lotNodes: Int32Array;
  lotIndex: LotIndex;
  clothes: readonly number[];
  wanted: number;
  startHour: number;
}

export interface People {
  group: Group;
  count: number;
  stats: PeopleStats;
  update: (dtS: number, hourOfDay: number, view: ViewState) => void;
  /**
   * The people nearest a point, nearest first.
   *
   * `visible` decides whether somebody indoors counts. Thoughts pass the set of
   * opened buildings, because a pill floating over a sealed roof reads as a
   * caption pinned to the architecture rather than to a person: the thought has
   * to belong to somebody you can see. It is applied inside the distance loop,
   * not to the result, or six sealed clerks standing closer than the street
   * would fill every slot and leave the visible crowd silent.
   */
  nearby: (
    x: number,
    z: number,
    radiusM: number,
    max: number,
    visible?: (lotId: number) => boolean,
  ) => NearbyPerson[];
  /**
   * Moves the whole population onto a different era's layout, in place. The
   * pool and its buffers are kept, because building four thousand people again
   * in one frame is exactly the hitch the era change is trying to avoid.
   */
  reseat: (next: ReseatOptions) => void;

}

export interface PeopleOptions {
  rng: Rng;
  graph: RoadGraph;
  lots: readonly Lot[];
  byUse: Record<LotUse, number[]>;
  lotNodes: Int32Array;
  lotIndex: LotIndex;
  wanted: number;
  /**
   * How many the pool holds. An era change reuses the pool rather than
   * rebuilding it, so it is allocated for the largest era: without this a city
   * entered from the citadel would hold 2600 people where it wants 4000.
   */
  capacity: number;
  /** The hour the world opens at (state/clock.ts). */
  startHour: number;
  /**
   * The era's clothing. Deliberately light in every era: a figure is 1.7 m
   * tall, five to eight pixels from the roof band, and the streets are dark,
   * so mid-tones vanish.
   */
  clothes: readonly number[];
  /**
   * Whether a building is standing open. People inside a sealed one are behind
   * a wall and depth-tested away, so drawing them is work nobody sees: at
   * street level in 2020 that was four thousand figures and three quarters of
   * a million triangles hidden inside offices. Open a building and its people
   * appear, which is the only visible effect this has.
   */
  isOpen?: (lotId: number) => boolean;
}

export function createPeople(options: PeopleOptions): People {
  const rng = options.rng;
  const isOpen = options.isOpen;
  // Reassigned when the era changes; see reseat().
  let { graph, lots, byUse, lotNodes, lotIndex } = options;
  let clothes = options.clothes;
  let palette = paletteToLinear(clothes);

  const pool = createAgentPool(Math.min(Math.max(options.capacity, options.wanted), POOL.maxPeople));
  populate(rng, pool, {
    lots,
    byUse,
    lotIndex,
    clothesCount: clothes.length,
    wanted: options.wanted,
    startHour: options.startHour,
  });

  const group = new Group();
  group.name = 'people';

  const geometry = figureGeometry();
  const figures = new InstancedMesh(geometry, createTintedInstanceMaterial(), PEOPLE.maxFigures);
  figures.name = 'people-figures';
  figures.count = 0;
  figures.frustumCulled = false;
  markDynamic(figures);
  const figureColors = attachInstanceColors(figures, PEOPLE.maxFigures);
  // InstancedMesh always allocates its matrices as a Float32Array; three only
  // types the field as the union of every typed array. Narrowed once, here,
  // rather than on every frame.
  const figureMatrices = figures.instanceMatrix.array as Float32Array;
  group.add(figures);

  /*
   * There is no second pass drawing the crowd through walls any more. It was
   * put in when a building could not be opened and everybody indoors was
   * simply not drawn, and it did answer that. What it does now is scatter
   * figures over the face of every tower between the viewer and the people
   * behind it, which is worse than not seeing them: a person standing on the
   * far pavement appears to be stuck to a wall. Opening a building is the way
   * to see inside one.
   */

  const dotPositions = new Float32Array(pool.capacity * 3);
  const dotTints = new Float32Array(pool.capacity * 3);
  const dotGeometry = new BufferGeometry();
  const dotAttribute = new BufferAttribute(dotPositions, 3);
  const dotColorAttribute = new BufferAttribute(dotTints, 3);
  dotAttribute.setUsage(DynamicDrawUsage);
  dotColorAttribute.setUsage(DynamicDrawUsage);
  dotGeometry.setAttribute('position', dotAttribute);
  dotGeometry.setAttribute('color', dotColorAttribute);
  dotGeometry.setDrawRange(0, 0);
  const dots = new Points(
    dotGeometry,
    new PointsMaterial({
      color: new Color(0xffffff),
      vertexColors: true,
      size: PEOPLE.dotSizePx,
      sizeAttenuation: false,
      // Depth-tested, like everything else. Drawing them through the roofs
      // showed the whole population at once, but it also put people on top of
      // buildings they were nowhere near, and a town where the crowd floats
      // over the rooftops reads as a fault rather than as a crowd.
      depthWrite: false,
    }),
  );
  dots.name = 'people-dots';
  dots.frustumCulled = false;
  group.add(dots);

  const stats: PeopleStats = { updateMs: 0, outside: 0, walking: 0, drawn: 0 };
  let figureScale = 1;
  const pending: number[] = [];
  let frame = 0;
  let elapsedS = 0;

  function chooseLot(index: number, want: Destination): number {
    if (want === 'home') return pool.homeLot[index] ?? -1;
    if (want === 'work') return pool.workLot[index] ?? -1;
    // The market down the road, not one across the city: an errand has to fit
    // inside the slot of the day that sent them out.
    const found = lotIndex.nearest(want, agentX(pool, index), agentZ(pool, index));
    return found >= 0 ? found : (pool.homeLot[index] ?? -1);
  }

  function think(index: number, hourOfDay: number, stepS: number): void {
    const next = (pool.thinkS[index] ?? 0) - stepS;
    if (next > 0) {
      pool.thinkS[index] = next;
      return;
    }
    pool.thinkS[index] = range(rng, PEOPLE.thinkEveryS.min, PEOPLE.thinkEveryS.max);
    const role = roleAt(pool.role[index] ?? 0);
    const want = desiredUse(role, hourOfDay + (pool.hourOffset[index] ?? 0));
    if (want === destinationAt(pool.currentUse[index] ?? 0)) return;
    const target = chooseLot(index, want);
    if (target < 0) return;
    pool.targetLot[index] = target;
    pool.currentUse[index] = destinationIndex(want);
    pending.push(index);
  }

  function arrive(index: number): void {
    const use = destinationAt(pool.currentUse[index] ?? 0);
    const lot = lots[pool.targetLot[index] ?? 0];
    if (!lot) {
      pool.state[index] = STATE.inside;
      return;
    }
    if (isIndoors(use)) {
      // Through the door, and then to a spot on a floor of their own rather
      // than to the centre of the building with everybody else (interior.ts).
      const spot = spotInside(lot, pool.phase[index] ?? 0);
      pool.storey[index] = spot.storey;
      pool.state[index] = STATE.inside;
      placeAgent(pool, index, spot.x, spot.z);
      return;
    }
    const spread =
      use === 'park' ? OUTDOOR_SPREAD.park : use === 'market' ? OUTDOOR_SPREAD.market : OUTDOOR_SPREAD.temple;
    const spot = spotOutside(lot, pool.phase[index] ?? 0, spread);
    placeAgent(pool, index, spot.x, spot.z);
    pool.state[index] = use === 'park' ? STATE.sitting : STATE.standing;
  }

  function simulate(dtS: number, hourOfDay: number, view: ViewState): void {
    const slice = frame % AGENTS.farStride;
    const nearSquared = AGENTS.nearM * AGENTS.nearM;
    let outside = 0;
    let walking = 0;
    for (let i = 0; i < pool.count; i++) {
      const state = pool.state[i] ?? 0;
      if (state !== STATE.inside) outside++;
      if (state === STATE.walking) walking++;

      const dx = agentX(pool, i) - view.targetX;
      const dz = agentZ(pool, i) - view.targetZ;
      const near = dx * dx + dz * dz < nearSquared;
      if (!near && i % AGENTS.farStride !== slice) continue;
      const stepS = near ? dtS : dtS * AGENTS.farStride;

      think(i, hourOfDay, stepS);
      if (pool.state[i] === STATE.walking && advanceAgent(pool, i, stepS)) arrive(i);
    }
    stats.outside = outside;
    stats.walking = walking;
  }

  function routeSome(): void {
    let built = 0;
    while (pending.length > 0 && built < PEOPLE.pathsPerFrame) {
      const index = pending.shift();
      if (index === undefined) break;
      built++;
      const target = lots[pool.targetLot[index] ?? 0];
      if (!target) continue;
      const x = agentX(pool, index);
      const z = agentZ(pool, index);
      // From where the walker actually is, not from the lot it was assigned to:
      // it may have changed its mind halfway down the street.
      const fromNode = nearestNode(graph, x, z);
      const toNode = lotNodes[target.id] ?? -1;
      if (fromNode < 0 || toNode < 0) continue;
      const route = buildWalkPath(graph, {
        fromX: x,
        fromZ: z,
        toX: target.x,
        toZ: target.z,
        fromNode,
        toNode,
        laneM: pool.laneM[index] ?? 5,
      });
      setPath(pool, index, route.x, route.z);
      pool.state[index] = STATE.walking;
    }
  }

  function drawFigures(view: ViewState): void {
    const radius = drawRadius(view.altitudeM);
    const radiusSquared = radius * radius;
    let slot = 0;
    for (let i = 0; i < pool.count && slot < PEOPLE.maxFigures; i++) {
      const state = pool.state[i] ?? 0;
      // Behind a wall: the depth test would throw the figure away anyway.
      if (state === STATE.inside && isOpen && !isOpen(pool.targetLot[i] ?? -1)) continue;
      const floorY = state === STATE.inside ? storeyHeightM(pool.storey[i] ?? 0) : 0;
      const x = agentX(pool, i);
      const z = agentZ(pool, i);
      const dx = x - view.targetX;
      const dz = z - view.targetZ;
      if (dx * dx + dz * dz > radiusSquared) continue;

      const bob =
        state === STATE.walking
          ? Math.abs(Math.sin(elapsedS * PEOPLE.bobRate + (pool.phase[i] ?? 0))) * PEOPLE.bobM
          : 0;
      const scaleY = state === STATE.sitting ? PEOPLE.sitScale : 1;
      // Local +x is the figure's front, so the heading is negated (see instanced.ts).
      writeInstanceMatrix(
        figureMatrices,
        slot,
        x,
        floorY + bob,
        z,
        -(pool.heading[i] ?? 0),
        figureScale,
        scaleY * figureScale,
        figureScale,
      );

      const source = (pool.clothes[i] ?? 0) * 3;
      figureColors[slot * 3] = palette[source] ?? 0.6;
      figureColors[slot * 3 + 1] = palette[source + 1] ?? 0.6;
      figureColors[slot * 3 + 2] = palette[source + 2] ?? 0.6;
      slot++;
    }
    figures.count = slot;
    figures.instanceMatrix.needsUpdate = true;
    markColorsChanged(figures);
    stats.drawn = slot;
  }

  function drawDots(): void {
    let written = 0;
    for (let i = 0; i < pool.count; i++) {
      dotPositions[written * 3] = agentX(pool, i);
      dotPositions[written * 3 + 1] = 1;
      dotPositions[written * 3 + 2] = agentZ(pool, i);
      const source = (pool.clothes[i] ?? 0) * 3;
      dotTints[written * 3] = palette[source] ?? 0.6;
      dotTints[written * 3 + 1] = palette[source + 1] ?? 0.6;
      dotTints[written * 3 + 2] = palette[source + 2] ?? 0.6;
      written++;
    }
    dotGeometry.setDrawRange(0, written);
    dotAttribute.needsUpdate = true;
    dotColorAttribute.needsUpdate = true;
    stats.drawn = written;
  }

  function nearby(
    x: number,
    z: number,
    radiusM: number,
    max: number,
    visible?: (lotId: number) => boolean,
  ): NearbyPerson[] {
    const found: NearbyPerson[] = [];
    const limitSquared = radiusM * radiusM;
    for (let i = 0; i < pool.count; i++) {
      const state = pool.state[i] ?? 0;
      // Indoors counts, but only when the building is standing open. A thought
      // from inside a house is the better half of them, and dropping those
      // people left the citadel and 2300 nearly silent at midday, when most of
      // the crowd is at a desk. Keeping all of them was the opposite fault:
      // pills hanging over sealed roofs with nobody underneath.
      const insideLot = state === STATE.inside ? (pool.targetLot[i] ?? -1) : -1;
      if (insideLot >= 0 && visible && !visible(insideLot)) continue;
      const px = agentX(pool, i);
      const pz = agentZ(pool, i);
      const dx = px - x;
      const dz = pz - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > limitSquared) continue;
      const distanceM = Math.sqrt(distanceSquared);
      const furthest = found[found.length - 1];
      if (found.length >= max && furthest && distanceM >= furthest.distanceM) continue;
      const person: NearbyPerson = {
        agent: i,
        x: px,
        z: pz,
        // Above the floor they are on, not above the ground. An indoor person
        // stands on a storey now, so a clerk on the eighth floor was having
        // their thought drawn down at the pavement, detached from them and
        // sitting over the building they were inside. It shows worst in the
        // citadel and in 2300, where most of the crowd is indoors.
        headM:
          (state === STATE.inside ? storeyHeightM(pool.storey[i] ?? 0) : 0) +
          PEOPLE.heightM * (state === STATE.sitting ? PEOPLE.sitScale : 1),
        place: state === STATE.walking ? 'street' : destinationAt(pool.currentUse[i] ?? 0),
        distanceM,
        insideLot,
      };
      let at = found.length;
      while (at > 0 && (found[at - 1]?.distanceM ?? 0) > distanceM) at--;
      found.splice(at, 0, person);
      if (found.length > max) found.pop();
    }
    return found;
  }

  return {
    group,
    get count(): number {
      return pool.count;
    },
    stats,
    nearby,

    reseat: (next) => {
      graph = next.graph;
      lots = next.lots;
      byUse = next.byUse;
      lotNodes = next.lotNodes;
      lotIndex = next.lotIndex;
      clothes = next.clothes;
      palette = paletteToLinear(clothes);
      pending.length = 0;
      populate(rng, pool, {
        lots,
        byUse,
        lotIndex,
        clothesCount: clothes.length,
        wanted: next.wanted,
        startHour: next.startHour,
      });
    },
    update: (dtS, hourOfDay, view) => {
      const started = performance.now();
      frame++;
      elapsedS += dtS;

      simulate(dtS, hourOfDay, view);
      routeSome();

      const showFigures = view.altitudeM < AGENTS.figuresMaxM;
      const showDots = !showFigures && view.altitudeM < AGENTS.peopleDotsMaxM;
      figures.visible = showFigures;
      dots.visible = showDots;
      if (showFigures) drawFigures(view);
      else if (showDots) drawDots();
      else stats.drawn = 0;

      stats.updateMs = performance.now() - started;
    },
  };
}

/**
 * Three boxes: legs, body, head, 1.7 m tall with its feet at y = 0 and its
 * front along local +x. No skeleton anywhere in Zenith (PLAN.md 5).
 */
function fract(value: number): number {
  return value - Math.floor(value);
}
