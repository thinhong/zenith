import { clamp01 } from '@/film/ease';

/**
 * The film is a list of shots laid end to end. This module answers the only
 * questions the rest of the app asks about time: which shot is on screen, how
 * far into it we are, which life this is, and how dark the frame is at the
 * joins. The film loops, and each loop is the next life.
 */
export interface ShotTiming {
  id: string;
  durationS: number;
  /** Seconds of fade up from black at the start of the shot. */
  fadeInS?: number;
  /** Seconds of fade down to black at the end of the shot. */
  fadeOutS?: number;
}

export interface Placed<T extends ShotTiming> {
  shot: T;
  index: number;
  /** When the shot starts, in seconds from the start of this life. */
  startS: number;
  /** Seconds since the shot began. */
  localS: number;
  /** 0 on the first frame of the shot, 1 on the last. */
  progress: number;
  /** How many times the film has looped: 0 for the first life, 1 for the next. */
  life: number;
}

export function totalDuration(shots: readonly ShotTiming[]): number {
  return shots.reduce((sum, shot) => sum + shot.durationS, 0);
}

export function locate<T extends ShotTiming>(shots: readonly T[], timeS: number): Placed<T> {
  const total = totalDuration(shots);
  if (shots.length === 0 || total <= 0) throw new Error('a film needs at least one shot with a length');
  const safe = Math.max(0, timeS);
  const life = Math.floor(safe / total);
  const withinS = safe - life * total;

  let startS = 0;
  let index = 0;
  for (const shot of shots) {
    const endS = startS + shot.durationS;
    // The last shot keeps the final instant, so rounding never falls off the end.
    if (withinS < endS || index === shots.length - 1) {
      const localS = Math.min(withinS - startS, shot.durationS);
      return { shot, index, startS, localS, progress: clamp01(localS / shot.durationS), life };
    }
    startS = endS;
    index += 1;
  }
  throw new Error('unreachable: the loop above always returns');
}

/** How dark the frame is at this moment, from 0 (clear) to 1 (black). */
export function darkness(placed: Placed<ShotTiming>): number {
  const { shot, localS } = placed;
  let dark = 0;
  if (shot.fadeInS !== undefined && shot.fadeInS > 0 && localS < shot.fadeInS) {
    dark = Math.max(dark, 1 - localS / shot.fadeInS);
  }
  if (shot.fadeOutS !== undefined && shot.fadeOutS > 0) {
    const from = shot.durationS - shot.fadeOutS;
    if (localS > from) dark = Math.max(dark, (localS - from) / shot.fadeOutS);
  }
  return clamp01(dark);
}
