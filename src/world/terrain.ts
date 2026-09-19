import { range, type Rng } from '@/world/seed';

/**
 * The land Zenith sits on. Pure: plain data in, plain data out, no three.js.
 * The same terrain is shared by every era (PLAN.md 9), so nothing here knows
 * about buildings.
 *
 * All distances are metres from the centre of the world at (0, 0).
 */
export const TERRAIN = {
  /** Flat land. Reaches well past the mountain ring so its rim is lost in fog. */
  groundRadiusM: 4200,
  /** Nothing is built beyond this. */
  cityRadiusM: 1150,
  mountainInnerM: 1500,
  mountainOuterM: 2250,
  /** How far the water reaches past the land, so no open edge is ever visible. */
  waterReachM: 9000,
} as const;

/** The seed decides whether this land has a river through it or a coast beside it. */
export type WaterKind = 'river' | 'coast';

export interface WaterSpec {
  kind: WaterKind;
  /** Unit vector the water runs along. */
  dirX: number;
  dirZ: number;
  /** Unit vector across the water. For a coast the water lies on the positive side. */
  nrmX: number;
  nrmZ: number;
  /** The centreline is sampled along `dir`, starting at `tMinM`, every `tStepM`. */
  tMinM: number;
  tStepM: number;
  /** Lateral offset of the centreline at each sample. */
  offsetsM: readonly number[];
  /** River only: half the width of the channel. 0 for a coast. */
  halfWidthM: number;
}

export interface MountainSpec {
  x: number;
  z: number;
  radiusM: number;
  heightM: number;
}

export interface TerrainSpec {
  groundRadiusM: number;
  cityRadiusM: number;
  water: WaterSpec;
  mountains: readonly MountainSpec[];
}

const TAU = Math.PI * 2;

export function buildTerrain(rng: Rng): TerrainSpec {
  const water = buildWater(rng);
  return {
    groundRadiusM: TERRAIN.groundRadiusM,
    cityRadiusM: TERRAIN.cityRadiusM,
    water,
    mountains: buildMountains(rng, water),
  };
}

function buildWater(rng: Rng): WaterSpec {
  const kind: WaterKind = rng() < 0.5 ? 'river' : 'coast';
  const angle = range(rng, 0, TAU);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);

  // A river crosses somewhere near the middle; a coast sits far enough out that
  // it takes a bite from the disc instead of drowning it. `angle` already covers
  // every orientation, so the offset never needs a random sign.
  const baseOffsetM = kind === 'river' ? range(rng, -430, 430) : range(rng, 470, 1020);

  // Two sine waves give a bank that bends without ever doubling back, which
  // keeps the centreline invertible (see waterDepthAt).
  const a1 = range(rng, 60, 170);
  const k1 = range(rng, 0.0008, 0.0018);
  const p1 = range(rng, 0, TAU);
  const a2 = range(rng, 25, 85);
  const k2 = range(rng, 0.002, 0.004);
  const p2 = range(rng, 0, TAU);

  const tMinM = -TERRAIN.groundRadiusM - 400;
  const tStepM = 200;
  const samples = Math.ceil((-tMinM * 2) / tStepM) + 1;
  const offsetsM: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = tMinM + i * tStepM;
    offsetsM.push(baseOffsetM + a1 * Math.sin(k1 * t + p1) + a2 * Math.sin(k2 * t + p2));
  }

  return {
    kind,
    dirX,
    dirZ,
    nrmX: -dirZ,
    nrmZ: dirX,
    tMinM,
    tStepM,
    offsetsM,
    halfWidthM: kind === 'river' ? range(rng, 45, 95) : 0,
  };
}

function buildMountains(rng: Rng, water: WaterSpec): MountainSpec[] {
  const mountains: MountainSpec[] = [];
  const count = 92;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + range(rng, -0.035, 0.035);
    const r = range(rng, TERRAIN.mountainInnerM, TERRAIN.mountainOuterM);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const radiusM = range(rng, 170, 430);
    // Peaks standing in open water read as a mistake, not as islands.
    if (waterDepthAt(water, x, z) > -radiusM * 0.4) continue;
    mountains.push({ x, z, radiusM, heightM: range(rng, 110, 400) });
  }
  return mountains;
}

/**
 * Positive inside the water, negative on land, and the magnitude is roughly the
 * distance to the bank. Cheap enough to call once per lot and once per road node.
 */
export function waterDepthAt(water: WaterSpec, x: number, z: number): number {
  const along = x * water.dirX + z * water.dirZ;
  const across = x * water.nrmX + z * water.nrmZ;
  const centre = centrelineOffsetAt(water, along);
  return water.kind === 'river'
    ? water.halfWidthM - Math.abs(across - centre)
    : across - centre;
}

export function centrelineOffsetAt(water: WaterSpec, alongM: number): number {
  const f = (alongM - water.tMinM) / water.tStepM;
  const last = water.offsetsM.length - 1;
  if (last < 0) return 0;
  if (f <= 0) return water.offsetsM[0] ?? 0;
  if (f >= last) return water.offsetsM[last] ?? 0;
  const i = Math.floor(f);
  const a = water.offsetsM[i] ?? 0;
  const b = water.offsetsM[i + 1] ?? 0;
  return a + (b - a) * (f - i);
}

/** World position of centreline sample `i`, used to build the water mesh. */
export function centrelinePoint(water: WaterSpec, i: number): { x: number; z: number } {
  const t = water.tMinM + i * water.tStepM;
  const o = water.offsetsM[i] ?? 0;
  return {
    x: water.dirX * t + water.nrmX * o,
    z: water.dirZ * t + water.nrmZ * o,
  };
}

/** Inside the city and far enough from the water to put a road or a building on. */
export function isBuildable(terrain: TerrainSpec, x: number, z: number, marginM = 14): boolean {
  if (Math.hypot(x, z) > terrain.cityRadiusM) return false;
  return waterDepthAt(terrain.water, x, z) < -marginM;
}
