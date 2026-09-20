import type { ThoughtSet } from '@/thoughts/content';
import type { InteriorStyle } from '@/world/interior';
import type { Lot, LotProfile, LotUse } from '@/world/lots';
import type { RoadGraph } from '@/world/roads';
import type { Rng } from '@/world/seed';
import type { TerrainSpec } from '@/world/terrain';
import { CITADEL_ERA } from '@/world/eras/citadel';
import { MODERN_ERA } from '@/world/eras/modern';

/**
 * One era is one layout of the same land (PLAN.md 9). The terrain never
 * changes; the roads, the lots, the colours and what people worry about do.
 */
export type EraId = 'fields' | 'citadel' | 'colonial' | 'modern' | 'after';

/** The five in order, oldest first. Not all of them are built yet. */
export const ERA_ORDER: readonly EraId[] = ['fields', 'citadel', 'colonial', 'modern', 'after'];

/**
 * Names and years for the dial, including the eras that are not built. The
 * viewer should be able to see that there are five, even while three of the
 * stops are still dark.
 */
export const ERA_LABELS: Readonly<Record<EraId, { name: string; year: number }>> = {
  fields: { name: 'Fields', year: 1500 },
  citadel: { name: 'Citadel', year: 1800 },
  colonial: { name: 'Colonial', year: 1930 },
  modern: { name: 'Modern', year: 2020 },
  after: { name: 'After', year: 2300 },
};

/**
 * A shape a lot cannot express: a city wall, a gate roof, a moat, a courtyard.
 * Three kinds cover every era: a box, a wide flattened pyramid for a tiled
 * roof, and a flat quad lying on the ground.
 */
export type StructureKind = 'box' | 'roof' | 'gable' | 'tank' | 'flat';

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
  /** Street lamps belong to an era that has them. */
  lamps: boolean;
  /** Fraction of windows lit after dark, and how brightly they burn. */
  windowsLit: number;
  windowGlow: number;
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
}

export interface Era {
  id: EraId;
  /** Shown on the dial. */
  year: number;
  name: string;
  palette: EraPalette;
  lots: LotProfile;
  vehicles: VehicleProfile;
  thoughts: ThoughtSet;
  population: { people: number; vehicles: number };
  /** The colours inside a building that has been opened (world/interior.ts). */
  interior: InteriorStyle;
  build: (rng: Rng, terrain: TerrainSpec) => EraBuild;
}

const BUILT: readonly Era[] = [CITADEL_ERA, MODERN_ERA];

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
