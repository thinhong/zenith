import { PATHS } from '@/agents/paths';
import {
  desiredUse,
  destinationIndex,
  isIndoors,
  pickRole,
  roleAt,
  roleIndex,
  type Destination,
} from '@/agents/schedule';
import { buildWorkplaces, nearestWithRoom, WORK } from '@/agents/workplaces';
import { OUTDOOR_SPREAD, spotInside, spotOutside } from '@/world/interior';
import type { Lot, LotIndex, LotUse } from '@/world/lots';
import { range, type Rng } from '@/world/seed';

/**
 * Every person and every vehicle lives in flat typed arrays, not in objects:
 * four thousand little objects would cost more in garbage collection than the
 * whole simulation budget (PLAN.md 3.1). Pure module, no three.js.
 */
export const POOL = {
  /**
   * A settlement of 0.66 km2 with two thousand buildings had four thousand
   * people in it, which is two per building over nine floors. Opening one
   * showed an empty office, because it genuinely was empty. A town has to be
   * crowded before watching anybody in it means anything.
   */
  maxPeople: 14000,
  maxVehicles: 800,
  maxWaypoints: PATHS.maxWaypoints,
  /** How many people share one home lot, at most. */
  perHomeLot: 14,
  walkSpeedMS: { min: 1.2, max: 1.6 },
  /** Distance from the road centreline that people walk at, in metres. */
  pavementM: { min: 4.5, max: 6.5 },
} as const;

export const STATE = {
  /** Inside a building. Still simulated, not drawn. */
  inside: 0,
  walking: 1,
  standing: 2,
  sitting: 3,
} as const;

export type AgentState = (typeof STATE)[keyof typeof STATE];

export interface AgentPool {
  capacity: number;
  count: number;
  /** x, y, z per agent, interleaved so a Points object can read it straight. */
  position: Float32Array;
  heading: Float32Array;
  speedMS: Float32Array;
  state: Uint8Array;
  role: Uint8Array;
  homeLot: Uint16Array;
  workLot: Uint16Array;
  targetLot: Uint16Array;
  /** Where the agent currently is, or is on its way to. See DESTINATIONS. */
  currentUse: Uint8Array;
  pathX: Float32Array;
  pathZ: Float32Array;
  pathCount: Uint8Array;
  pathIndex: Uint8Array;
  /** How far along the current segment, in metres. */
  segmentM: Float32Array;
  laneM: Float32Array;
  clothes: Uint8Array;
  hourOffset: Float32Array;
  /** Seconds until this agent next thinks about where it should be. */
  thinkS: Float32Array;
  /** Phase of the walking bob, so the crowd does not bounce in unison. */
  phase: Float32Array;
  /** Which floor an indoor person is on. Ground is 0. */
  storey: Uint8Array;
}

export function createAgentPool(capacity: number): AgentPool {
  return {
    capacity,
    count: 0,
    position: new Float32Array(capacity * 3),
    heading: new Float32Array(capacity),
    speedMS: new Float32Array(capacity),
    state: new Uint8Array(capacity),
    role: new Uint8Array(capacity),
    homeLot: new Uint16Array(capacity),
    workLot: new Uint16Array(capacity),
    targetLot: new Uint16Array(capacity),
    currentUse: new Uint8Array(capacity),
    pathX: new Float32Array(capacity * POOL.maxWaypoints),
    pathZ: new Float32Array(capacity * POOL.maxWaypoints),
    pathCount: new Uint8Array(capacity),
    pathIndex: new Uint8Array(capacity),
    segmentM: new Float32Array(capacity),
    laneM: new Float32Array(capacity),
    clothes: new Uint8Array(capacity),
    hourOffset: new Float32Array(capacity),
    storey: new Uint8Array(capacity),
    thinkS: new Float32Array(capacity),
    phase: new Float32Array(capacity),
  };
}

export interface PopulateOptions {
  lots: readonly Lot[];
  byUse: Record<LotUse, number[]>;
  lotIndex: LotIndex;
  clothesCount: number;
  /** How many people to place, before the home-lot limit is applied. */
  wanted: number;
  /** The hour the world opens at, so nobody starts the day in the wrong place. */
  startHour: number;
}

/**
 * Gives everyone a home, a workplace, a role and a set of clothes, and puts
 * them where their schedule says they should be at the opening hour. Starting
 * everyone at home would mean several minutes of the city walking itself into
 * position before it looked like anything. Returns how many were placed.
 */
export function populate(rng: Rng, pool: AgentPool, options: PopulateOptions): number {
  const homes = options.byUse.home;
  if (homes.length === 0 || options.byUse.work.length === 0) return 0;

  const wanted = Math.min(options.wanted, pool.capacity, homes.length * POOL.perHomeLot);

  // Workplaces are sized before anybody is seated, so the tall building in the
  // middle of town is worth the walk and a shed on the edge fills up and stops
  // taking people (agents/workplaces.ts).
  const places = buildWorkplaces(options.lots, options.byUse.work, wanted * WORK.workingShare);
  if (places.length === 0) return 0;
  const usedDesks = new Array<number>(places.length).fill(0);

  let placed = 0;
  for (let i = 0; i < wanted; i++) {
    const homeLot = homes[Math.floor(rng() * homes.length)];
    if (homeLot === undefined) continue;
    const lot = options.lots[homeLot];
    if (!lot) continue;
    // The nearest workplace with a desk left in it, not simply the nearest. A
    // day lasts fifteen real minutes and people walk at 1.4 m/s, so a commute
    // across the city would never finish (PLAN.md 4.5), but "nearest" alone
    // left the whole centre of town empty.
    const desk = nearestWithRoom(places, usedDesks, lot.x, lot.z);
    const workLot = desk >= 0 ? (places[desk]?.lot ?? -1) : -1;
    if (workLot < 0) continue;
    usedDesks[desk] = (usedDesks[desk] ?? 0) + 1;

    pool.homeLot[placed] = homeLot;
    pool.workLot[placed] = workLot;
    pool.role[placed] = roleIndex(pickRole(rng()));
    pool.clothes[placed] = Math.floor(rng() * options.clothesCount);
    pool.speedMS[placed] = range(rng, POOL.walkSpeedMS.min, POOL.walkSpeedMS.max);
    // A signed lane so the two directions of a street are not on top of each other.
    pool.laneM[placed] = range(rng, POOL.pavementM.min, POOL.pavementM.max);
    // Small personal offsets are what turn one schedule into a commute wave
    // rather than the whole city stepping at once.
    pool.hourOffset[placed] = range(rng, -0.7, 0.7);
    pool.thinkS[placed] = range(rng, 0, 3);
    pool.phase[placed] = range(rng, 0, Math.PI * 2);
    const role = roleAt(pool.role[placed] ?? 0);
    const want = desiredUse(role, options.startHour + (pool.hourOffset[placed] ?? 0));
    const startLot = startingLot(options, want, homeLot, workLot, lot);
    const where = options.lots[startLot] ?? lot;
    pool.targetLot[placed] = startLot;
    pool.currentUse[placed] = destinationIndex(want);
    const indoors = isIndoors(want);
    pool.state[placed] = indoors ? STATE.inside : STATE.standing;
    // A spot and a floor of their own from the first frame. `arrive()` does
    // this when somebody walks in, but most of the town starts the day already
    // indoors and never walks anywhere during a short look, so without it
    // every opened building held one column of people at its centre.
    const phase = pool.phase[placed] ?? 0;
    const spot = indoors
      ? spotInside(where, phase)
      : spotOutside(where, phase, spreadFor(want));
    pool.storey[placed] = spot.storey;
    pool.position[placed * 3] = spot.x;
    pool.position[placed * 3 + 1] = 0;
    pool.position[placed * 3 + 2] = spot.z;
    placed++;
  }
  pool.count = placed;
  return placed;
}

/** How far across an open lot a person of this destination stands. */
function spreadFor(want: Destination): number {
  if (want === 'park') return OUTDOOR_SPREAD.park;
  if (want === 'market') return OUTDOOR_SPREAD.market;
  return OUTDOOR_SPREAD.temple;
}

function startingLot(
  options: PopulateOptions,
  want: Destination,
  homeLot: number,
  workLot: number,
  home: Lot,
): number {
  if (want === 'home') return homeLot;
  if (want === 'work') return workLot;
  const found = options.lotIndex.nearest(want, home.x, home.z);
  return found >= 0 ? found : homeLot;
}

/** Copies a freshly built route into the agent's slice of the path arrays. */
export function setPath(
  pool: AgentPool,
  index: number,
  x: readonly number[],
  z: readonly number[],
): void {
  const base = index * POOL.maxWaypoints;
  const count = Math.min(x.length, z.length, POOL.maxWaypoints);
  for (let i = 0; i < count; i++) {
    pool.pathX[base + i] = x[i] ?? 0;
    pool.pathZ[base + i] = z[i] ?? 0;
  }
  pool.pathCount[index] = count;
  pool.pathIndex[index] = 0;
  pool.segmentM[index] = 0;
}

/**
 * Walks one agent forward by `dtS` seconds and writes its new position and
 * heading. Returns true once it has reached the last waypoint.
 */
export function advanceAgent(pool: AgentPool, index: number, dtS: number): boolean {
  const count = pool.pathCount[index] ?? 0;
  const base = index * POOL.maxWaypoints;
  if (count < 2) return true;

  let remaining = (pool.speedMS[index] ?? 0) * dtS;
  let segment = pool.pathIndex[index] ?? 0;
  let walked = pool.segmentM[index] ?? 0;

  while (segment < count - 1) {
    const ax = pool.pathX[base + segment] ?? 0;
    const az = pool.pathZ[base + segment] ?? 0;
    const bx = pool.pathX[base + segment + 1] ?? 0;
    const bz = pool.pathZ[base + segment + 1] ?? 0;
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-6) {
      segment++;
      walked = 0;
      continue;
    }
    const left = length - walked;
    if (remaining < left) {
      walked += remaining;
      const t = walked / length;
      pool.position[index * 3] = ax + (bx - ax) * t;
      pool.position[index * 3 + 2] = az + (bz - az) * t;
      pool.heading[index] = Math.atan2(bz - az, bx - ax);
      pool.pathIndex[index] = segment;
      pool.segmentM[index] = walked;
      return false;
    }
    remaining -= left;
    segment++;
    walked = 0;
  }

  const lastX = pool.pathX[base + count - 1] ?? 0;
  const lastZ = pool.pathZ[base + count - 1] ?? 0;
  const prevX = pool.pathX[base + count - 2] ?? lastX;
  const prevZ = pool.pathZ[base + count - 2] ?? lastZ;
  pool.position[index * 3] = lastX;
  pool.position[index * 3 + 2] = lastZ;
  if (Math.hypot(lastX - prevX, lastZ - prevZ) > 1e-6) {
    pool.heading[index] = Math.atan2(lastZ - prevZ, lastX - prevX);
  }
  pool.pathIndex[index] = count - 1;
  pool.segmentM[index] = 0;
  return true;
}

/** Where an agent is, for the systems that only need a reading. */
export function agentX(pool: AgentPool, index: number): number {
  return pool.position[index * 3] ?? 0;
}

export function agentZ(pool: AgentPool, index: number): number {
  return pool.position[index * 3 + 2] ?? 0;
}

export function placeAgent(pool: AgentPool, index: number, x: number, z: number): void {
  pool.position[index * 3] = x;
  pool.position[index * 3 + 1] = 0;
  pool.position[index * 3 + 2] = z;
}

export function currentDestination(pool: AgentPool, index: number): Destination {
  const table: readonly Destination[] = ['home', 'work', 'market', 'park', 'temple'];
  return table[pool.currentUse[index] ?? 0] ?? 'home';
}

/** Vehicles do not have errands: they follow the road graph and turn at junctions. */
export interface VehiclePool {
  capacity: number;
  count: number;
  position: Float32Array;
  heading: Float32Array;
  speedMS: Float32Array;
  /** Index into RoadGraph.edges. */
  edge: Int32Array;
  /** How far along that edge, in metres. */
  alongM: Float32Array;
  /** 1 travelling from edge.a to edge.b, -1 the other way. */
  forward: Int8Array;
  laneM: Float32Array;
  /** 0 car, 1 scooter. */
  kind: Uint8Array;
  colour: Uint8Array;
  /** Seconds still to wait at a junction. */
  waitS: Float32Array;
}

export function createVehiclePool(capacity: number): VehiclePool {
  return {
    capacity,
    count: 0,
    position: new Float32Array(capacity * 3),
    heading: new Float32Array(capacity),
    speedMS: new Float32Array(capacity),
    edge: new Int32Array(capacity).fill(-1),
    alongM: new Float32Array(capacity),
    forward: new Int8Array(capacity).fill(1),
    laneM: new Float32Array(capacity),
    kind: new Uint8Array(capacity),
    colour: new Uint8Array(capacity),
    waitS: new Float32Array(capacity),
  };
}
