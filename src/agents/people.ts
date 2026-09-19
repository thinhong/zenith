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
import { AGENTS } from '@/state/altitude';
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
  createInstanceColorMaterial,
  markColorsChanged,
  markDynamic,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';
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
  maxFigures: 1400,
  /** How many routes may be worked out in one frame. */
  pathsPerFrame: 12,
  /** How often a person reconsiders where they should be, in seconds. */
  thinkEveryS: { min: 1.5, max: 3.5 },
  /** How high a walking figure bobs, in metres (PLAN.md 5). */
  bobM: 0.05,
  bobRate: 7,
  sitScale: 0.6,
  /** How far across a lot people spread once they arrive. */
  spread: { market: 0.18, park: 0.38, temple: 0.22 },
  dotSizePx: 2.6,
} as const;

/**
 * Modern-era clothing. Moves into eras/modern.ts in M5.
 *
 * Deliberately light: a figure is 1.7 m tall, which is five to eight pixels
 * from the roof band, and the streets it walks on are dark. Mid-tones vanish.
 */
const CLOTHES: readonly number[] = [
  0xd8dce2, 0xc9bfb2, 0xa9bac6, 0xd08a6e, 0x9aa6b2, 0xe0cfa4, 0xb6a9c2, 0xc3cbb4,
];

export interface PeopleStats {
  updateMs: number;
  outside: number;
  walking: number;
  drawn: number;
}

export interface People {
  group: Group;
  count: number;
  stats: PeopleStats;
  update: (dtS: number, hourOfDay: number, view: ViewState) => void;
}

export interface PeopleOptions {
  rng: Rng;
  graph: RoadGraph;
  lots: readonly Lot[];
  byUse: Record<LotUse, number[]>;
  lotNodes: Int32Array;
  lotIndex: LotIndex;
  wanted: number;
}

export function createPeople(options: PeopleOptions): People {
  const { rng, graph, lots, byUse, lotNodes, lotIndex } = options;

  const pool = createAgentPool(Math.min(options.wanted, POOL.maxPeople));
  populate(rng, pool, {
    lots,
    byUse,
    lotIndex,
    clothesCount: CLOTHES.length,
    wanted: options.wanted,
  });

  const palette = paletteToLinear(CLOTHES);
  const group = new Group();
  group.name = 'people';

  const figures = new InstancedMesh(figureGeometry(), createInstanceColorMaterial(), PEOPLE.maxFigures);
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

  const dotPositions = new Float32Array(pool.capacity * 3);
  const dotGeometry = new BufferGeometry();
  const dotAttribute = new BufferAttribute(dotPositions, 3);
  dotAttribute.setUsage(DynamicDrawUsage);
  dotGeometry.setAttribute('position', dotAttribute);
  dotGeometry.setDrawRange(0, 0);
  const dots = new Points(
    dotGeometry,
    new PointsMaterial({
      color: new Color(0xd2cdc2),
      size: PEOPLE.dotSizePx,
      sizeAttenuation: false,
    }),
  );
  dots.name = 'people-dots';
  dots.frustumCulled = false;
  group.add(dots);

  const stats: PeopleStats = { updateMs: 0, outside: 0, walking: 0, drawn: 0 };
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
      // Through the door and out of sight until the schedule sends them out.
      pool.state[index] = STATE.inside;
      placeAgent(pool, index, lot.x, lot.z);
      return;
    }
    const phase = pool.phase[index] ?? 0;
    const spread = use === 'park' ? PEOPLE.spread.park : use === 'market' ? PEOPLE.spread.market : PEOPLE.spread.temple;
    const reach = spread * Math.min(lot.wM, lot.dM) * (0.35 + 0.65 * fract(phase * 5.31));
    placeAgent(pool, index, lot.x + Math.cos(phase) * reach, lot.z + Math.sin(phase) * reach);
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
    const radiusSquared = AGENTS.drawRadiusM * AGENTS.drawRadiusM;
    let slot = 0;
    for (let i = 0; i < pool.count && slot < PEOPLE.maxFigures; i++) {
      const state = pool.state[i] ?? 0;
      if (state === STATE.inside) continue;
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
      writeInstanceMatrix(figureMatrices, slot, x, bob, z, -(pool.heading[i] ?? 0), 1, scaleY, 1);

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
      if ((pool.state[i] ?? 0) === STATE.inside) continue;
      dotPositions[written * 3] = agentX(pool, i);
      dotPositions[written * 3 + 1] = 1;
      dotPositions[written * 3 + 2] = agentZ(pool, i);
      written++;
    }
    dotGeometry.setDrawRange(0, written);
    dotAttribute.needsUpdate = true;
    stats.drawn = written;
  }

  return {
    group,
    count: pool.count,
    stats,
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
function figureGeometry(): BufferGeometry {
  const legs = new BoxGeometry(0.3, 0.8, 0.42);
  legs.translate(0, 0.4, 0);
  const body = new BoxGeometry(0.34, 0.62, 0.5);
  body.translate(0, 1.11, 0);
  const head = new BoxGeometry(0.26, 0.28, 0.26);
  head.translate(0, 1.56, 0);
  const merged = mergeGeometries([legs, body, head]);
  if (!merged) throw new Error('could not merge the figure geometry');
  return merged;
}

function fract(value: number): number {
  return value - Math.floor(value);
}
