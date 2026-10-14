/**
 * The day clock. Hour runs 0..24 and wraps. Sun direction, sky colour and
 * window lights are all pure functions of it (see world/sky.ts). Pure module:
 * no three.js, no DOM.
 */

/**
 * One full day per 15 real minutes (PLAN.md 4.5, revised 20 Sep 2026).
 *
 * The plan said 6 minutes. At that rate a schedule slot lasts 15 to 90 seconds
 * while a walk of a few blocks takes two or three minutes at a real 1.4 m/s, so
 * every trip was overtaken by the next decision and nobody ever arrived
 * anywhere: the whole population walked, permanently. Fifteen minutes lets the
 * morning and evening commutes finish, which is what makes the waves readable.
 */
export const DAY_LENGTH_S = 900;

/**
 * The hour Zenith opens at when it cannot ask the device: the last of the
 * light (PLAN.md 2), the sun just above the horizon and the first windows
 * coming on, so the viewer sees the city turn into a city at night rather
 * than arriving after dark.
 *
 * It is only the fallback now. See `localHour`.
 */
export const START_HOUR = 17.5;

/**
 * The viewer's own clock, as an hour with its minutes as a fraction.
 *
 * Opening the app should show the time it actually is where the viewer is
 * sitting: morning light if it is morning for them, and the lamps coming on
 * if it is evening. The piece is about looking down at a town living out a
 * day, and starting that day at the viewer's own hour is what ties the two
 * together. `?hour=` still overrides it, for a reviewer setting up a shot.
 *
 * Pure apart from reading the clock, and it is given a value rather than
 * calling `Date` itself so the callers stay testable.
 */
export function localHour(now: Date = new Date()): number {
  return wrapHour(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
}

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
