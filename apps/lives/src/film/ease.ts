/**
 * Small numeric helpers shared by the pure modules. No three.js here, so every
 * decision built on them can be tested in node.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp3(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Hermite smoothstep between two edges, as in GLSL. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Slow in, slow out. A camera move that starts or stops dead reads as a machine. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

/** The signed angle from a to b, the short way round, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns from angle a towards b the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/**
 * A small seeded random stream (mulberry32). Blinks and drift must be the same
 * on every run, or two renders of one moment cannot be compared.
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
