import { clamp01, lerp, lerp3, smoothstep, type Vec3 } from '@/film/ease';

/**
 * The light of the day and the colour of the year outside the window. Pure:
 * plain numbers in, plain numbers out. The room reads these every frame, and
 * in the time-lapse the hour and the year run fast, which is how the film
 * shows that decades are passing without saying so.
 *
 * Colours are linear-ish 0..1 triples, written from hex values picked by eye.
 */
export type RGB = Vec3;

export interface Sky {
  top: RGB;
  horizon: RGB;
  sunColour: RGB;
  /** Direct sunlight through the window, 0 at night. */
  sun: number;
  /** Fill light from the sky, never quite 0. */
  ambient: number;
  /** Where the sun is, as a unit vector from the room towards it. */
  sunDir: Vec3;
  /** 0 by day, 1 at full night. */
  night: number;
  /** The desk lamp, 0 off to 1 on. */
  lamp: number;
}

interface SkyKey {
  hour: number;
  top: string;
  horizon: string;
  sunColour: string;
  sun: number;
  ambient: number;
}

/** Keyframes through a day. The hour wraps, so the first and last must agree. */
const SKY_KEYS: readonly SkyKey[] = [
  { hour: 0, top: '#0a1024', horizon: '#18203e', sunColour: '#8fa6ff', sun: 0, ambient: 0.18 },
  { hour: 4.8, top: '#0f1a38', horizon: '#2c2f55', sunColour: '#8fa6ff', sun: 0, ambient: 0.2 },
  { hour: 5.8, top: '#34507f', horizon: '#e79a6c', sunColour: '#ffae72', sun: 0.35, ambient: 0.42 },
  { hour: 7.5, top: '#6ea3d8', horizon: '#f3dcc0', sunColour: '#ffe2b8', sun: 1.0, ambient: 0.75 },
  { hour: 12, top: '#5b9be2', horizon: '#d6e9f6', sunColour: '#fff7ea', sun: 1.15, ambient: 0.9 },
  { hour: 16, top: '#679dd6', horizon: '#eadfca', sunColour: '#ffeccc', sun: 1.05, ambient: 0.8 },
  { hour: 17.7, top: '#6e84b6', horizon: '#ffbe78', sunColour: '#ffb466', sun: 0.95, ambient: 0.62 },
  { hour: 18.6, top: '#3a4b82', horizon: '#ff8c5e', sunColour: '#ff7c4c', sun: 0.45, ambient: 0.42 },
  { hour: 19.5, top: '#1b2450', horizon: '#6a5886', sunColour: '#8fa6ff', sun: 0, ambient: 0.26 },
  { hour: 24, top: '#0a1024', horizon: '#18203e', sunColour: '#8fa6ff', sun: 0, ambient: 0.18 },
];

export const SUN = {
  rise: 5.8,
  set: 19.2,
  /** Highest the sun climbs at noon, in radians. */
  maxElevation: 0.95,
  /** How far the sun swings left and right of straight behind the window. */
  swing: 1.15,
} as const;

export function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function skyAt(hour: number): Sky {
  const h = wrapHour(hour);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && h >= (SKY_KEYS[i + 1]?.hour ?? 24)) i += 1;
  const a = SKY_KEYS[i] ?? SKY_KEYS[0];
  const b = SKY_KEYS[i + 1] ?? SKY_KEYS[0];
  if (!a || !b) throw new Error('sky keyframes are missing');
  const t = b.hour > a.hour ? clamp01((h - a.hour) / (b.hour - a.hour)) : 0;

  // The sun crosses behind the window from left (morning) to right (evening).
  const day = clamp01((h - SUN.rise) / (SUN.set - SUN.rise));
  const up = Math.sin(Math.PI * day);
  const elevation = Math.max(0.12, up * SUN.maxElevation);
  const azimuth = (day - 0.5) * 2 * SUN.swing;
  const sunDir: Vec3 = [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  ];

  const ambient = lerp(a.ambient, b.ambient, t);
  // The sky's own fill light says how dark it is better than the clock does.
  const night = 1 - smoothstep(0.2, 0.5, ambient);
  return {
    top: lerp3(hexToRgb(a.top), hexToRgb(b.top), t),
    horizon: lerp3(hexToRgb(a.horizon), hexToRgb(b.horizon), t),
    sunColour: lerp3(hexToRgb(a.sunColour), hexToRgb(b.sunColour), t),
    sun: lerp(a.sun, b.sun, t),
    ambient,
    sunDir,
    night,
    lamp: smoothstep(0.35, 0.75, night),
  };
}

/** What falls past the window. */
export type Fall = 'petal' | 'leaf' | 'snow' | 'none';

export interface Season {
  /** Colour of the tree's crown. */
  crown: RGB;
  /** How full the crown is: bare in winter. */
  density: number;
  /** Snow on the ground and the branches, 0 to 1. */
  snow: number;
  fall: Fall;
  /** How much of it is falling, 0 to 1. */
  fallAmount: number;
  /** The four weights, spring, summer, autumn, winter, summing to 1. */
  weights: readonly [number, number, number, number];
}

const CROWN: readonly [RGB, RGB, RGB, RGB] = [
  hexToRgb('#f3b6c8'), // blossom
  hexToRgb('#5c9a47'),
  hexToRgb('#d9803a'),
  hexToRgb('#8e8a86'), // bare twigs
];

/** A bump of width w centred on c, on a circle of circumference 1. */
function bump(f: number, c: number, w: number): number {
  let d = Math.abs(f - c);
  d = Math.min(d, 1 - d);
  return Math.max(0, 1 - (d / w) ** 2);
}

/**
 * The year as a number of years since the story began: 0.0 is early spring,
 * 0.25 summer, 0.5 autumn, 0.75 winter. The time-lapse runs it over many years.
 */
export function seasonAt(year: number): Season {
  const f = ((year % 1) + 1) % 1;
  const raw: [number, number, number, number] = [
    bump(f, 0.09, 0.2),
    bump(f, 0.36, 0.2),
    bump(f, 0.62, 0.17),
    bump(f, 0.86, 0.17),
  ];
  const sum = raw[0] + raw[1] + raw[2] + raw[3];
  const w: [number, number, number, number] = [raw[0] / sum, raw[1] / sum, raw[2] / sum, raw[3] / sum];
  const crown: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const c = CROWN[k] ?? CROWN[0];
    const wk = w[k] ?? 0;
    crown[0] += c[0] * wk;
    crown[1] += c[1] * wk;
    crown[2] += c[2] * wk;
  }
  const strongest = w.indexOf(Math.max(...w));
  const fall: Fall = strongest === 0 ? 'petal' : strongest === 2 ? 'leaf' : strongest === 3 ? 'snow' : 'none';
  return {
    crown,
    density: 1 - 0.8 * w[3],
    snow: smoothstep(0.35, 0.8, w[3]),
    fall,
    fallAmount: fall === 'none' ? 0 : Math.max(...w),
    weights: w,
  };
}
