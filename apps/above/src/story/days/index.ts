import type { EraId } from '@/world/eras';
import type { DayScript } from '@/story/script';
import { AFTER_DAY } from '@/story/days/after';
import { CITADEL_DAY } from '@/story/days/citadel';
import { MODERN_DAY } from '@/story/days/modern';
import { WYRMREST_DAY } from '@/story/days/wyrmrest';

/** One ordinary day for every era, and the same grey cat in each of them. */
export const DAYS: readonly DayScript[] = [WYRMREST_DAY, CITADEL_DAY, MODERN_DAY, AFTER_DAY];

export function dayFor(era: EraId): DayScript | undefined {
  return DAYS.find((day) => day.era === era);
}
