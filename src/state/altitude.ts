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
