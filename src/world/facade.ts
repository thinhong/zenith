import type { Structure } from '@/world/eras';
import { orientToFrame } from '@/world/frame';
import type { Lot } from '@/world/lots';
import { range, type Rng } from '@/world/seed';

/**
 * What sticks out of the front of a building.
 *
 * The roofscape gave the city a skyline, but from anywhere below the roof band
 * a wall was still one flat rectangle with a window pattern painted on it. A
 * whole built city came to ninety thousand triangles, which is about fifty per
 * building: twelve for the box it is and forty for what sits on top. That is
 * why it read as a bar chart from above and as cardboard from the street.
 *
 * So a building gets depth on its face. A home gets balconies, a tower gets
 * pilasters running up it, and anything at street level gets a shopfront and a
 * canopy over the door. None of it is decoration for its own sake: each one is
 * a horizontal or vertical line that tells you how tall a storey is, which is
 * the thing that makes a building read as a building rather than as a shape.
 *
 * All of it is the `trim` kind, which is drawn in its own instanced mesh so
 * that it could one day be faded out with altitude as one piece. It is drawn
 * at every altitude for now: cutting it changes the average tone of every wall
 * it is on, and `DETAIL` in state/altitude.ts carries the measurement.
 *
 * Pure: lots in, `Structure[]` out, no three.js (AGENTS.md 3).
 */

export interface FacadeStyle {
  /**
   * Balconies. A run along the two long sides of a home, one per storey.
   * `share` is how many homes have them at all: a street where every building
   * has the same balcony reads as one building repeated.
   */
  balcony: {
    share: number;
    /** Storey height to hang them at, in metres. */
    everyM: number;
    /**
     * How many separate balconies to a floor, per side. One long run across
     * the whole wall reads as a car park deck, not as a block of flats: the
     * gaps between them are what say "these are separate homes".
     */
    perFloor: number;
    depthM: number;
    /** Height of the railing above the slab. */
    railM: number;
    colours: readonly number[];
    railColours: readonly number[];
  };
  /**
   * Pilasters: thin vertical ribs running the height of a tall building. The
   * cheapest way to stop a tower being an extruded rectangle, because they
   * catch the light down one side and leave the other in shade.
   */
  pilaster: {
    fromM: number;
    share: number;
    widthM: number;
    depthM: number;
    /** Roughly how far apart, in metres. The count is fitted to the wall. */
    spacingM: number;
    /**
     * How tall a rib may be. Left out, it runs the whole wall, which is what
     * a pilaster on a tower does. 1800 sets it to one storey, because at that
     * scale a rib is a verandah post holding up an eave: running one up
     * fifteen metres of hall reads as fluting on a column, not as a verandah.
     */
    maxHeightM?: number;
    colours: readonly number[];
  };
  /** A shopfront band and a canopy over the door, at the bottom of the wall. */
  shopfront: {
    share: number;
    heightM: number;
    canopyDepthM: number;
    colours: readonly number[];
    canopyColours: readonly number[];
  };
}

const FACADE = {
  /** Nothing is given a balcony below this, in metres. */
  balconyFromM: 7,
  /** Nor above this many, however tall it is: the cost is per storey. */
  maxBalconies: 9,
  /** All the balconies on one wall cover this share of it, gaps excluded. */
  balconyWidth: 0.66,
  balconySlabM: 0.16,
  railThickM: 0.08,
  /** At most this many ribs a side, so a wide tower does not grow a fence. */
  maxPilasters: 7,
  /** A rib stops this far below the top, so it does not fight the crown. */
  pilasterHeadroomM: 0.8,
  /** A shopfront is only worth it on a wall at least this wide. */
  shopfrontMinSideM: 5,
  canopyThickM: 0.18,
  /** How far above the pavement the canopy sits, as a share of the shopfront. */
  canopyAt: 0.78,
} as const;

function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.floor(roll * colours.length));
  return colours[index] ?? 0x9a9a9a;
}

export function buildFacade(rng: Rng, lots: readonly Lot[], style: FacadeStyle): Structure[] {
  const out: Structure[] = [];
  for (const lot of lots) {
    if (lot.heightM <= 0) continue;
    const from = out.length;

    if (
      lot.use === 'home' &&
      lot.heightM >= FACADE.balconyFromM &&
      rng() < style.balcony.share
    ) {
      balconies(out, rng, lot, style);
    }
    if (lot.heightM >= style.pilaster.fromM && rng() < style.pilaster.share) {
      pilasters(out, lot, style);
    }
    if (
      Math.min(lot.wM, lot.dM) >= FACADE.shopfrontMinSideM &&
      lot.heightM > style.shopfront.heightM * 1.6 &&
      rng() < style.shopfront.share
    ) {
      shopfront(out, rng, lot, style);
    }

    orientToFrame(out, from, lot);
    // Everything on a building's face goes away when the building is opened,
    // the same as everything on its roof does.
    for (let i = from; i < out.length; i++) {
      const piece = out[i];
      if (piece) piece.lotId = lot.id;
    }
  }
  return out;
}

/**
 * A slab and a railing on each of the two long sides, one per storey.
 *
 * The two long sides rather than all four because a balcony belongs on the
 * face a building presents, and ringing a block with them makes a wedding
 * cake. They start at the first floor: a balcony at pavement level is a step.
 */
function balconies(out: Structure[], rng: Rng, lot: Lot, style: FacadeStyle): void {
  const { balcony } = style;
  // On a plot along a street the balconies face the street and the back, not
  // the neighbours: a tube house's long walls are party walls.
  const alongX = lot.street === true || lot.wM >= lot.dM;
  const wallM = alongX ? lot.wM : lot.dM;
  const half = (alongX ? lot.dM : lot.wM) / 2;
  const slabColour = pick(balcony.colours, lot.jitter);
  const railColour = pick(balcony.railColours, lot.jitter);
  // A little off centre, so a terrace of houses does not line up exactly.
  const shift = range(rng, -0.06, 0.06) * wallM;

  // The wall's balcony width is shared between the separate balconies on it,
  // and the gaps between them are what make them separate.
  const count = Math.max(1, Math.round(balcony.perFloor));
  const runM = (wallM * FACADE.balconyWidth) / count;
  const floors = Math.min(
    FACADE.maxBalconies,
    Math.floor((lot.heightM - balcony.everyM) / balcony.everyM),
  );

  for (let floor = 1; floor <= floors; floor++) {
    const y = floor * balcony.everyM;
    for (let i = 0; i < count; i++) {
      // Spread across the wall with a gap at each end, so no balcony is left
      // hanging off a corner.
      const t = count === 1 ? 0.5 : (i + 0.5) / count;
      const alongOffset = (t - 0.5) * (wallM - runM) + shift;
      for (const side of [1, -1]) {
        // Half the depth sits proud of the wall, half inside it, so the slab
        // meets the wall rather than floating a hand's width off it.
        const out0 = half + balcony.depthM * 0.5 - 0.06;
        const x = alongX ? lot.x + alongOffset : lot.x + side * out0;
        const z = alongX ? lot.z + side * out0 : lot.z + alongOffset;
        out.push({
          kind: 'trim',
          x,
          y,
          z,
          wM: alongX ? runM : balcony.depthM,
          hM: FACADE.balconySlabM,
          dM: alongX ? balcony.depthM : runM,
          rotY: 0,
          colour: slabColour,
        });
        // The railing sits on the outer lip of the slab, not in its middle.
        const lip = balcony.depthM * 0.5 - FACADE.railThickM;
        out.push({
          kind: 'trim',
          x: alongX ? x : x + side * lip,
          y: y + FACADE.balconySlabM,
          z: alongX ? z + side * lip : z,
          wM: alongX ? runM : FACADE.railThickM,
          hM: balcony.railM,
          dM: alongX ? FACADE.railThickM : runM,
          rotY: 0,
          colour: railColour,
        });
      }
    }
  }
}

/** Thin ribs up all four walls, evenly fitted to each one. */
function pilasters(out: Structure[], lot: Lot, style: FacadeStyle): void {
  const { pilaster } = style;
  const full = Math.max(1, lot.heightM - FACADE.pilasterHeadroomM);
  const hM = pilaster.maxHeightM === undefined ? full : Math.min(full, pilaster.maxHeightM);
  const colour = pick(pilaster.colours, lot.jitter);

  for (const alongX of [true, false]) {
    const runM = alongX ? lot.wM : lot.dM;
    const half = (alongX ? lot.dM : lot.wM) / 2;
    // Fitted to the wall, not spaced from one end, so the gaps are even and
    // the last rib does not fall off the corner.
    const count = Math.min(FACADE.maxPilasters, Math.max(2, Math.round(runM / pilaster.spacingM)));
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      const alongOffset = (t - 0.5) * (runM - pilaster.widthM * 2);
      for (const side of [1, -1]) {
        const outM = half + pilaster.depthM * 0.5 - 0.04;
        out.push({
          kind: 'trim',
          x: alongX ? lot.x + alongOffset : lot.x + side * outM,
          y: 0,
          z: alongX ? lot.z + side * outM : lot.z + alongOffset,
          wM: alongX ? pilaster.widthM : pilaster.depthM,
          hM,
          dM: alongX ? pilaster.depthM : pilaster.widthM,
          rotY: 0,
          colour,
        });
      }
    }
  }
}

/**
 * A band round the bottom of the wall in a different material, and a canopy
 * over the door on the long side. It is what separates the ground floor from
 * the eight above it, and without it every building meets the pavement the
 * same way.
 */
function shopfront(out: Structure[], rng: Rng, lot: Lot, style: FacadeStyle): void {
  const { shopfront: shop } = style;
  const bandColour = pick(shop.colours, lot.jitter);
  // Proud of the wall by a few centimetres: enough for an edge and a shadow.
  const grow = 0.12;
  out.push({
    kind: 'trim',
    x: lot.x,
    y: 0,
    z: lot.z,
    wM: lot.wM + grow,
    hM: shop.heightM,
    dM: lot.dM + grow,
    rotY: 0,
    colour: bandColour,
  });

  // Over the door, which on a plot along a street is on the street side.
  const alongX = lot.street === true || lot.wM >= lot.dM;
  const roll = rng();
  const side = lot.street === true ? -1 : roll < 0.5 ? 1 : -1;
  const half = (alongX ? lot.dM : lot.wM) / 2;
  const outM = half + shop.canopyDepthM * 0.5;
  const runM = (alongX ? lot.wM : lot.dM) * 0.45;
  out.push({
    kind: 'trim',
    x: alongX ? lot.x : lot.x + side * outM,
    y: shop.heightM * FACADE.canopyAt,
    z: alongX ? lot.z + side * outM : lot.z,
    wM: alongX ? runM : shop.canopyDepthM,
    hM: FACADE.canopyThickM,
    dM: alongX ? shop.canopyDepthM : runM,
    rotY: 0,
    colour: pick(shop.canopyColours, lot.jitter),
  });
}
