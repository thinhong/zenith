import { ALTITUDE } from '@/state/altitude';
import { ERA_ORDER, type EraId } from '@/world/eras';

/**
 * Settings read once at start-up. `seed` is the shareable one (PLAN.md M1
 * acceptance); the rest exist so a reviewer or a headless render can set up a
 * particular moment (PLAN.md 8).
 */
export interface Settings {
  seed: number;
  reducedMotion: boolean;
  /** Start the day clock here. `null` uses the usual opening hour. */
  startHour: number | null;
  /** Freeze the clock. Only useful together with `startHour`. */
  paused: boolean;
  /** Open at this altitude in metres. `null` uses ALTITUDE.start. */
  startAltitudeM: number | null;
  /** Look at this point on the ground instead of the centre, as `?at=x,z`. */
  startTarget: { x: number; z: number } | null;
  /** Open in this era, as `?era=citadel`. `null` opens in the usual one. */
  startEra: EraId | null;
}

export function parseSettings(search: string, reducedMotion: boolean): Settings {
  const q = new URLSearchParams(search);
  return {
    seed: finiteOr(q.get('seed'), 1),
    reducedMotion,
    startHour: clampOrNull(finiteOrNull(q.get('hour')), 0, 24),
    paused: q.get('pause') === '1',
    startAltitudeM: clampOrNull(finiteOrNull(q.get('alt')), ALTITUDE.min, ALTITUDE.max),
    startTarget: parsePoint(q.get('at')),
    startEra: parseEra(q.get('era')),
  };
}

export function readSettings(): Settings {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return parseSettings(window.location.search, reduced);
}

function parseEra(raw: string | null): EraId | null {
  if (raw === null) return null;
  const found = ERA_ORDER.find((id) => id === raw);
  return found ?? null;
}

function parsePoint(raw: string | null): { x: number; z: number } | null {
  if (raw === null) return null;
  const parts = raw.split(',');
  const x = finiteOrNull(parts[0] ?? null);
  const z = finiteOrNull(parts[1] ?? null);
  return x === null || z === null ? null : { x, z };
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
