import { range, type Rng } from '@/world/seed';

/**
 * The land Zenith sits on. Pure: plain data in, plain data out, no three.js.
 * The same terrain is shared by every era (PLAN.md 9), so nothing here knows
 * about buildings.
 *
 * All distances are metres from the centre of the world at (0, 0).
 */
export const TERRAIN = {
  /**
   * Flat land. Far wider than anything the viewer can see, so the world never
   * shows an edge: the fog (state/altitude.ts) is what ends it.
   */
  groundRadiusM: 12000,
  /**
   * Nothing is built beyond this. Owner's decision, 20 Sep 2026: one small
   * settlement rather than a city, so that every building can be worth
   * looking at. This used to be 1400 m, which is five times the area, and
   * nothing was ever culled, so the whole of it was drawn every frame and
   * again into the shadow map however little was on screen.
   */
  cityRadiusM: 460,
  mountainInnerM: 760,
  mountainOuterM: 1600,
  /** How far along its own direction the water centreline is generated. */
  waterSpanM: 2400,
  /** How far the water reaches sideways, so no open edge is ever visible. */
  waterReachM: 20000,
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

/**
 * Everything about the water is a fraction of the settlement, never a fixed
 * number of metres. The first version was written in metres against a city of
 * radius 1400, and when the settlement shrank to 460 the same river was still
 * 190 m wide with 250 m meanders: it swallowed the town, six sevenths of the
 * ground stopped being buildable, and one bank ended up with nothing on it.
 */
function buildWater(rng: Rng): WaterSpec {
  const kind: WaterKind = rng() < 0.5 ? 'river' : 'coast';
  const angle = range(rng, 0, TAU);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const r = TERRAIN.cityRadiusM;

  // A river crosses somewhere near the middle; a coast sits far enough out that
  // it takes a bite from the disc instead of drowning it. `angle` already covers
  // every orientation, so the offset never needs a random sign.
  const baseOffsetM = kind === 'river' ? range(rng, -0.31 * r, 0.31 * r) : range(rng, 0.34 * r, 0.73 * r);

  // Two sine waves give a bank that bends without ever doubling back, which
  // keeps the centreline invertible (see waterDepthAt). The wavenumbers are per
  // metre, so they scale the other way: a smaller town wants shorter bends.
  const bend = 1400 / r;
  const a1 = range(rng, 0.043 * r, 0.121 * r);
  const k1 = range(rng, 0.0008 * bend, 0.0018 * bend);
  const p1 = range(rng, 0, TAU);
  const a2 = range(rng, 0.018 * r, 0.061 * r);
  const k2 = range(rng, 0.002 * bend, 0.004 * bend);
  const p2 = range(rng, 0, TAU);

  const tMinM = -TERRAIN.waterSpanM;
  const tStepM = Math.max(25, r / 6);
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
    halfWidthM: kind === 'river' ? range(rng, 0.032 * r, 0.068 * r) : 0,
  };
}

function buildMountains(rng: Rng, water: WaterSpec): MountainSpec[] {
  const mountains: MountainSpec[] = [];
  const r = TERRAIN.cityRadiusM;
  const count = 76;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + range(rng, -0.035, 0.035);
    // How far out this one stands. It used to be called `r` as well, which
    // shadowed the settlement radius above and meant a peak's size was taken
    // from its own distance from the centre: the ones on the outer edge came
    // out five times the volume of the ones on the inner edge, for no reason
    // anybody chose. It is the fault PLAN.md 3.1 warns about, and the unused
    // variable left behind by the shadowing is what gave it away.
    const distanceM = range(rng, TERRAIN.mountainInnerM, TERRAIN.mountainOuterM);
    const x = Math.cos(a) * distanceM;
    const z = Math.sin(a) * distanceM;
    // Fractions of the settlement radius, chosen to land on the same average
    // size the shadowed version happened to produce, so the horizon does not
    // change shape when this is fixed.
    const radiusM = range(rng, 0.36 * r, 0.84 * r);
    // Peaks standing in open water read as a mistake, not as islands.
    if (waterDepthAt(water, x, z) > -radiusM * 0.4) continue;
    mountains.push({ x, z, radiusM, heightM: range(rng, 0.36 * r, 1.28 * r) });
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
