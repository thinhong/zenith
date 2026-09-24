import type { Structure } from '@/world/eras';
import { orientToFrame, toWorld } from '@/world/frame';
import {
  createGridIndex,
  distanceToSegment,
  rectBounds,
  segmentRectDistance,
  type OrientedRect,
} from '@/world/geometry2d';
import type { Lot, LotUse } from '@/world/lots';
import { PAVEMENT_M, type RoadGraph } from '@/world/roads';
import { range, type Rng } from '@/world/seed';

/**
 * What stands on a lot in a garden town (2300): the kinds of house, the
 * market hall and the shrine. Pure: lots and roads in, structures out
 * (AGENTS.md 3).
 *
 * The lot's own box is always there (world/buildings.ts draws it, with its
 * windows); what makes one house unlike the next is what this puts round it.
 *
 * - `garden`: one thin roof reaching past the walls, warm timber under it.
 * - `pavilion`: one storey of dark glass under a roof that reaches far out
 *   over a timber deck, on slender posts. The house in the first reference.
 * - `stacked`: the upper floor is a box of its own in the other material,
 *   cantilevered out over the garden or the side.
 * - `gabled`: a long dark roof with a low pitch and deep eaves.
 * - `court`: two low wings reach back from the house round a court.
 * - `studio`: a workplace under a folded roof, one low ridge a bay.
 * - `hall`: the market, an open timber roof on posts over the stalls.
 * - `shrine`: a low hall on a stone plinth under a deep hipped roof.
 *
 * Every roof reaches out only as far as the neighbours allow, half the gap
 * on each side, so no two ever meet; nothing that stands on the ground
 * (a wing, a plinth) is put where a road or another building is.
 */
export type HouseKind = 'garden' | 'pavilion' | 'stacked' | 'gabled' | 'court' | 'studio' | 'hall' | 'shrine';

export interface HouseStyle {
  /** The colours the lot's own walls are drawn in (EraPalette.building), so an added volume can be set against them. */
  walls: Readonly<Record<LotUse, readonly number[]>>;
  plaster: readonly number[];
  /** Dark boards: a stacked upper floor on a pale house. */
  boards: readonly number[];
  /** Warm timber: the underside of a roof, a deck, a screen. */
  cedar: readonly number[];
  /** Dark glass in dark frames. */
  glass: readonly number[];
  stone: readonly number[];
  post: number;
  roof: {
    dark: readonly number[];
    pale: readonly number[];
    moss: readonly number[];
    paleShare: number;
    mossShare: number;
    thicknessM: number;
  };
  /** A shrine's roof, which is never the houses' metal. */
  shrineRoof: readonly number[];
  /** The market hall's roof: weathered timber. */
  hallRoof: readonly number[];
  /**
   * Shares of each kind of home, for a house of one storey and for one of
   * two. What is left of each are garden houses.
   */
  homes: {
    low: { pavilion: number; gabled: number; court: number };
    tall: { stacked: number; gabled: number; court: number };
  };
  /** Timber slats in front of the glass beside a door. */
  screen: { share: number; spacingM: number };
}

export const HOUSES = {
  /** How far a roof reaches past the walls where nothing stands close. */
  overhangM: 1.25,
  pavilionOverhangM: 2.6,
  /** Nothing reaches closer than this to the half-way line between two buildings. */
  neighbourClearM: 0.1,
  /** Nor nearer the outer edge of a pavement than this. */
  roadClearM: 0.4,
  soffitM: 0.06,
  postM: 0.12,
  /** A pavilion is one storey: no taller than this. */
  pavilionMaxM: 4.6,
  deckM: 0.2,
  deckMaxM: 1.7,
  /** The upper floor of a stacked house starts at this share of its height. */
  stackedFromM: 5.6,
  upperShare: 0.5,
  cantileverM: 2.2,
  upperBandM: 0.9,
  /** Court: wings this wide and at most this long, and the house it needs. */
  wingM: 3.2,
  wingMaxM: 7.5,
  wingMinM: 3.5,
  wingHeightM: 3.4,
  courtMin: [11.5, 9.5] as const,
  gablePitch: 0.3,
  gableEaveM: 1,
  /** Studio: the width of one bay of the folded roof. */
  studioBayM: 4.6,
  studioPitch: 0.34,
  /** Market hall: the roof's height, how far it reaches past the stalls, and the pitch of its posts. */
  hallRoofM: 5.2,
  hallReachM: 2.4,
  hallPostStepM: 4.4,
  hallPitch: 0.26,
  /** Shrine: the plinth's height and how far it runs past the hall, and the roof's reach and pitch. */
  plinthM: 0.7,
  plinthOutM: 2.2,
  shrineReachM: 2.6,
  shrinePitch: 0.42,
  /** A screen: slat width and depth, height, how far out from the glass, and where it starts. */
  slatM: [0.045, 0.09] as const,
  screenHeightM: 2.6,
  screenOutM: 0.42,
  screenFromM: 0.9,
  /** Lots handled between one frame and the next while an era is being built. */
  lotsPerStep: 120,
} as const;

/** Picks from a list by a 0..1 roll. */
function pick(colours: readonly number[], roll: number): number {
  const index = Math.min(colours.length - 1, Math.max(0, Math.floor(roll * colours.length)));
  return colours[index] ?? 0x808080;
}

/** Relative brightness of a colour, 0 to 1: enough to tell a pale wall from a dark one. */
function lightness(colour: number): number {
  return (((colour >> 16) & 255) * 0.3 + ((colour >> 8) & 255) * 0.59 + (colour & 255) * 0.11) / 255;
}

/** What kind of building stands on a lot, from its use, its size and a roll. */
export function houseKind(lot: Lot, style: HouseStyle, roll: number): HouseKind {
  if (lot.use === 'market') return 'hall';
  if (lot.use === 'temple') return 'shrine';
  if (lot.use === 'work') return lot.wM >= HOUSES.studioBayM * 2 ? 'studio' : 'garden';
  const courtFits = lot.wM >= HOUSES.courtMin[0] && lot.dM >= HOUSES.courtMin[1] && lot.street === true;
  let r = roll;
  if (lot.heightM <= HOUSES.pavilionMaxM) {
    const low = style.homes.low;
    if ((r -= low.pavilion) < 0) return 'pavilion';
    if ((r -= low.gabled) < 0) return 'gabled';
    if ((r -= low.court) < 0) return courtFits ? 'court' : 'gabled';
    return 'garden';
  }
  const tall = style.homes.tall;
  if ((r -= tall.stacked) < 0) return lot.heightM >= HOUSES.stackedFromM ? 'stacked' : 'garden';
  if ((r -= tall.gabled) < 0) return 'gabled';
  if ((r -= tall.court) < 0) return courtFits ? 'court' : 'stacked';
  return 'garden';
}

export interface Houses {
  structures: Structure[];
  /** What somebody on foot cannot walk through, besides the lots themselves: wings, plinths, screens. */
  barriers: OrientedRect[];
  /** The kind chosen for each lot, by id. For the tests. */
  kinds: ReadonlyMap<number, HouseKind>;
}

/** Runs a generator of steps to its end, for a caller with no frame to protect. */
function finish<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function buildHouses(rng: Rng, lots: readonly Lot[], roads: RoadGraph, style: HouseStyle): Houses {
  return finish(buildHouseSteps(rng, lots, roads, style));
}

/** The side segments of a lot in the world: front (-z, the street), back, left (-x), right. */
function sidesOf(lot: Lot): readonly (readonly [number, number, number, number])[] {
  const hw = lot.wM / 2;
  const hd = lot.dM / 2;
  const at = (x: number, z: number): { x: number; z: number } => toWorld(lot, x, z);
  const pairs = [
    [at(-hw, -hd), at(hw, -hd)],
    [at(-hw, hd), at(hw, hd)],
    [at(-hw, -hd), at(-hw, hd)],
    [at(hw, -hd), at(hw, hd)],
  ] as const;
  return pairs.map(([a, b]) => [a.x, a.z, b.x, b.z] as const);
}

export function* buildHouseSteps(
  rng: Rng,
  lots: readonly Lot[],
  roads: RoadGraph,
  style: HouseStyle,
): Generator<void, Houses, void> {
  const structures: Structure[] = [];
  const barriers: OrientedRect[] = [];
  const kinds = new Map<number, HouseKind>();
  const built = lots.filter((lot) => lot.heightM > 0);
  const buildingIndex = createGridIndex(24);
  built.forEach((lot, i) => {
    const box = rectBounds(lot);
    buildingIndex.insert(i, box.minX, box.minZ, box.maxX, box.maxZ);
  });
  const roadIndex = createGridIndex(24);
  roads.edges.forEach((edge, i) => {
    const a = roads.nodes[edge.a];
    const b = roads.nodes[edge.b];
    if (!a || !b) return;
    const pad = edge.widthM / 2 + PAVEMENT_M;
    roadIndex.insert(i, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
  });

  /** The free ground beyond one side of a lot: to the nearest other building, and to the nearest pavement's edge. */
  const freeBeyond = (lot: Lot, side: readonly [number, number, number, number], lookM: number) => {
    const [ax, az, bx, bz] = side;
    let building = lookM;
    buildingIndex.query(Math.min(ax, bx) - lookM, Math.min(az, bz) - lookM, Math.max(ax, bx) + lookM, Math.max(az, bz) + lookM, (i) => {
      const other = built[i];
      if (!other || other === lot) return;
      building = Math.min(building, segmentRectDistance(ax, az, bx, bz, other));
    });
    let road = lookM;
    roadIndex.query(Math.min(ax, bx) - lookM, Math.min(az, bz) - lookM, Math.max(ax, bx) + lookM, Math.max(az, bz) + lookM, (i) => {
      const edge = roads.edges[i];
      const a = edge ? roads.nodes[edge.a] : undefined;
      const b = edge ? roads.nodes[edge.b] : undefined;
      if (!edge || !a || !b) return;
      // Nearest approach of two segments: from each end of either to the other.
      const d = Math.min(
        distanceToSegment(ax, az, a.x, a.z, b.x, b.z),
        distanceToSegment(bx, bz, a.x, a.z, b.x, b.z),
        distanceToSegment(a.x, a.z, ax, az, bx, bz),
        distanceToSegment(b.x, b.z, ax, az, bx, bz),
      );
      road = Math.min(road, d - edge.widthM / 2 - PAVEMENT_M);
    });
    return { building, road };
  };

  /** How far a roof may reach past each side: half the gap to a neighbour, clear of the pavement, up to `maxM`. */
  const reachOf = (lot: Lot, maxM: number): [number, number, number, number] => {
    const out = sidesOf(lot).map((side) => {
      const free = freeBeyond(lot, side, maxM * 2 + 1);
      const toNeighbour = free.building / 2 - HOUSES.neighbourClearM;
      const toRoad = free.road - HOUSES.roadClearM;
      return Math.max(0, Math.min(maxM, toNeighbour, toRoad));
    });
    return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
  };

  const roofColour = (lot: Lot, roll: number): number => {
    const r = style.roof;
    if (roll < r.mossShare) return pick(r.moss, (lot.jitter * 3.7) % 1);
    if (roll < r.mossShare + r.paleShare) return pick(r.pale, (lot.jitter * 5.3) % 1);
    return pick(r.dark, (lot.jitter * 7.1) % 1);
  };

  /** A flat roof over a rectangle given in the lot's frame, with warm timber under whatever overhangs. */
  const flatRoof = (
    lot: Lot,
    y: number,
    left: number,
    right: number,
    front: number,
    back: number,
    colour: number,
    soffit: boolean,
  ): void => {
    const w = right - left;
    const d = back - front;
    const cx = lot.x + (left + right) / 2;
    const cz = lot.z + (front + back) / 2;
    structures.push({ kind: 'box', x: cx, y, z: cz, wM: w, hM: style.roof.thicknessM, dM: d, rotY: 0, colour });
    if (soffit) {
      structures.push({
        kind: 'box',
        x: cx,
        y: y - HOUSES.soffitM,
        z: cz,
        wM: w - 0.06,
        hM: HOUSES.soffitM,
        dM: d - 0.06,
        rotY: 0,
        colour: pick(style.cedar, (lot.jitter * 9.1) % 1),
      });
    }
  };

  /** A slender dark post, standing from the ground to `topY`, at (x, z) in the lot's unturned frame. */
  const post = (x: number, z: number, topY: number): void => {
    structures.push({ kind: 'box', x, y: 0, z, wM: HOUSES.postM, hM: topY, dM: HOUSES.postM, rotY: 0, colour: style.post });
  };

  /** Slats in front of the glass beside the door. Returns the barrier they make, in the unturned frame. */
  const screen = (lot: Lot, frontM: number, topM: number): OrientedRect | null => {
    if (frontM < 0.55 || lot.wM < 7 || topM < 3.2 || rng() >= style.screen.share) return null;
    const side = rng() < 0.5 ? -1 : 1;
    const spanM = Math.min(3.4, lot.wM / 2 - 0.3 - HOUSES.screenFromM);
    if (spanM < 1.2) return null;
    const heightM = Math.min(HOUSES.screenHeightM, topM - 0.35);
    const z = lot.z - lot.dM / 2 - HOUSES.screenOutM;
    const colour = pick(style.cedar, rng());
    const count = Math.floor(spanM / style.screen.spacingM) + 1;
    for (let i = 0; i < count; i++) {
      structures.push({
        kind: 'trim',
        x: lot.x + side * (HOUSES.screenFromM + i * style.screen.spacingM),
        y: 0,
        z,
        wM: HOUSES.slatM[0],
        hM: heightM,
        dM: HOUSES.slatM[1],
        rotY: 0,
        colour,
      });
    }
    return {
      x: lot.x + side * (HOUSES.screenFromM + ((count - 1) * style.screen.spacingM) / 2),
      z,
      wM: (count - 1) * style.screen.spacingM + HOUSES.slatM[0],
      dM: HOUSES.slatM[1] + 0.1,
      rotY: 0,
    };
  };

  let done = 0;
  for (const lot of built) {
    if (++done % HOUSES.lotsPerStep === 0) yield;
    const kind = houseKind(lot, style, rng());
    kinds.set(lot.id, kind);
    const from = structures.length;
    const localBarriers: OrientedRect[] = [];
    const W = lot.wM;
    const D = lot.dM;
    const H = lot.heightM;
    const hw = W / 2;
    const hd = D / 2;
    const gardenM = lot.garden?.depthM;
    const wall = pick(style.walls[lot.use] ?? [0xe0e0e0], lot.jitter);
    const paleWall = lightness(wall) > 0.55;

    if (kind === 'pavilion') {
      const [f, b, l, r] = reachOf(lot, HOUSES.pavilionOverhangM);
      const front = gardenM !== undefined ? Math.min(f, gardenM - 0.4) : f;
      // Dark glass all round under the roof: the walls are the view.
      structures.push({ kind: 'trim', x: lot.x, y: 0, z: lot.z, wM: W + 0.1, hM: H - 0.3, dM: D + 0.1, rotY: 0, colour: pick(style.glass, rng()) });
      flatRoof(lot, H, -hw - l, hw + r, -hd - front, hd + b, pick(style.roof.dark, (lot.jitter * 7.1) % 1), true);
      // A timber deck under the deepest part of the roof, and the posts that hold its corners.
      const deckD = Math.min(HOUSES.deckMaxM, front - 0.25);
      if (deckD > 0.6) {
        structures.push({
          kind: 'box',
          x: lot.x,
          y: 0,
          z: lot.z - hd - deckD / 2,
          wM: W,
          hM: HOUSES.deckM,
          dM: deckD,
          rotY: 0,
          colour: pick(style.cedar, rng()),
        });
      }
      if (front > 1.2) {
        post(lot.x - hw - l + 0.3, lot.z - hd - front + 0.3, H);
        post(lot.x + hw + r - 0.3, lot.z - hd - front + 0.3, H);
      }
      if (b > 1.2) {
        post(lot.x - hw - l + 0.3, lot.z + hd + b - 0.3, H);
        post(lot.x + hw + r - 0.3, lot.z + hd + b - 0.3, H);
      }
    } else if (kind === 'stacked') {
      const [f, b, l, r] = reachOf(lot, HOUSES.cantileverM + 0.4);
      const lowerM = H * HOUSES.upperShare;
      // Out over whichever side has the more room, and a little over the garden.
      const toLeft = l > r;
      const out = Math.max(0, Math.min(HOUSES.cantileverM, (toLeft ? l : r) - 0.35)) * range(rng, 0.6, 1);
      const over = Math.max(0, Math.min(1.2, (gardenM !== undefined ? Math.min(f, gardenM - 0.6) : f) - 0.3)) * range(rng, 0.4, 1);
      const left = toLeft ? -hw - out : -hw;
      const right = toLeft ? hw : hw + out;
      const upper = paleWall ? pick(style.boards, rng()) : pick(style.plaster, rng());
      const uw = right - left;
      const ucx = lot.x + (left + right) / 2;
      const ud = D + over;
      const uz = lot.z - over / 2;
      structures.push({ kind: 'box', x: ucx, y: lowerM, z: uz, wM: uw, hM: H - lowerM, dM: ud, rotY: 0, colour: upper });
      // A band of glass across the upper floor's face, and timber under what it holds out.
      structures.push({
        kind: 'trim',
        x: ucx,
        y: lowerM + (H - lowerM) * 0.3,
        z: uz - ud / 2 - 0.03,
        wM: uw * range(rng, 0.45, 0.7),
        hM: HOUSES.upperBandM,
        dM: 0.08,
        rotY: 0,
        colour: pick(style.glass, rng()),
      });
      if (out > 0.3) {
        const sx = toLeft ? lot.x - hw - out / 2 : lot.x + hw + out / 2;
        structures.push({ kind: 'box', x: sx, y: lowerM - HOUSES.soffitM, z: uz, wM: out, hM: HOUSES.soffitM, dM: ud, rotY: 0, colour: pick(style.cedar, rng()) });
      }
      if (over > 0.3) {
        structures.push({ kind: 'box', x: lot.x, y: lowerM - HOUSES.soffitM, z: lot.z - hd - over / 2, wM: W, hM: HOUSES.soffitM, dM: over, rotY: 0, colour: pick(style.cedar, rng()) });
      }
      // A crisp roof, barely past the walls.
      flatRoof(lot, H, left - 0.25, right + 0.25, -hd - over - 0.25, hd + Math.min(0.25, b), roofColour(lot, rng()), false);
    } else if (kind === 'gabled') {
      const [f, b, l, r] = reachOf(lot, HOUSES.gableEaveM);
      const front = gardenM !== undefined ? Math.min(f, gardenM - 0.4) : f;
      const alongX = W >= D;
      const w = W + l + r;
      const d = D + front + b;
      const cx = lot.x + (r - l) / 2;
      const cz = lot.z + (b - front) / 2;
      const shortM = alongX ? d : w;
      structures.push({
        kind: 'gable',
        x: cx,
        y: H,
        z: cz,
        wM: alongX ? w : d,
        hM: shortM * HOUSES.gablePitch,
        dM: alongX ? d : w,
        rotY: alongX ? 0 : Math.PI / 2,
        colour: pick(style.roof.dark, (lot.jitter * 7.1) % 1),
      });
      structures.push({ kind: 'box', x: cx, y: H - HOUSES.soffitM, z: cz, wM: w - 0.08, hM: HOUSES.soffitM, dM: d - 0.08, rotY: 0, colour: pick(style.cedar, rng()) });
    } else if (kind === 'court') {
      const [f, b, l, r] = reachOf(lot, HOUSES.overhangM);
      const behind = freeBeyond(lot, sidesOf(lot)[1] ?? [0, 0, 0, 0], HOUSES.wingMaxM + 3);
      const lengthM = Math.min(HOUSES.wingMaxM, behind.building - 1.2, behind.road - 0.6);
      const front = gardenM !== undefined ? Math.min(f, gardenM - 0.4) : f;
      flatRoof(lot, H, -hw - l, hw + r, -hd - front, hd + Math.min(b, 0.6), roofColour(lot, rng()), true);
      if (lengthM >= HOUSES.wingMinM) {
        const wingH = Math.min(HOUSES.wingHeightM, H);
        const colour = paleWall ? pick(style.plaster, rng()) : pick(style.boards, rng());
        for (const sideX of [-1, 1]) {
          const x = lot.x + sideX * (hw - HOUSES.wingM / 2);
          const z = lot.z + hd + lengthM / 2;
          structures.push({ kind: 'box', x, y: 0, z, wM: HOUSES.wingM, hM: wingH, dM: lengthM, rotY: 0, colour });
          flatRoof(lot, wingH, sideX * (hw - HOUSES.wingM / 2) - HOUSES.wingM / 2 - 0.35, sideX * (hw - HOUSES.wingM / 2) + HOUSES.wingM / 2 + 0.35, hd, hd + lengthM + 0.35, roofColour(lot, rng()), true);
          localBarriers.push({ x, z, wM: HOUSES.wingM, dM: lengthM, rotY: 0 });
        }
        // The court between the wings: gravel.
        structures.push({
          kind: 'flat',
          x: lot.x,
          y: 0.05,
          z: lot.z + hd + lengthM / 2,
          wM: W - HOUSES.wingM * 2,
          hM: 1,
          dM: lengthM,
          rotY: 0,
          colour: pick(style.stone, rng()),
        });
      }
    } else if (kind === 'studio') {
      const [f, b, l, r] = reachOf(lot, 0.6);
      const bays = Math.max(2, Math.round(W / HOUSES.studioBayM));
      const bayW = (W + l + r) / bays;
      const d = D + Math.min(f, 0.6) + b;
      const cz = lot.z + (b - Math.min(f, 0.6)) / 2;
      const colour = pick(style.roof.dark, (lot.jitter * 7.1) % 1);
      for (let i = 0; i < bays; i++) {
        structures.push({
          kind: 'gable',
          x: lot.x - hw - l + bayW * (i + 0.5),
          y: H,
          z: cz,
          wM: d,
          hM: bayW * HOUSES.studioPitch,
          dM: bayW,
          rotY: Math.PI / 2,
          colour,
        });
      }
      structures.push({ kind: 'box', x: lot.x + (r - l) / 2, y: H - HOUSES.soffitM, z: cz, wM: W + l + r - 0.08, hM: HOUSES.soffitM, dM: d - 0.08, rotY: 0, colour: pick(style.cedar, rng()) });
      // A band of glass high under the roof, all round.
      structures.push({ kind: 'trim', x: lot.x, y: H - 1.3, z: lot.z, wM: W + 0.08, hM: 0.9, dM: D + 0.08, rotY: 0, colour: pick(style.glass, rng()) });
    } else if (kind === 'hall') {
      const [f, b, l, r] = reachOf(lot, HOUSES.hallReachM);
      const roofY = Math.max(HOUSES.hallRoofM, H + 0.8);
      const left = -hw - l;
      const right = hw + r;
      const front = -hd - f;
      const back = hd + b;
      const w = right - left;
      const d = back - front;
      const alongX = w >= d;
      const cx = lot.x + (left + right) / 2;
      const cz = lot.z + (front + back) / 2;
      structures.push({
        kind: 'gable',
        x: cx,
        y: roofY,
        z: cz,
        wM: alongX ? w : d,
        hM: (alongX ? d : w) * HOUSES.hallPitch,
        dM: alongX ? d : w,
        rotY: alongX ? 0 : Math.PI / 2,
        colour: pick(style.hallRoof, (lot.jitter * 3.3) % 1),
      });
      structures.push({ kind: 'box', x: cx, y: roofY - HOUSES.soffitM, z: cz, wM: w - 0.08, hM: HOUSES.soffitM, dM: d - 0.08, rotY: 0, colour: pick(style.cedar, rng()) });
      // Posts round the edge of the roof.
      const px = Math.max(1, Math.round((w - 0.6) / HOUSES.hallPostStepM));
      const pz = Math.max(1, Math.round((d - 0.6) / HOUSES.hallPostStepM));
      for (let i = 0; i <= px; i++) {
        const x = cx - (w - 0.6) / 2 + ((w - 0.6) * i) / px;
        post(x, cz - (d - 0.6) / 2, roofY);
        post(x, cz + (d - 0.6) / 2, roofY);
      }
      for (let k = 1; k < pz; k++) {
        const z = cz - (d - 0.6) / 2 + ((d - 0.6) * k) / pz;
        post(cx - (w - 0.6) / 2, z, roofY);
        post(cx + (w - 0.6) / 2, z, roofY);
      }
    } else if (kind === 'shrine') {
      const [f, b, l, r] = reachOf(lot, HOUSES.shrineReachM);
      const out = Math.min(HOUSES.plinthOutM, f - 0.3, b - 0.3, l - 0.3, r - 0.3);
      if (out > 0.4) {
        structures.push({ kind: 'box', x: lot.x, y: 0, z: lot.z, wM: W + out * 2, hM: HOUSES.plinthM, dM: D + out * 2, rotY: 0, colour: pick(style.stone, rng()) });
        localBarriers.push({ x: lot.x, z: lot.z, wM: W + out * 2, dM: D + out * 2, rotY: 0 });
      }
      const reach = Math.min(f, b, l, r);
      const w = W + reach * 2;
      const d = D + reach * 2;
      structures.push({ kind: 'box', x: lot.x, y: H - 0.35, z: lot.z, wM: w - 0.1, hM: 0.35, dM: d - 0.1, rotY: 0, colour: pick(style.cedar, rng()) });
      structures.push({ kind: 'roof', x: lot.x, y: H, z: lot.z, wM: w, hM: Math.min(w, d) * HOUSES.shrinePitch, dM: d, rotY: 0, colour: pick(style.shrineRoof, lot.jitter) });
    } else {
      const [f, b, l, r] = reachOf(lot, HOUSES.overhangM);
      const front = gardenM !== undefined ? Math.min(f, gardenM - 0.6) : f;
      flatRoof(lot, H, -hw - l, hw + r, -hd - front, hd + b, roofColour(lot, rng()), Math.max(front, b, l, r) > 0.2);
    }

    // Slats beside the door of a house with room for them.
    if (lot.use === 'home' && kind !== 'pavilion') {
      const barrier = screen(lot, gardenM ?? 0, Math.min(H, kind === 'stacked' ? H * HOUSES.upperShare : H));
      if (barrier) localBarriers.push(barrier);
    }

    // Laid out square round the lot, then turned with it; all of it goes when the house is opened.
    orientToFrame(structures, from, lot);
    for (let i = from; i < structures.length; i++) {
      const piece = structures[i];
      if (piece) piece.lotId = lot.id;
    }
    for (const rect of localBarriers) {
      const centre = toWorld(lot, rect.x - lot.x, rect.z - lot.z);
      barriers.push({ x: centre.x, z: centre.z, wM: rect.wM, dM: rect.dM, rotY: lot.rotY });
    }
  }
  return { structures, barriers, kinds };
}
