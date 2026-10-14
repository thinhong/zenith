import { clamp01, easeInOut, smoothstep, type Vec3 } from '@/film/ease';
import { ROOM } from '@/film/stage';

/**
 * The small light that leaves a person at the end of a life, and where it goes:
 * up out of the chest, a pause, across the room to the window, and out into
 * the dusk sky. The same pale gold as the light that leads the way in Above.
 * Pure: the path is a spline through fixed points, timed by the shot.
 */
export const SOUL = {
  /** Seconds to rise out of the chest. */
  riseS: 2.6,
  /** Seconds it waits, just above her. */
  holdS: 0.9,
  /** Seconds to cross the room to the window. */
  crossS: 3.6,
  /** Seconds to leave through the window and climb out of sight. */
  leaveS: 4.0,
  /** How high above the chest it waits. */
  riseM: 0.5,
} as const;

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): [number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const a = p0[i] ?? 0;
    const b = p1[i] ?? 0;
    const c = p2[i] ?? 0;
    const d = p3[i] ?? 0;
    out[i] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  return out;
}

/** The fixed points the light passes after it has risen, ending high outside. */
function waypoints(start: Vec3): Vec3[] {
  const above: Vec3 = [start[0], start[1] + SOUL.riseM, start[2]];
  const w = ROOM.window;
  return [
    start,
    above,
    [(above[0] + w.x) / 2 - 0.1, above[1] + 0.25, (above[2] + ROOM.backZ) / 2],
    [w.x, (w.sillM + w.topM) / 2 + 0.05, ROOM.backZ],
    [w.x + 0.3, 2.6, ROOM.backZ - 1.4],
    [w.x + 1.0, 4.6, ROOM.backZ - 4.2],
  ];
}

/** Where the light is `localS` seconds into its shot, and how brightly it shows. */
export function soulAt(start: Vec3, localS: number): { pos: [number, number, number]; glow: number } {
  const pts = waypoints(start);
  const at = (i: number): Vec3 => pts[Math.max(0, Math.min(pts.length - 1, i))] ?? start;
  // Which leg of the path, and how far along it, from the clock.
  const legs: { fromIndex: number; durationS: number; ease: (t: number) => number }[] = [
    { fromIndex: 0, durationS: SOUL.riseS, ease: easeInOut },
    { fromIndex: 1, durationS: SOUL.holdS, ease: () => 0 },
    { fromIndex: 1, durationS: SOUL.crossS * 0.5, ease: (t) => easeInOut(t) },
    { fromIndex: 2, durationS: SOUL.crossS * 0.5, ease: (t) => easeInOut(t) },
    { fromIndex: 3, durationS: SOUL.leaveS * 0.45, ease: (t) => t * t },
    { fromIndex: 4, durationS: SOUL.leaveS * 0.55, ease: (t) => t },
  ];
  let s = Math.max(0, localS);
  let pos: [number, number, number] = [start[0], start[1], start[2]];
  for (const leg of legs) {
    if (s <= leg.durationS) {
      const t = leg.ease(clamp01(s / leg.durationS));
      const i = leg.fromIndex;
      pos = catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), t);
      break;
    }
    s -= leg.durationS;
    const last = at(leg.fromIndex + 1);
    pos = [last[0], last[1], last[2]];
  }
  // A slow float, so it is alive and not on rails.
  const wobble = 0.03 * Math.sin(localS * 2.1);
  pos[0] += wobble;
  pos[1] += 0.02 * Math.sin(localS * 1.7 + 1);
  const glow = smoothstep(0, 1.2, localS);
  return { pos, glow };
}
