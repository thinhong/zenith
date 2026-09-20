/**
 * Altitude is the single most important state in Zenith. Everything the world
 * shows (detail, sound, text) is a function of it. Units are metres above ground.
 */
export const ALTITUDE = {
  min: 12,
  start: 900,
  max: 6000,
} as const;

export type AltitudeBand = 'street' | 'roof' | 'mountain' | 'cloud' | 'satellite';

/** Band boundaries in metres. Tune these by feel; keep them in one place. */
export const BANDS: ReadonlyArray<{ band: AltitudeBand; below: number }> = [
  { band: 'street', below: 60 },
  { band: 'roof', below: 300 },
  { band: 'mountain', below: 1200 },
  { band: 'cloud', below: 3500 },
  { band: 'satellite', below: Number.POSITIVE_INFINITY },
];

export function altitudeBand(metres: number): AltitudeBand {
  for (const b of BANDS) if (metres < b.below) return b.band;
  return 'satellite';
}

/** 0 at `from`, 1 at `to`, smooth in between. Use for fading detail in/out. */
export function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Detail fades. Every metre threshold in Zenith lives in this file (AGENTS.md 5).
 * A fade is `{ offM, onM }`: the factor is 0 at or above `offM` and 1 at or
 * below `onM`, smooth in between, so nothing pops at a band edge.
 */
export interface Fade {
  offM: number;
  onM: number;
}

export const DETAIL = {
  /** Window lights. Above this the city is flat colour (PLAN.md M1 task 7). */
  windows: { offM: 3800, onM: 3200 },
  /**
   * The daytime window pattern, which is a different question from the lights.
   * A floor is 3.6 m, so above about 400 m it is roughly one pixel tall and a
   * hard pattern sampled at that rate turns into black moire across every
   * shaded wall. An aerial photograph shows facades as flat tone from there
   * anyway, so it fades out well before it can alias.
   */
  facade: { offM: 520, onM: 240 },
  /** Trees and street lamps. */
  props: { offM: 3800, onM: 3100 },
  /**
   * Thought labels. The acceptance is that the text is unreadable by 60 m and
   * gone by 70 m (PLAN.md M3), so the fade is finished a little under that.
   */
  thoughts: { offM: 66, onM: 44 },
  /** The sun only casts shadows below this (PLAN.md 5, "Light"). */
  shadowMaxM: 800,
  /** Hysteresis around `shadowMaxM` so scrubbing the boundary does not thrash. */
  shadowHysteresisM: 40,
} as const;

export function detailFactor(fade: Fade, altitudeM: number): number {
  return smoothstep(fade.offM, fade.onM, altitudeM);
}

/**
 * Fog hides the edge of the world. three's Fog measures distance from the
 * camera, so the range has to grow with altitude: looking straight down from
 * 5 km the ground below is 5 km away and must still be sharp. These numbers are
 * tuned so haze starts a little past the mountain ring at every height and the
 * land dissolves before its rim is reached.
 */
export const FOG = {
  nearScale: 1.05,
  nearOffsetM: 350,
  farScale: 1.5,
  farOffsetM: 2600,
} as const;

export function fogRange(altitudeM: number): { nearM: number; farM: number } {
  return {
    nearM: altitudeM * FOG.nearScale + FOG.nearOffsetM,
    farM: altitudeM * FOG.farScale + FOG.farOffsetM,
  };
}

/**
 * Where people and vehicles appear and what they turn into. Same rule as the
 * rest of this file: no metre threshold for agents lives anywhere else.
 */
export const AGENTS = {
  /** Below this, people are walking figures. Above it they are dots. */
  figuresMaxM: 320,
  /** Above this, people are not drawn at all. */
  peopleDotsMaxM: 1250,
  /** Below this, vehicles are boxes. Above it they are dots. */
  vehiclesMaxM: 1250,
  /** Above this, vehicles are not drawn at all. */
  vehicleDotsMaxM: 3500,
  /** Agents this close to the look-at point update every frame. */
  nearM: 400,
  /** How often the rest update. One in this many frames. */
  farStride: 8,
  /** Figures are only drawn within this of the look-at point. */
  drawRadiusM: 700,
} as const;
