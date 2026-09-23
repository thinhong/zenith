import type { Structure } from '@/world/eras';
import type { Lot } from '@/world/lots';

/**
 * What a park is made of: grass, the paths across it, and something in the
 * middle that people walk to. A fountain in 2020, a lotus pond in the
 * citadel, a well in Wyrmrest, a long still pool in 2300.
 *
 * A park used to be a bare block of the town's ground with trees on a loose
 * grid, which from the roof band read as a lot nobody had built on yet. Grass
 * alone fixes most of that: a green block among grey ones is a park at any
 * height. The paths and the piece in the middle are for when you come down
 * to it, and they are where the people in the park actually stand about.
 *
 * Pure: lots in, `Structure[]` out. The plan is taken from the lot alone, its
 * size and its own jitter, never from a random stream, so `props.ts` can ask
 * for the same plan and keep its trees off the paths.
 */

export type ParkCentre = 'fountain' | 'pond' | 'well' | 'pool' | 'none';

export interface ParkStyle {
  /** Grass. Empty leaves the ground as it is. */
  lawn: readonly number[];
  path: number;
  centre: ParkCentre;
  /** Rims, basins, the well's wall. */
  stone: number;
  water: number;
  /** Beds of flowers round the middle. Empty for none. */
  flowers: readonly number[];
  bench: number;
}

export const PARKS = {
  /** Grass stops this far inside the lot, clear of the pavement. */
  edgeM: 1.2,
  pathM: 2.4,
  /**
   * Below this on its short side a park is grass and trees, nothing more.
   * The citadel's parks are its garden plots, about fourteen metres across,
   * and they still take a small pond.
   */
  minPlanM: 11,
  /** The round open space in the middle, at most. */
  plazaM: 6,
  /** Bigger than this on its short side, and a path runs round the edge too. */
  loopFromM: 44,
  loopInsetM: 5,
  lawnY: 0.04,
  pathY: 0.07,
  plazaY: 0.08,
  plazaThickM: 0.04,
  /** A plaza smaller than this has no benches round it. */
  benchPlazaM: 4,
  /** The leaves a flower bed is made of, and how many clumps of flowers stand in it. */
  bedLeaf: 0x4a7236,
  clumps: 5,
} as const;

/** A strip of path: centre, length along its turn, width across. */
export interface ParkPath {
  x: number;
  z: number;
  lengthM: number;
  widthM: number;
  /** Structure convention: local +x points along this turn. */
  rotY: number;
}

export interface ParkPlan {
  paths: ParkPath[];
  plaza: { x: number; z: number; radiusM: number } | null;
}

/** The layout of one park, from its size and its jitter alone. */
export function parkPlan(lot: Lot): ParkPlan {
  const lawnW = lot.wM - PARKS.edgeM * 2;
  const lawnD = lot.dM - PARKS.edgeM * 2;
  const shortM = Math.min(lawnW, lawnD);
  if (shortM < PARKS.minPlanM) return { paths: [], plaza: null };

  const paths: ParkPath[] = [];
  if (lot.jitter < 0.5) {
    // A cross, through the middle and out to each side.
    paths.push({ x: lot.x, z: lot.z, lengthM: lawnW, widthM: PARKS.pathM, rotY: 0 });
    paths.push({ x: lot.x, z: lot.z, lengthM: lawnD, widthM: PARKS.pathM, rotY: Math.PI / 2 });
  } else {
    // Corner to corner, which is the way people cut across a square anyway.
    const turn = Math.atan2(lawnD, lawnW);
    const lengthM = Math.hypot(lawnW, lawnD) - PARKS.pathM * 1.5;
    paths.push({ x: lot.x, z: lot.z, lengthM, widthM: PARKS.pathM, rotY: -turn });
    paths.push({ x: lot.x, z: lot.z, lengthM, widthM: PARKS.pathM, rotY: turn });
  }
  if (shortM >= PARKS.loopFromM) {
    const inW = lawnW - PARKS.loopInsetM * 2;
    const inD = lawnD - PARKS.loopInsetM * 2;
    paths.push({ x: lot.x, z: lot.z - inD / 2, lengthM: inW + PARKS.pathM, widthM: PARKS.pathM, rotY: 0 });
    paths.push({ x: lot.x, z: lot.z + inD / 2, lengthM: inW + PARKS.pathM, widthM: PARKS.pathM, rotY: 0 });
    paths.push({ x: lot.x - inW / 2, z: lot.z, lengthM: inD + PARKS.pathM, widthM: PARKS.pathM, rotY: Math.PI / 2 });
    paths.push({ x: lot.x + inW / 2, z: lot.z, lengthM: inD + PARKS.pathM, widthM: PARKS.pathM, rotY: Math.PI / 2 });
  }
  const radiusM = Math.min(PARKS.plazaM, shortM * 0.22);
  return { paths, plaza: { x: lot.x, z: lot.z, radiusM } };
}

/** Whether a point is on a path or in the middle of the park, with `clearM` to spare. */
export function onParkPlan(plan: ParkPlan, x: number, z: number, clearM: number): boolean {
  if (plan.plaza && Math.hypot(x - plan.plaza.x, z - plan.plaza.z) < plan.plaza.radiusM + clearM) return true;
  for (const path of plan.paths) {
    // Into the path's own frame. rotY turns local +x to (cos, -sin).
    const dx = x - path.x;
    const dz = z - path.z;
    const c = Math.cos(path.rotY);
    const s = Math.sin(path.rotY);
    const along = dx * c - dz * s;
    const across = dx * s + dz * c;
    if (Math.abs(along) < path.lengthM / 2 + clearM && Math.abs(across) < path.widthM / 2 + clearM) return true;
  }
  return false;
}

function pick(colours: readonly number[], roll: number): number | undefined {
  if (colours.length === 0) return undefined;
  return colours[Math.min(colours.length - 1, Math.floor(roll * colours.length))];
}

export function buildParks(lots: readonly Lot[], style: ParkStyle): Structure[] {
  const out: Structure[] = [];
  for (const lot of lots) {
    if (lot.use !== 'park' || lot.heightM > 0) continue;
    const lawn = pick(style.lawn, lot.jitter);
    if (lawn !== undefined) {
      out.push(flat(lot.x, lot.z, lot.wM - PARKS.edgeM * 2, lot.dM - PARKS.edgeM * 2, 0, PARKS.lawnY, lawn));
    }
    const plan = parkPlan(lot);
    for (const path of plan.paths) {
      out.push(flat(path.x, path.z, path.lengthM, path.widthM, path.rotY, PARKS.pathY, style.path));
    }
    const plaza = plan.plaza;
    if (!plaza) continue;
    out.push(round(plaza.x, plaza.z, plaza.radiusM, PARKS.plazaY - PARKS.plazaThickM, PARKS.plazaThickM, style.path));
    centrePiece(out, style, plaza.x, plaza.z, plaza.radiusM, lot.jitter);
    beds(out, style, plan, lot.jitter);
    benches(out, style, plaza.x, plaza.z, plaza.radiusM, lot.jitter < 0.5);
  }
  return out;
}

function flat(x: number, z: number, wM: number, dM: number, rotY: number, y: number, colour: number): Structure {
  return { kind: 'flat', x, y, z, wM, hM: 1, dM, rotY, colour };
}

function round(x: number, z: number, radiusM: number, y: number, hM: number, colour: number): Structure {
  return { kind: 'round', x, y, z, wM: radiusM * 2, hM, dM: radiusM * 2, rotY: 0, colour };
}

function box(x: number, y: number, z: number, wM: number, hM: number, dM: number, rotY: number, colour: number): Structure {
  return { kind: 'trim', x, y, z, wM, hM, dM, rotY, colour };
}

/** The thing in the middle. Sized to the plaza, so a small park gets a small one. */
function centrePiece(out: Structure[], style: ParkStyle, x: number, z: number, plazaM: number, jitter: number): void {
  const base = PARKS.plazaY;
  const s = plazaM / PARKS.plazaM;
  switch (style.centre) {
    case 'fountain': {
      // A stone basin with the water standing level with its rim, a column,
      // and a bowl on top of the column with water in that too.
      const basinM = 2.7 * s;
      out.push(round(x, z, basinM, base, 0.5, style.stone));
      out.push(round(x, z, basinM - 0.35, base + 0.5, 0.03, style.water));
      out.push(round(x, z, 0.32 * s, base + 0.5, 1.2, style.stone));
      out.push(round(x, z, 0.9 * s, base + 1.7, 0.18, style.stone));
      out.push(round(x, z, 0.72 * s, base + 1.88, 0.03, style.water));
      return;
    }
    case 'pond': {
      // Square, with a stone kerb and lotus pads lying on the water.
      const wM = 7.4 * s;
      const dM = 5.2 * s;
      out.push({ kind: 'box', x, y: base, z, wM, hM: 0.35, dM, rotY: 0, colour: style.stone });
      out.push(flat(x, z, wM - 0.6, dM - 0.6, 0, base + 0.36, style.water));
      for (let i = 0; i < 6; i++) {
        const t = jitter * 7.3 + i * 2.39;
        const px = x + Math.cos(t) * (wM * 0.3) * ((i % 3) / 3 + 0.35);
        const pz = z + Math.sin(t) * (dM * 0.3) * (((i + 1) % 3) / 3 + 0.35);
        out.push(round(px, pz, 0.34 * s, base + 0.37, 0.02, 0x5e8a4a));
      }
      return;
    }
    case 'well': {
      // A round wall, dark water inside it, two posts and a little roof.
      out.push(round(x, z, 1.05, base, 0.8, style.stone));
      out.push(round(x, z, 0.78, base + 0.8, 0.02, style.water));
      out.push(box(x - 0.95, base + 0.8, z, 0.16, 1.5, 0.16, 0, 0x5a4632));
      out.push(box(x + 0.95, base + 0.8, z, 0.16, 1.5, 0.16, 0, 0x5a4632));
      out.push({ kind: 'gable', x, y: base + 2.3, z, wM: 2.4, hM: 0.7, dM: 1.5, rotY: 0, colour: 0x6b5a44 });
      return;
    }
    case 'pool': {
      // A long still pool with a pale rim, the long way across the park.
      const alongX = jitter < 0.5;
      const lengthM = plazaM * 3.2;
      const widthM = plazaM * 0.9;
      out.push({
        kind: 'box',
        x,
        y: base,
        z,
        wM: alongX ? lengthM : widthM,
        hM: 0.2,
        dM: alongX ? widthM : lengthM,
        rotY: 0,
        colour: style.stone,
      });
      out.push(flat(x, z, (alongX ? lengthM : widthM) - 0.5, (alongX ? widthM : lengthM) - 0.5, 0, base + 0.21, style.water));
      return;
    }
    case 'none':
      return;
  }
}

/**
 * Four beds of flowers in the corners between the paths, just off the plaza.
 * Each is a low mound of leaf with clumps of flowers standing out of it: a
 * bed drawn as one disc of colour read as a counter on a board game.
 */
function beds(out: Structure[], style: ParkStyle, plan: ParkPlan, jitter: number): void {
  const plaza = plan.plaza;
  if (!plaza || style.flowers.length === 0) return;
  const cross = jitter < 0.5;
  const bedM = Math.min(1.3, plaza.radiusM * 0.3);
  for (let i = 0; i < 4; i++) {
    // Between the arms: diagonals for a cross, the axes for an X.
    const angle = (cross ? Math.PI / 4 : 0) + (i * Math.PI) / 2;
    const reachM = plaza.radiusM + bedM + 1.3;
    const x = plaza.x + Math.cos(angle) * reachM;
    const z = plaza.z + Math.sin(angle) * reachM;
    if (onParkPlan({ paths: plan.paths, plaza: null }, x, z, bedM + 0.1)) continue;
    const colour = pick(style.flowers, (jitter * 13.7 + i * 0.29) % 1) ?? 0xffffff;
    out.push(round(x, z, bedM, PARKS.plazaY, 0.2, PARKS.bedLeaf));
    for (let k = 0; k < PARKS.clumps; k++) {
      // A sunflower spiral: even cover with no two clumps in a line.
      const t = (k + 0.5) / PARKS.clumps;
      const spin = k * 2.39996 + jitter * 6.28;
      const r = Math.sqrt(t) * bedM * 0.72;
      out.push(round(x + Math.cos(spin) * r, z + Math.sin(spin) * r, bedM * 0.24, PARKS.plazaY, 0.3, colour));
    }
  }
}

/** Benches round the edge of the plaza, between the paths, facing in. */
function benches(out: Structure[], style: ParkStyle, x: number, z: number, plazaM: number, cross: boolean): void {
  // Round a small plaza there is no room between the benches and the pond.
  if (plazaM < PARKS.benchPlazaM) return;
  for (let i = 0; i < 4; i++) {
    const angle = (cross ? Math.PI / 4 : 0) + (i * Math.PI) / 2;
    const reachM = plazaM - 0.55;
    const bx = x + Math.cos(angle) * reachM;
    const bz = z + Math.sin(angle) * reachM;
    // Seat along the tangent: local +x along the tangent, which is the
    // radius turned a quarter.
    const rotY = -(angle + Math.PI / 2);
    out.push(box(bx, PARKS.plazaY, bz, 1.8, 0.45, 0.5, rotY, style.bench));
    const backX = x + Math.cos(angle) * (reachM + 0.22);
    const backZ = z + Math.sin(angle) * (reachM + 0.22);
    out.push(box(backX, PARKS.plazaY + 0.45, backZ, 1.8, 0.42, 0.08, rotY, style.bench));
  }
}
