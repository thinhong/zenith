import { ALTITUDE } from '@/state/altitude';

/**
 * Settings read once at start-up. `seed` is the shareable one (PLAN.md M1
 * acceptance); `hour` and `alt` exist only so the smoke test and a reviewer can
 * screenshot a fixed moment (PLAN.md 8).
 */
export interface Settings {
  seed: number;
  reducedMotion: boolean;
  /** Pin the day clock to this hour. `null` runs the clock normally. */
  fixedHour: number | null;
  /** Open at this altitude in metres. `null` uses ALTITUDE.start. */
  startAltitudeM: number | null;
}

export function parseSettings(search: string, reducedMotion: boolean): Settings {
  const q = new URLSearchParams(search);
  return {
    seed: finiteOr(q.get('seed'), 1),
    reducedMotion,
    fixedHour: clampOrNull(finiteOrNull(q.get('hour')), 0, 24),
    startAltitudeM: clampOrNull(finiteOrNull(q.get('alt')), ALTITUDE.min, ALTITUDE.max),
  };
}

export function readSettings(): Settings {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return parseSettings(window.location.search, reduced);
}

function finiteOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function finiteOr(raw: string | null, fallback: number): number {
  return finiteOrNull(raw) ?? fallback;
}

function clampOrNull(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  return Math.min(max, Math.max(min, value));
}
