import type { LotUse } from '@/world/lots';

/**
 * Where a person wants to be at a given hour. Pure: no three.js, no state, so
 * the whole day can be tested without a GPU (AGENTS.md 3).
 *
 * Every agent carries its own small hour offset, and the caller adds that to
 * the clock before asking. That is what staggers the commute instead of moving
 * the whole city on the same tick.
 */
export type Role = 'office' | 'shop' | 'student' | 'retired' | 'night';

export const ROLES: readonly Role[] = ['office', 'shop', 'student', 'retired', 'night'];

/** Share of the population in each role. Sums to 1. */
export const ROLE_SHARE: Readonly<Record<Role, number>> = {
  office: 0.32,
  shop: 0.16,
  student: 0.22,
  retired: 0.16,
  night: 0.14,
};

/** The uses a person will travel to. Water is not one of them. */
export type Destination = Extract<LotUse, 'home' | 'work' | 'market' | 'park' | 'temple'>;

interface Slot {
  fromHour: number;
  use: Destination;
}

/**
 * One day per role, as "from this hour, be here". The last slot at or before
 * the hour wins, so each list must start at 0 and be sorted.
 */
const DAY: Readonly<Record<Role, readonly Slot[]>> = {
  office: [
    { fromHour: 0, use: 'home' },
    { fromHour: 8, use: 'work' },
    // One evening stop, not two: a slot has to be long enough to walk there in.
    { fromHour: 17.5, use: 'market' },
    { fromHour: 20, use: 'home' },
  ],
  shop: [
    { fromHour: 0, use: 'home' },
    { fromHour: 6.5, use: 'market' },
    { fromHour: 19.5, use: 'home' },
  ],
  student: [
    { fromHour: 0, use: 'home' },
    { fromHour: 7, use: 'work' },
    { fromHour: 16, use: 'park' },
    { fromHour: 18.5, use: 'home' },
  ],
  retired: [
    { fromHour: 0, use: 'home' },
    { fromHour: 8.5, use: 'park' },
    { fromHour: 11, use: 'market' },
    { fromHour: 13, use: 'home' },
    { fromHour: 16, use: 'temple' },
    { fromHour: 18, use: 'home' },
  ],
  night: [
    { fromHour: 0, use: 'work' },
    { fromHour: 6, use: 'home' },
    { fromHour: 14, use: 'market' },
    { fromHour: 15.5, use: 'home' },
    { fromHour: 22, use: 'work' },
  ],
};

export function desiredUse(role: Role, hourOfDay: number): Destination {
  const hour = wrap24(hourOfDay);
  const day = DAY[role];
  let current: Destination = day[0]?.use ?? 'home';
  for (const slot of day) {
    if (slot.fromHour > hour) break;
    current = slot.use;
  }
  return current;
}

/** Picks a role from a 0..1 roll, following ROLE_SHARE. */
export function pickRole(roll: number): Role {
  let remaining = Math.min(1, Math.max(0, roll));
  for (const role of ROLES) {
    remaining -= ROLE_SHARE[role];
    if (remaining <= 0) return role;
  }
  return 'office';
}

export function roleIndex(role: Role): number {
  const i = ROLES.indexOf(role);
  return i < 0 ? 0 : i;
}

export function roleAt(index: number): Role {
  return ROLES[index] ?? 'office';
}

function wrap24(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/** Destination order, so a destination fits in one byte of the agent pool. */
export const DESTINATIONS: readonly Destination[] = ['home', 'work', 'market', 'park', 'temple'];

export function destinationIndex(use: Destination): number {
  const i = DESTINATIONS.indexOf(use);
  return i < 0 ? 0 : i;
}

export function destinationAt(index: number): Destination {
  return DESTINATIONS[index] ?? 'home';
}

/** Home and work are indoors: a person who gets there goes in and is not drawn. */
export function isIndoors(use: Destination): boolean {
  return use === 'home' || use === 'work';
}
