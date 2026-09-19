import { smoothstep } from '@/state/altitude';

/**
 * Sky, sun and night are pure functions of the hour (PLAN.md 4.5). This module
 * returns plain numbers; world.ts pushes them into the three.js lights and fog.
 * Colours are sRGB components in 0..1.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SkyState {
  /** Background behind everything. */
  sky: Rgb;
  /** Fog colour. Equal to the horizon so the world dissolves instead of ending. */
  fog: Rgb;
  /** Unit vector pointing from the ground towards the sun. */
  sunDir: Vec3;
  sunColor: Rgb;
  sunIntensity: number;
  ambientColor: Rgb;
  ambientIntensity: number;
  /** 0 in daylight, 1 at night. Drives window lights and street lamps. */
  nightFactor: number;
}

interface SkyKey {
  hour: number;
  sky: number;
  fog: number;
  sun: number;
  sunI: number;
  amb: number;
  ambI: number;
}

/**
 * Keyframes through one day. Low saturation, slightly warm (PLAN.md 5). The
 * last key repeats the first at hour 24 so interpolation never has to wrap.
 */
const KEYS: readonly SkyKey[] = [
  { hour: 0.0, sky: 0x060a12, fog: 0x0b1220, sun: 0x8fa8cc, sunI: 0.1, amb: 0x27354c, ambI: 0.3 },
  { hour: 4.5, sky: 0x0a1120, fog: 0x14203a, sun: 0x8fa8cc, sunI: 0.12, amb: 0x2b3a52, ambI: 0.32 },
  { hour: 6.5, sky: 0x44557a, fog: 0xc98a68, sun: 0xffc08c, sunI: 0.6, amb: 0x5a6d8f, ambI: 0.5 },
  { hour: 9.0, sky: 0x6d94c8, fog: 0xa8bdd6, sun: 0xfff0d6, sunI: 1.25, amb: 0x86a0c0, ambI: 0.6 },
  { hour: 12.0, sky: 0x7fa8d8, fog: 0xbccfe4, sun: 0xfff6e2, sunI: 1.45, amb: 0x90a6c2, ambI: 0.65 },
  { hour: 15.5, sky: 0x76a0d0, fog: 0xc3ccd8, sun: 0xfff0d0, sunI: 1.25, amb: 0x8ca2be, ambI: 0.6 },
  { hour: 18.0, sky: 0x4a5678, fog: 0xd9936a, sun: 0xff9f60, sunI: 0.8, amb: 0x66738f, ambI: 0.48 },
  { hour: 19.5, sky: 0x1e2a44, fog: 0x6e4a52, sun: 0xc06a58, sunI: 0.28, amb: 0x3c4a68, ambI: 0.36 },
  { hour: 21.0, sky: 0x090e1a, fog: 0x121a2a, sun: 0x8fa8cc, sunI: 0.12, amb: 0x2a3850, ambI: 0.31 },
  { hour: 24.0, sky: 0x060a12, fog: 0x0b1220, sun: 0x8fa8cc, sunI: 0.1, amb: 0x27354c, ambI: 0.3 },
];

export function skyAt(hourOfDay: number): SkyState {
  const hour = Math.min(24, Math.max(0, hourOfDay));
  const { a, b, t } = bracket(hour);
  return {
    sky: mixHex(a.sky, b.sky, t),
    fog: mixHex(a.fog, b.fog, t),
    sunDir: sunDirection(hour),
    sunColor: mixHex(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunI, b.sunI, t),
    ambientColor: mixHex(a.amb, b.amb, t),
    ambientIntensity: lerp(a.ambI, b.ambI, t),
    nightFactor: nightFactorAt(hour),
  };
}

/**
 * The sun rises at 6 and sets at 18. At night the direction is kept just above
 * the horizon and the intensity drops instead, which reads as moonlight and
 * avoids a light that flips sides at midnight.
 */
export function sunDirection(hourOfDay: number): Vec3 {
  const t = (hourOfDay - 6) / 12;
  const elevation = Math.sin(Math.PI * t);
  const azimuth = Math.PI * t;
  const x = Math.cos(azimuth);
  const y = Math.max(elevation, 0) * 0.95 + 0.14;
  const z = -0.42;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

/** 1 while the windows are lit, 0 in daylight, smooth across dawn and dusk. */
export function nightFactorAt(hourOfDay: number): number {
  const morning = 1 - smoothstep(5.0, 7.0, hourOfDay);
  const evening = smoothstep(17.2, 19.4, hourOfDay);
  return Math.max(morning, evening);
}

function bracket(hour: number): { a: SkyKey; b: SkyKey; t: number } {
  const first = KEYS[0];
  const last = KEYS[KEYS.length - 1];
  if (!first || !last) throw new Error('sky keyframes missing');
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (!a || !b) continue;
    if (hour >= a.hour && hour <= b.hour) {
      const span = b.hour - a.hour;
      return { a, b, t: span > 0 ? (hour - a.hour) / span : 0 };
    }
  }
  return { a: last, b: last, t: 0 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHex(a: number, b: number, t: number): Rgb {
  const ca = rgbFromHex(a);
  const cb = rgbFromHex(b);
  return { r: lerp(ca.r, cb.r, t), g: lerp(ca.g, cb.g, t), b: lerp(ca.b, cb.b, t) };
}

export function rgbFromHex(hex: number): Rgb {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}
