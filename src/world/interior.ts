import type { Structure } from '@/world/eras';
import { directionToLocal, orientToFrame, toWorld } from '@/world/frame';
import type { Lot } from '@/world/lots';
import { mulberry32, range } from '@/world/seed';

/**
 * The inside of one building, built when it is opened and thrown away when it
 * is closed.
 *
 * The camera always looks down, so taking the roof off is enough to see in:
 * the walls can stay, and the building reads as a doll's house rather than as
 * a ghost. That is why this replaces the solid box with four thin slabs and a
 * floor per storey, instead of making anything transparent. A transparent town
 * is a soup; an opened one is a section drawing.
 *
 * Only a handful are ever open, so nothing here is budgeted. It is seeded from
 * the lot id, so the same building always has the same rooms in it.
 */

export const INTERIOR = {
  /** Storey height, in metres. Everything inside is spaced by this. */
  floorM: 3.4,
  wallM: 0.28,
  slabM: 0.22,
  /** How far the furniture keeps off the walls. */
  marginM: 0.7,
  /** A stair core, so the storeys are not floating plates. */
  coreM: 1.6,
  maxStoreys: 24,
} as const;

export interface InteriorStyle {
  /** The walls, seen from inside. Paler than the outside. */
  wall: number;
  /** The floor slabs. */
  floor: number;
  /** The stair core. */
  core: number;
  /** Desks, beds, counters, an altar. */
  furniture: readonly number[];
}

/** How many floors a building of this height has. */
export function storeysIn(heightM: number): number {
  return Math.max(1, Math.min(INTERIOR.maxStoreys, Math.floor(heightM / INTERIOR.floorM)));
}

/** The height of the floor a person on this storey stands on. */
export function storeyHeightM(storey: number): number {
  return storey * INTERIOR.floorM;
}

/** Where one person stands inside a building: a spot on a floor of their own. */
export interface Spot {
  x: number;
  z: number;
  storey: number;
}

/**
 * Spreads a person across the inside of their building.
 *
 * Everybody used to be dropped on the exact centre of the lot at ground level,
 * which is invisible until you open the building and find sixty-four people
 * standing inside one another in a column. `arrive()` had its own version of
 * this for people who walk in, but most of the town starts the day already
 * indoors and never walks anywhere during a short look, so the pile was what
 * you actually saw.
 *
 * `phase` is the agent's own constant, so a person keeps the same desk.
 */
export function spotInside(lot: Lot, phase: number): Spot {
  // 0.34 of the full width is 0.68 of the half width, which keeps everybody
  // off the walls without bunching them round the middle.
  const acrossM = lot.wM * 0.34 * (fract(phase * 3.77) * 2 - 1);
  const alongM = lot.dM * 0.34 * (fract(phase * 7.13) * 2 - 1);
  const at = toWorld(lot, acrossM, alongM);
  return {
    x: at.x,
    z: at.z,
    storey: Math.floor(fract(phase * 11.7) * storeysIn(lot.heightM)),
  };
}

/**
 * How far across an open lot people spread once they get there, as a share of
 * its shorter side. A park is somewhere to sit about in; a market is a press
 * round the stalls.
 */
export const OUTDOOR_SPREAD = { market: 0.18, park: 0.38, temple: 0.22 } as const;

/**
 * Where one person stands on an open lot: a market, a park, a temple yard.
 *
 * Same reason as `spotInside`. Everybody who starts the day at a market was
 * being put on its centre point, and in 2300, where the crowd is large and the
 * plots are few, that showed as five thought pills stacked over one spot with
 * a single person under them.
 */
export function spotOutside(lot: Lot, phase: number, spread: number): Spot {
  const reach = spread * Math.min(lot.wM, lot.dM) * (0.35 + 0.65 * fract(phase * 5.31));
  // A disc of spots, so the lot's turn does not matter.
  const spot = { x: lot.x + Math.cos(phase) * reach, z: lot.z + Math.sin(phase) * reach, storey: 0 };
  const ponds = lot.ponds;
  if (!ponds || ponds.length === 0) return spot;
  // Not in the pond: round the disc a step at a time, and failing that out
  // toward the edge of the lot the park is entered by.
  const wet = (x: number, z: number): boolean => ponds.some((pond) => Math.hypot(x - pond.x, z - pond.z) < pond.radiusM + 0.8);
  for (let k = 1; wet(spot.x, spot.z) && k < 12; k++) {
    const angle = phase + k * 2.39996;
    const r = reach * (k < 6 ? 1 : 1.6);
    spot.x = lot.x + Math.cos(angle) * r;
    spot.z = lot.z + Math.sin(angle) * r;
  }
  if (wet(spot.x, spot.z)) {
    const front = toWorld(lot, (fract(phase * 3.7) - 0.5) * lot.wM * 0.6, -lot.dM / 2 + 2.5);
    spot.x = front.x;
    spot.z = front.z;
  }
  return spot;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.floor(roll * colours.length));
  return colours[index] ?? 0x808080;
}

function box(
  x: number,
  y: number,
  z: number,
  wM: number,
  hM: number,
  dM: number,
  colour: number,
): Structure {
  return { kind: 'box', x, y, z, wM, hM, dM, rotY: 0, colour };
}

/**
 * Builds one building's insides, with the two walls nearest the viewer left
 * out.
 *
 * Taking the roof off is not enough on its own: from overhead each floor slab
 * hides the one below it, so an opened tower shows its top storey and nothing
 * else. What a doll's house actually does is take the front wall away, and
 * then the tilt of the camera lets you see into every floor at once. Which two
 * walls are the front ones depends on where the viewer is standing, so
 * `towardX` and `towardZ` are the direction from the building to the camera,
 * and `world.ts` rebuilds these when the view swings far enough round.
 */
export function buildInterior(
  lot: Lot,
  style: InteriorStyle,
  worldTowardX = 0,
  worldTowardZ = 1,
): Structure[] {
  // Built square to the world about the lot's centre, with the viewer's
  // direction brought into the same frame, and turned with the lot at the end.
  const toward = directionToLocal(lot, worldTowardX, worldTowardZ);
  const out = interiorSquare(lot, style, toward.x, toward.z);
  orientToFrame(out, 0, lot);
  return out;
}

function interiorSquare(lot: Lot, style: InteriorStyle, towardX: number, towardZ: number): Structure[] {
  const rng = mulberry32(lot.id * 2654435761 + 17);
  const out: Structure[] = [];
  const storeys = storeysIn(lot.heightM);
  const halfW = lot.wM / 2;
  const halfD = lot.dM / 2;

  // The walls that are left. A wall whose outward normal points at the viewer
  // is the one in the way, so it goes.
  if (towardZ > -0.25) {
    out.push(box(lot.x, 0, lot.z - halfD, lot.wM, lot.heightM, INTERIOR.wallM, style.wall));
  }
  if (towardZ < 0.25) {
    out.push(box(lot.x, 0, lot.z + halfD, lot.wM, lot.heightM, INTERIOR.wallM, style.wall));
  }
  if (towardX > -0.25) {
    out.push(box(lot.x - halfW, 0, lot.z, INTERIOR.wallM, lot.heightM, lot.dM, style.wall));
  }
  if (towardX < 0.25) {
    out.push(box(lot.x + halfW, 0, lot.z, INTERIOR.wallM, lot.heightM, lot.dM, style.wall));
  }

  // A core against the far wall, which is where the stairs and the lift are.
  // Putting it on the side away from the viewer keeps it out of the section.
  const coreSide = towardX > 0 ? -1 : 1;
  const coreX = lot.x + coreSide * (halfW - INTERIOR.coreM / 2 - INTERIOR.wallM);
  out.push(
    box(coreX, 0, lot.z, INTERIOR.coreM, lot.heightM, Math.min(INTERIOR.coreM * 1.4, lot.dM * 0.5), style.core),
  );

  const innerW = lot.wM - INTERIOR.wallM * 2 - INTERIOR.marginM * 2;
  const innerD = lot.dM - INTERIOR.wallM * 2 - INTERIOR.marginM * 2;
  if (innerW <= 0.6 || innerD <= 0.6) return out;

  for (let storey = 0; storey < storeys; storey++) {
    const y = storeyHeightM(storey);
    // The floor itself. The ground one is the building's own footprint.
    out.push(
      box(lot.x, y, lot.z, lot.wM - INTERIOR.wallM, INTERIOR.slabM, lot.dM - INTERIOR.wallM, style.floor),
    );
    furnish(out, rng, lot, style, y + INTERIOR.slabM, innerW, innerD, storey);
  }
  return out;
}

/**
 * What the room is for. An office gets rows of desks, a home gets a bed and a
 * table, a shop gets counters along the wall, a temple gets one altar. None of
 * it is recognisable as an object at this size; what reads is that the floors
 * are not empty and that the pattern changes from one building to the next.
 */
function furnish(
  out: Structure[],
  rng: () => number,
  lot: Lot,
  style: InteriorStyle,
  y: number,
  innerW: number,
  innerD: number,
  storey: number,
): void {
  const x0 = lot.x - innerW / 2;
  const z0 = lot.z - innerD / 2;
  const colour = (): number => pick(style.furniture, rng());

  if (lot.use === 'work') {
    // Rows of desks, on a grid, with a gap for the aisle.
    const stepX = 2.2;
    const stepZ = 3.0;
    const cols = Math.max(1, Math.floor(innerW / stepX));
    const rows = Math.max(1, Math.floor(innerD / stepZ));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() < 0.18) continue;
        out.push(
          box(
            x0 + (c + 0.5) * (innerW / cols),
            y,
            z0 + (r + 0.5) * (innerD / rows),
            1.4,
            0.72,
            0.7,
            colour(),
          ),
        );
      }
    }
    return;
  }

  if (lot.use === 'market') {
    // Counters down two sides, and an island in the middle of the ground floor.
    for (const side of [-1, 1]) {
      out.push(
        box(lot.x + (side * innerW) / 2.6, y, lot.z, Math.min(1.1, innerW * 0.2), 0.95, innerD * 0.8, colour()),
      );
    }
    if (storey === 0 && innerW > 4) {
      out.push(box(lot.x, y, lot.z, innerW * 0.35, 0.9, innerD * 0.3, colour()));
    }
    return;
  }

  if (lot.use === 'temple') {
    out.push(box(lot.x, y, lot.z - innerD * 0.3, innerW * 0.5, 1.2, innerD * 0.22, colour()));
    for (let i = 0; i < 3; i++) {
      out.push(box(lot.x, y, lot.z + innerD * (0.05 + i * 0.16), innerW * 0.62, 0.45, 0.4, colour()));
    }
    return;
  }

  // A home: a bed against one wall, a table, and something soft by the other.
  out.push(
    box(
      x0 + Math.min(1.1, innerW * 0.3),
      y,
      z0 + Math.min(1.1, innerD * 0.3),
      Math.min(2.0, innerW * 0.55),
      0.5,
      Math.min(1.5, innerD * 0.45),
      colour(),
    ),
  );
  out.push(
    box(
      lot.x + range(rng, -innerW * 0.2, innerW * 0.2),
      y,
      lot.z + innerD * 0.22,
      Math.min(1.3, innerW * 0.4),
      0.74,
      Math.min(0.9, innerD * 0.3),
      colour(),
    ),
  );
  if (innerW > 3.2 && rng() < 0.7) {
    out.push(
      box(lot.x + innerW * 0.26, y, lot.z - innerD * 0.24, Math.min(1.7, innerW * 0.4), 0.6, 0.8, colour()),
    );
  }
}
