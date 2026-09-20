import type { Structure } from '@/world/eras';
import type { Lot } from '@/world/lots';
import { range, type Rng } from '@/world/seed';

/**
 * What sits on top of a building, and what sticks out of the side of it.
 *
 * A city seen from above is mostly roofs, so a world of flat-topped boxes has
 * no silhouette at all: it reads as a bar chart. This turns each lot into a
 * few extra pieces. A house gets a ridged roof. A shop gets a flat deck inside
 * its own parapet, with a stair housing and a water tank on it. A tower gets a
 * stepped crown and sometimes a mast. Some low buildings grow a lower wing, so
 * the footprint is not always one rectangle.
 *
 * Everything here is pure: lots in, `Structure[]` out, drawn by
 * `world/structures.ts` as one instanced mesh per shape. It is tested without
 * a GPU (AGENTS.md 1).
 */

export interface RoofStyle {
  /** Pitched roofs. */
  tile: readonly number[];
  /** Roofs for a temple or a hall, which is never given an ordinary tile. */
  grandTile: readonly number[];
  /** The flat deck inside a parapet. Darker than the walls, as tar is. */
  deck: readonly number[];
  /** Stair housings, tanks, plant. */
  clutter: readonly number[];
  /** Share of buildings under `pitchedMaxM` that get a ridged roof. */
  pitchedShare: number;
  /** Above this height nothing is pitched. */
  pitchedMaxM: number;
  /** Share of low buildings that grow a lower wing to one side. */
  wingShare: number;
  /** Whether tall buildings get a stepped crown and a mast. */
  crowns: boolean;
  /** Colours for a crown. Close to the walls, not a bright cap. */
  crownTint: readonly number[];
}

const ROOFS = {
  /** Rise of a ridged roof, as a share of the building's short side. */
  pitch: 0.34,
  /** How far the eaves hang past the wall, as a share of the short side. */
  overhang: 0.1,
  /** How far the flat deck sits inside the wall, in metres. */
  parapetM: 0.9,
  /** How far the deck sits below the top of the wall, in metres. */
  parapetDropM: 0.6,
  /** Nothing is cluttered below this footprint, in metres. */
  clutterMinSideM: 9,
  crownFromM: 40,
  /** Share of tall buildings that get one at all. */
  crownShare: 0.55,
  mastShare: 0.22,
} as const;

/** Where a flat roof's deck sits. Never below the ground, however low the wall. */
function roofLevel(heightM: number): number {
  return Math.max(heightM * 0.5, heightM - ROOFS.parapetDropM);
}

/** Picks from a list by a 0..1 roll, so a lot's own jitter can drive it. */
function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.floor(roll * colours.length));
  return colours[index] ?? 0x808080;
}

export function buildRoofscape(rng: Rng, lots: readonly Lot[], style: RoofStyle): Structure[] {
  const out: Structure[] = [];
  for (const lot of lots) {
    if (lot.heightM <= 0) continue;
    const shortM = Math.min(lot.wM, lot.dM);
    const pitched = lot.heightM <= style.pitchedMaxM && rng() < style.pitchedShare;

    if (pitched) {
      ridged(out, lot, style, shortM);
    } else {
      flat(out, rng, lot, style, shortM);
    }

    if (style.crowns && lot.heightM >= ROOFS.crownFromM && rng() < ROOFS.crownShare) {
      crown(out, rng, lot, style);
    }
    if (lot.heightM <= style.pitchedMaxM && rng() < style.wingShare) {
      wing(out, rng, lot, style, pitched, shortM);
    }
  }
  return out;
}

/** A ridge along the long axis, with the eaves hanging past the walls. */
function ridged(out: Structure[], lot: Lot, style: RoofStyle, shortM: number): void {
  const alongX = lot.wM >= lot.dM;
  const grow = shortM * ROOFS.overhang * 2;
  out.push({
    kind: 'gable',
    x: lot.x,
    y: lot.heightM,
    z: lot.z,
    wM: (alongX ? lot.wM : lot.dM) + grow,
    hM: shortM * ROOFS.pitch,
    dM: shortM + grow,
    rotY: alongX ? 0 : Math.PI / 2,
    colour: pick(lot.use === 'temple' ? style.grandTile : style.tile, lot.jitter),
  });
}

/**
 * A deck set inside the walls and a little below them, so the wall itself
 * becomes the parapet. That thin bright rim around a darker deck is most of
 * what makes a flat roof read as a roof rather than as the top of a block.
 */
function flat(out: Structure[], rng: Rng, lot: Lot, style: RoofStyle, shortM: number): void {
  const inset = Math.min(ROOFS.parapetM, shortM * 0.16);
  // A building shorter than the parapet would otherwise put its deck, its
  // stair housing and its tank below the ground.
  const deckY = roofLevel(lot.heightM);
  out.push({
    kind: 'flat',
    x: lot.x,
    y: deckY,
    z: lot.z,
    wM: lot.wM - inset * 2,
    hM: 1,
    dM: lot.dM - inset * 2,
    rotY: 0,
    colour: pick(style.deck, lot.jitter),
  });
  if (shortM < ROOFS.clutterMinSideM) return;

  // A stair housing, off to one side rather than in the middle.
  const spanX = (lot.wM - inset * 2) / 2 - 2.2;
  const spanZ = (lot.dM - inset * 2) / 2 - 2.2;
  const housingW = range(rng, 2.4, 4.2);
  out.push({
    kind: 'box',
    x: lot.x + range(rng, -spanX, spanX),
    y: deckY,
    z: lot.z + range(rng, -spanZ, spanZ),
    wM: housingW,
    hM: range(rng, 1.8, 2.8),
    dM: housingW * range(rng, 0.7, 1.3),
    rotY: 0,
    colour: pick(style.clutter, rng()),
  });
  // A water tank on legs, which is what a roofline in this part of the world
  // actually looks like.
  if (rng() < 0.55) {
    const radius = range(rng, 0.7, 1.2);
    out.push({
      kind: 'tank',
      x: lot.x + range(rng, -spanX, spanX),
      y: deckY + 0.8,
      z: lot.z + range(rng, -spanZ, spanZ),
      wM: radius * 2,
      hM: range(rng, 1.4, 2.2),
      dM: radius * 2,
      rotY: 0,
      colour: pick(style.clutter, rng()),
    });
  }
}

/**
 * A plant room on the roof, and sometimes a second step or a mast.
 *
 * It is pushed off centre on purpose. Centred and concentric, a crown reads as
 * a picture frame drawn on every tower, and a skyline of them looks stamped.
 */
function crown(out: Structure[], rng: Rng, lot: Lot, style: RoofStyle): void {
  const base = roofLevel(lot.heightM);
  const share = range(rng, 0.2, 0.42);
  const wM = lot.wM * share;
  const dM = lot.dM * share;
  const x = lot.x + range(rng, -1, 1) * (lot.wM - wM) * 0.3;
  const z = lot.z + range(rng, -1, 1) * (lot.dM - dM) * 0.3;
  const first = range(rng, 2.2, 4);
  out.push({
    kind: 'box',
    x,
    y: base,
    z,
    wM,
    hM: first,
    dM,
    rotY: 0,
    colour: pick(style.crownTint, lot.jitter),
  });
  // Only some go up a second time, or the skyline steps in unison.
  if (rng() < 0.3) {
    out.push({
      kind: 'box',
      x,
      y: base + first,
      z,
      wM: wM * range(rng, 0.45, 0.7),
      hM: range(rng, 1.8, 3.2),
      dM: dM * range(rng, 0.45, 0.7),
      rotY: 0,
      colour: pick(style.crownTint, 1 - lot.jitter),
    });
  }
  if (rng() < ROOFS.mastShare) {
    out.push({
      kind: 'box',
      x,
      y: base + first,
      z,
      wM: 0.45,
      hM: range(rng, 6, 14),
      dM: 0.45,
      rotY: 0,
      colour: pick(style.crownTint, 0.99),
    });
  }
}

/**
 * A lower piece attached to one side, so the footprint is an L rather than a
 * rectangle. It takes its own roof, matching the one on the main building.
 */
function wing(
  out: Structure[],
  rng: Rng,
  lot: Lot,
  style: RoofStyle,
  pitched: boolean,
  shortM: number,
): void {
  const alongX = lot.wM >= lot.dM;
  const side = rng() < 0.5 ? -1 : 1;
  const wingW = alongX ? lot.wM * range(rng, 0.3, 0.55) : shortM * range(rng, 0.55, 0.9);
  const wingD = alongX ? shortM * range(rng, 0.55, 0.9) : lot.dM * range(rng, 0.3, 0.55);
  const heightM = Math.max(2, lot.heightM * range(rng, 0.5, 0.78));
  const x = alongX ? lot.x + range(rng, -lot.wM / 4, lot.wM / 4) : lot.x + (side * (lot.wM + wingW)) / 2;
  const z = alongX ? lot.z + (side * (lot.dM + wingD)) / 2 : lot.z + range(rng, -lot.dM / 4, lot.dM / 4);

  out.push({
    kind: 'box',
    x,
    y: 0,
    z,
    wM: wingW,
    hM: heightM,
    dM: wingD,
    rotY: 0,
    colour: pick(style.deck, lot.jitter),
  });
  const wingShort = Math.min(wingW, wingD);
  if (pitched) {
    out.push({
      kind: 'gable',
      x,
      y: heightM,
      z,
      wM: (wingW >= wingD ? wingW : wingD) + wingShort * ROOFS.overhang * 2,
      hM: wingShort * ROOFS.pitch,
      dM: wingShort * (1 + ROOFS.overhang * 2),
      rotY: wingW >= wingD ? 0 : Math.PI / 2,
      colour: pick(style.tile, lot.jitter),
    });
  }
}
