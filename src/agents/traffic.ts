import { BoxGeometry, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Points, PointsMaterial } from 'three';
import type { ViewState } from '@/core/camera';
import { AGENTS } from '@/state/altitude';
import { createVehiclePool, POOL, type VehiclePool } from '@/agents/pool';
import {
  attachInstanceColors,
  createInstanceColorMaterial,
  markColorsChanged,
  markDynamic,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';
import { LAYER_Y } from '@/world/ground';
import type { RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * Cars and scooters. Vehicles have no errands: they run along the road graph
 * and take a turn at each junction, which from above is indistinguishable from
 * traffic with somewhere to be, and costs no pathfinding.
 *
 * How many are out varies with the hour, so the morning and evening waves show
 * on the roads as well as on the pavements.
 */
const TRAFFIC = {
  /** Share of the fleet that is a scooter. This is Vietnam (PLAN.md M2 task 6). */
  scooterShare: 0.66,
  carSpeedMS: { min: 9, max: 14 },
  scooterSpeedMS: { min: 8, max: 13 },
  /** Fraction of the road half-width a vehicle drives at, right of the centre. */
  laneFraction: 0.26,
  junctionWaitS: { min: 0.15, max: 1.1 },
  car: { lengthM: 4.4, heightM: 1.5, widthM: 1.8 },
  scooter: { lengthM: 1.9, heightM: 1.15, widthM: 0.7 },
  dotSizePx: 2.2,
} as const;

/** Modern-era paintwork. Moves into eras/modern.ts in M5. */
const CAR_COLORS: readonly number[] = [0xd6d2c8, 0xb8bcc2, 0x8e97a3, 0xc9b9a6, 0x7a8a93, 0xa8564a];
const SCOOTER_COLORS: readonly number[] = [0x6e757d, 0x8a7f72, 0x5a6169, 0x9c8f7e];

export interface TrafficStats {
  updateMs: number;
  active: number;
}

export interface Traffic {
  group: Group;
  stats: TrafficStats;
  update: (dtS: number, hourOfDay: number, view: ViewState) => void;
}

export interface TrafficOptions {
  rng: Rng;
  graph: RoadGraph;
  wanted: number;
}

/** How busy the roads are at a given hour, 0 to 1. Pure, so it can be tested. */
export function trafficLoad(hourOfDay: number): number {
  const stops = [
    { hour: 0, load: 0.16 },
    { hour: 5, load: 0.2 },
    { hour: 7, load: 0.85 },
    { hour: 8.5, load: 1 },
    { hour: 10, load: 0.6 },
    { hour: 12, load: 0.7 },
    { hour: 15, load: 0.62 },
    { hour: 17, load: 0.95 },
    { hour: 18.5, load: 1 },
    { hour: 20, load: 0.58 },
    { hour: 22, load: 0.32 },
    { hour: 24, load: 0.16 },
  ];
  const hour = Math.min(24, Math.max(0, hourOfDay));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (!a || !b || hour < a.hour || hour > b.hour) continue;
    const span = b.hour - a.hour;
    const t = span > 0 ? (hour - a.hour) / span : 0;
    return a.load + (b.load - a.load) * t;
  }
  return stops[0]?.load ?? 0.2;
}

/**
 * Which way to go on leaving a junction. Turning back the way it came is a last
 * resort, so traffic flows through rather than bouncing off dead ends.
 */
export function pickNextEdge(
  graph: RoadGraph,
  nodeId: number,
  currentEdge: number,
  roll: number,
): number {
  const options = graph.adjacency[nodeId] ?? [];
  const onward: number[] = [];
  for (const index of options) if (index !== currentEdge) onward.push(index);
  const choices = onward.length > 0 ? onward : options;
  if (choices.length === 0) return currentEdge;
  const pick = Math.min(choices.length - 1, Math.floor(Math.min(0.999999, Math.max(0, roll)) * choices.length));
  return choices[pick] ?? currentEdge;
}

export function createTraffic(options: TrafficOptions): Traffic {
  const { rng, graph } = options;
  const pool = createVehiclePool(Math.min(options.wanted, POOL.maxVehicles));
  const carPalette = paletteToLinear(CAR_COLORS);
  const scooterPalette = paletteToLinear(SCOOTER_COLORS);

  spawn(rng, pool, graph);

  let cars = 0;
  for (let i = 0; i < pool.count; i++) if ((pool.kind[i] ?? 0) === 0) cars++;
  const scooters = pool.count - cars;

  const group = new Group();
  group.name = 'traffic';

  const carMesh = boxMesh(TRAFFIC.car, Math.max(cars, 1), 'traffic-cars');
  const scooterMesh = boxMesh(TRAFFIC.scooter, Math.max(scooters, 1), 'traffic-scooters');
  const carColors = attachInstanceColors(carMesh, Math.max(cars, 1));
  const scooterColors = attachInstanceColors(scooterMesh, Math.max(scooters, 1));
  const carMatrices = carMesh.instanceMatrix.array as Float32Array;
  const scooterMatrices = scooterMesh.instanceMatrix.array as Float32Array;
  group.add(carMesh, scooterMesh);

  const dotPositions = new Float32Array(pool.capacity * 3);
  const dotGeometry = new BufferGeometry();
  const dotAttribute = new BufferAttribute(dotPositions, 3);
  dotAttribute.setUsage(DynamicDrawUsage);
  dotGeometry.setAttribute('position', dotAttribute);
  dotGeometry.setDrawRange(0, 0);
  const dots = new Points(
    dotGeometry,
    new PointsMaterial({ color: new Color(0xbdb8ae), size: TRAFFIC.dotSizePx, sizeAttenuation: false }),
  );
  dots.name = 'traffic-dots';
  dots.frustumCulled = false;
  group.add(dots);

  const stats: TrafficStats = { updateMs: 0, active: 0 };

  function drive(index: number, dtS: number): void {
    const wait = pool.waitS[index] ?? 0;
    if (wait > 0) {
      pool.waitS[index] = wait - dtS;
      return;
    }
    const edgeIndex = pool.edge[index] ?? -1;
    const edge = graph.edges[edgeIndex];
    if (!edge) return;
    const forward = (pool.forward[index] ?? 1) === 1;
    const from = graph.nodes[forward ? edge.a : edge.b];
    const to = graph.nodes[forward ? edge.b : edge.a];
    if (!from || !to) return;

    let along = (pool.alongM[index] ?? 0) + (pool.speedMS[index] ?? 0) * dtS;
    if (along >= edge.lengthM) {
      const arrivedAt = forward ? edge.b : edge.a;
      const next = pickNextEdge(graph, arrivedAt, edgeIndex, rng());
      const nextEdge = graph.edges[next];
      pool.edge[index] = next;
      pool.forward[index] = nextEdge && nextEdge.a === arrivedAt ? 1 : -1;
      pool.alongM[index] = 0;
      pool.waitS[index] = range(rng, TRAFFIC.junctionWaitS.min, TRAFFIC.junctionWaitS.max);
      along = 0;
      return;
    }
    pool.alongM[index] = along;

    const dx = (to.x - from.x) / edge.lengthM;
    const dz = (to.z - from.z) / edge.lengthM;
    const lane = edge.widthM * TRAFFIC.laneFraction;
    // Right of travel, so the two directions do not drive through each other.
    pool.position[index * 3] = from.x + dx * along - dz * lane;
    pool.position[index * 3 + 2] = from.z + dz * along + dx * lane;
    pool.heading[index] = Math.atan2(dz, dx);
  }

  return {
    group,
    stats,
    update: (dtS, hourOfDay, view) => {
      const started = performance.now();
      const active = Math.min(pool.count, Math.round(pool.count * trafficLoad(hourOfDay)));
      for (let i = 0; i < active; i++) drive(i, dtS);
      stats.active = active;

      const boxes = view.altitudeM < AGENTS.vehiclesMaxM;
      const asDots = !boxes && view.altitudeM < AGENTS.vehicleDotsMaxM;
      carMesh.visible = boxes;
      scooterMesh.visible = boxes;
      dots.visible = asDots;

      if (boxes) {
        let carSlot = 0;
        let scooterSlot = 0;
        for (let i = 0; i < active; i++) {
          const x = pool.position[i * 3] ?? 0;
          const z = pool.position[i * 3 + 2] ?? 0;
          const heading = -(pool.heading[i] ?? 0);
          const colour = pool.colour[i] ?? 0;
          if ((pool.kind[i] ?? 0) === 0) {
            writeInstanceMatrix(carMatrices, carSlot, x, LAYER_Y.road + TRAFFIC.car.heightM / 2, z, heading, 1, 1, 1);
            copyColor(carColors, carSlot, carPalette, colour);
            carSlot++;
          } else {
            writeInstanceMatrix(scooterMatrices, scooterSlot, x, LAYER_Y.road + TRAFFIC.scooter.heightM / 2, z, heading, 1, 1, 1);
            copyColor(scooterColors, scooterSlot, scooterPalette, colour);
            scooterSlot++;
          }
        }
        carMesh.count = carSlot;
        scooterMesh.count = scooterSlot;
        carMesh.instanceMatrix.needsUpdate = true;
        scooterMesh.instanceMatrix.needsUpdate = true;
        markColorsChanged(carMesh);
        markColorsChanged(scooterMesh);
      } else if (asDots) {
        for (let i = 0; i < active; i++) {
          dotPositions[i * 3] = pool.position[i * 3] ?? 0;
          dotPositions[i * 3 + 1] = LAYER_Y.road + 1;
          dotPositions[i * 3 + 2] = pool.position[i * 3 + 2] ?? 0;
        }
        dotGeometry.setDrawRange(0, active);
        dotAttribute.needsUpdate = true;
      }

      stats.updateMs = performance.now() - started;
    },
  };
}

function spawn(rng: Rng, pool: VehiclePool, graph: RoadGraph): void {
  if (graph.edges.length === 0) return;
  for (let i = 0; i < pool.capacity; i++) {
    const edgeIndex = Math.floor(rng() * graph.edges.length);
    const edge = graph.edges[edgeIndex];
    if (!edge) continue;
    const scooter = rng() < TRAFFIC.scooterShare;
    pool.edge[i] = edgeIndex;
    pool.forward[i] = rng() < 0.5 ? 1 : -1;
    pool.alongM[i] = rng() * edge.lengthM;
    pool.kind[i] = scooter ? 1 : 0;
    pool.speedMS[i] = scooter
      ? range(rng, TRAFFIC.scooterSpeedMS.min, TRAFFIC.scooterSpeedMS.max)
      : range(rng, TRAFFIC.carSpeedMS.min, TRAFFIC.carSpeedMS.max);
    pool.colour[i] = Math.floor(rng() * (scooter ? SCOOTER_COLORS.length : CAR_COLORS.length));
    pool.waitS[i] = 0;
  }
  pool.count = pool.capacity;
}

function boxMesh(size: { lengthM: number; heightM: number; widthM: number }, capacity: number, name: string): InstancedMesh {
  // Length along local +x, so the heading turns it the way it is going.
  const geometry = new BoxGeometry(size.lengthM, size.heightM, size.widthM);
  const mesh = new InstancedMesh(geometry, createInstanceColorMaterial(), capacity);
  mesh.name = name;
  mesh.frustumCulled = false;
  markDynamic(mesh);
  return mesh;
}

function copyColor(target: Float32Array, slot: number, palette: Float32Array, index: number): void {
  const source = Math.min(index, Math.floor(palette.length / 3) - 1) * 3;
  target[slot * 3] = palette[source] ?? 0.6;
  target[slot * 3 + 1] = palette[source + 1] ?? 0.6;
  target[slot * 3 + 2] = palette[source + 2] ?? 0.6;
}
