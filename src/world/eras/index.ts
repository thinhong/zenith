import type { ThoughtSet } from '@/thoughts/content';
import type { OrientedRect } from '@/world/geometry2d';
import type { InteriorStyle } from '@/world/interior';
import type { Lot, LotProfile, LotUse } from '@/world/lots';
import type { MarkingStyle } from '@/world/markings';
import type { RoadGraph } from '@/world/roads';
import type { Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';
import { AFTER_ERA } from '@/world/eras/after';
import { CITADEL_ERA } from '@/world/eras/citadel';
import { MYTH_ERA } from '@/world/eras/myth';
import { MODERN_ERA } from '@/world/eras/modern';

/**
 * One era is one layout of the same land (PLAN.md 9). The terrain never
 * changes; the roads, the lots, the colours and what people worry about do.
 */
export type EraId = 'myth' | 'citadel' | 'modern' | 'after';

/**
 * The four in order, oldest first.
 *
 * There were five. 1500 Fields and 1930 Colonial were planned and never
 * built, and on the owner's call (20 Sep 2026) both slots were given up for
 * one world instead: Wyrmrest, a mythic age before any of the others, with
 * magic and monsters in it. Four places that are finished beats five with two
 * dark stops on the dial, and it is the same call that made the settlements
 * smaller and more detailed.
 */
export const ERA_ORDER: readonly EraId[] = ['myth', 'citadel', 'modern', 'after'];

/**
 * What the dial shows. `stamp` is the line above the name: a year for the
 * historical eras, and for the mythic age a word, because it does not have
 * one and pretending otherwise would be the only false note on the dial.
 */
export { ERA_POPULATION } from '@/world/eras/population';

export const ERA_LABELS: Readonly<Record<EraId, { name: string; stamp: string }>> = {
  myth: { name: 'Wyrmrest', stamp: 'Myth' },
  citadel: { name: 'Citadel', stamp: '1800' },
  modern: { name: 'Modern', stamp: '2020' },
  after: { name: 'After', stamp: '2300' },
};

/**
 * A shape a lot cannot express: a city wall, a gate roof, a moat, a courtyard.
 * Three kinds cover every era: a box, a wide flattened pyramid for a tiled
 * roof, and a flat quad lying on the ground.
 *
 * `hue` is a gable too, but a Hue one: a concave sweep with the corners
 * turned up, a capped ridge and barge ridges down the ends. It is a separate
 * kind rather than a better `gable` because that eave belongs to one century.
 * On a 2020 suburban house it would be fancy dress.
 *
 * `trim` is a box too. It is the fine detail on a building's face and along
 * the kerb: balconies, pilasters, shopfronts, benches. It is kept a separate
 * kind so that it can one day be faded out with altitude as one piece, but it
 * is drawn at every altitude for now: cutting it changes the average tone of
 * every wall it is on, and `DETAIL` in state/altitude.ts has the measurement.
 */
export type StructureKind = 'box' | 'roof' | 'gable' | 'hue' | 'tank' | 'flat' | 'trim' | 'round';

export interface Structure {
  kind: StructureKind;
  /**
   * The lot this belongs to, when it belongs to one. Opening a building takes
   * its roof and everything on it away, and this is how they are found.
   */
  lotId?: number;
  x: number;
  /** Height of the base above the ground, in metres. */
  y: number;
  z: number;
  wM: number;
  hM: number;
  dM: number;
  rotY: number;
  colour: number;
}

export interface EraPalette {
  /** The ground between buildings: yard, path and tarmac, not grass. */
  townGround: number;
  /** The country beyond the built-up part. */
  land: number;
  water: number;
  road: number;
  /** The strip either side of the carriageway. */
  pavement: number;
  /** Eaves on the low buildings. */
  roof: number;
  canopy: number;
  trunk: number;
  lampOn: number;
  /**
   * Chance that a house or a shop has a tree in its yard. A modern city has
   * almost none. A citadel is half hidden under them, which is most of what
   * gives the reference picture its texture.
   */
  courtyardChance: number;
  /** Multiplies the canopy size. Village trees are wider than street trees. */
  canopyScale: number;
  /** A second, rounder crown, shrubs, and how many of each. */
  canopyRound: number;
  roundShare: number;
  bush: number;
  bushesPerTree: number;
  /**
   * Trees planted along ordinary streets: how many streets get a row, and how
   * far apart the trees stand. Avenues always had them; streets never did,
   * and in 2020 that left 687 of 739 edges bare, so the opening view was a
   * heavy grid of empty grey stripes. A planted street is the single most
   * recognisable thing about a city seen from the air.
   */
  streetTrees: { share: number; spacingM: number };
  /**
   * What is painted on the roads or worn into them (world/markings.ts): lane
   * lines and crossings, strips of light, or the ruts carts leave.
   */
  marks: MarkingStyle;
  /** Street lamps belong to an era that has them. */
  lamps: boolean;
  /** Fraction of windows lit after dark, and how brightly they burn. */
  windowsLit: number;
  windowGlow: number;
  /** The colour a lit window burns. */
  windowTint: readonly [number, number, number];
  building: Readonly<Record<LotUse, readonly number[]>>;
  clothes: readonly number[];
}

export interface VehicleKind {
  lengthM: number;
  heightM: number;
  widthM: number;
  speedMS: { min: number; max: number };
  colours: readonly number[];
}

export interface VehicleProfile {
  /** The larger, less common kind: a car, an ox cart. */
  major: VehicleKind;
  /** The smaller, more common kind: a scooter, a handcart. */
  minor: VehicleKind;
  minorShare: number;
  /** Multiplies the hour-by-hour load. A citadel is far quieter than a city. */
  density: number;
}

/**
 * A layout is built in steps rather than in one call, so that changing era
 * never blocks a frame. Laying out the citadel takes about sixty milliseconds,
 * which at sixty frames a second is four frames of nothing; split into steps,
 * no single one costs more than a frame's budget. `world.ts` runs one step per
 * frame and starts the cross-fade once the last one returns the layout.
 */
export type EraBuild = Generator<void, EraLayout, void>;

export interface EraLayout {
  roads: RoadGraph;
  lots: Lot[];
  structures: Structure[];
  /** How far out this era built, for distance-based decisions. */
  cityRadiusM: number;
  /**
   * What somebody on foot cannot walk through besides the buildings: a wall,
   * a moat, a keep, the foot of a spire (walk/town.ts). None for an era with
   * nothing of the kind.
   */
  barriers?: OrientedRect[];
  /** Places a day in this era needs by name, and the way to face there (story/cast.ts). */
  landmarks?: Readonly<Record<string, Landmark>>;
  /** The wall round the town, for an era that has one: inside it or out. */
  enclosure?: { shape: 'square' | 'circle'; halfM: number };
}

export interface Landmark {
  x: number;
  z: number;
  /** Which way somebody standing here faces, as a direction on the ground. */
  faceX: number;
  faceZ: number;
}

export interface Era {
  id: EraId;
  /** Shown on the dial. */
  /**
   * Shown in the HUD beside the name. A number for the historical eras and a
   * phrase for the mythic one, which has no year.
   */
  year: number | string;
  name: string;
  palette: EraPalette;
  lots: LotProfile;
  vehicles: VehicleProfile;
  thoughts: ThoughtSet;
  population: { people: number; vehicles: number };
  /** The colours inside a building that has been opened (world/interior.ts). */
  interior: InteriorStyle;
  /**
   * Whether this era has things living in it besides people: imps on the
   * lanes, beasts on the plain, and heroes out looking for them
   * (agents/monsters.ts). Only the mythic age sets it.
   */
  monsters?: boolean;
  build: (rng: Rng, terrain: TerrainSpec) => EraBuild;
}

const BUILT: readonly Era[] = [MYTH_ERA, CITADEL_ERA, MODERN_ERA, AFTER_ERA];

/** The eras that exist today, oldest first. */
export function availableEras(): readonly Era[] {
  const found: Era[] = [];
  for (const id of ERA_ORDER) {
    const era = BUILT.find((candidate) => candidate.id === id);
    if (era) found.push(era);
  }
  return found;
}

/**
 * Runs a build to the end in one go. For tests, and for the first city, where
 * there is no frame to protect because nothing is on screen yet.
 */
export function buildLayout(era: Era, rng: Rng, terrain: TerrainSpec): EraLayout {
  const steps = era.build(rng, terrain);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function eraById(id: EraId): Era | undefined {
  return BUILT.find((era) => era.id === id);
}

/** Zenith opens in the era the viewer lives in. */
export const DEFAULT_ERA: EraId = 'modern';
