/**
 * The day clock. Hour runs 0..24 and wraps. Sun direction, sky colour and
 * window lights are all pure functions of it (see world/sky.ts). Pure module:
 * no three.js, no DOM.
 */

/** One full day per 6 real minutes (PLAN.md 4.5). */
export const DAY_LENGTH_S = 360;

/** Zenith opens near dusk (PLAN.md 2), so the first frame has lights coming on. */
export const START_HOUR = 18.2;

export interface Clock {
  hourOfDay: number;
  paused: boolean;
  dayLengthS: number;
}

export function wrapHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

export function createClock(startHour: number = START_HOUR, dayLengthS: number = DAY_LENGTH_S): Clock {
  return { hourOfDay: wrapHour(startHour), paused: false, dayLengthS };
}

export function advanceClock(clock: Clock, dtS: number): void {
  if (clock.paused) return;
  clock.hourOfDay = wrapHour(clock.hourOfDay + (dtS / clock.dayLengthS) * 24);
}
