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
  /** Trees and street lamps. */
  props: { offM: 3800, onM: 3100 },
  /** The sun only casts shadows below this (PLAN.md 5, "Light"). */
  shadowMaxM: 300,
  /** Hysteresis around `shadowMaxM` so scrubbing the boundary does not thrash. */
  shadowHysteresisM: 40,
} as const;

export function detailFactor(fade: Fade, altitudeM: number): number {
  return smoothstep(fade.offM, fade.onM, altitudeM);
}

/**
 * Fog follows the camera. Looking straight down from 5 km the ground below is
 * 5 km away, so a fixed fog range would bury the whole world. Scaling near and
 * far with altitude keeps what is underneath clear and dissolves the horizon.
 */
export const FOG = {
  nearScale: 0.9,
  nearOffsetM: 250,
  farScale: 0.9,
  farOffsetM: 3200,
} as const;

export function fogRange(altitudeM: number): { nearM: number; farM: number } {
  return {
    nearM: altitudeM * FOG.nearScale + FOG.nearOffsetM,
    farM: altitudeM * FOG.farScale + FOG.farOffsetM,
  };
}
