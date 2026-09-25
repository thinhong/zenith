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
  /** Light bounced back up off the land. The lower half of the hemisphere light. */
  bounceColor: Rgb;
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
  bounce: number;
  ambI: number;
}

/**
 * Keyframes through one day (PLAN.md 5). The last key repeats the first at
 * hour 24 so interpolation never has to wrap.
 *
 * These are daylight as a background painting sets it down: a warm sun, a
 * clearly blue sky bounce so shadows go cool rather than grey, and haze with
 * some colour left in it. A camera records midday as near-white, and that
 * version of this table is in the history if it is ever wanted back; it read
 * as accurate and flat.
 *
 * The intensities follow one rule: **at midday a flat surface facing the sky
 * renders at about its own colour.** With a Lambert material the light a top
 * face receives is `ambI * ambLinear + sunI * sunLinear * dot(n, sun)`, and
 * the surface shows `that / PI * albedo`, so the two intensities are chosen to
 * sum to about PI at noon with the sun three quarters of the way up. Before
 * this they summed to about 1.6, which is why every render came back at half
 * the value of the palette and read as mud. If you change a light colour here,
 * re-check the sum; if you want the world brighter, paint the palette, do not
 * push the lights past the rule.
 *
 * The split is about 55 percent sky and 45 percent sun. A painted background
 * keeps a shadow at roughly half the value of the light, never at black, and
 * the sun's share is what sets that ratio: at 70 percent the shaded side of a
 * tower came back almost black. Push it the other way and the roofs flatten.
 */
const KEYS: readonly SkyKey[] = [
  { hour: 0.0, sky: 0x0e1832, fog: 0x1a2b4c, sun: 0xa8c4ec, sunI: 0.5, amb: 0x6a86bc, bounce: 0x4a4668, ambI: 0.95 },
  { hour: 4.5, sky: 0x1d3058, fog: 0x2f4876, sun: 0xaec8ec, sunI: 0.55, amb: 0x7690c4, bounce: 0x50506e, ambI: 1.05 },
  { hour: 6.5, sky: 0x96a8c4, fog: 0xe8b79a, sun: 0xffcb9c, sunI: 1.7, amb: 0xb8c8dc, bounce: 0xa88c6e, ambI: 1.8 },
  { hour: 9.0, sky: 0x8ec8ee, fog: 0xd2e6f2, sun: 0xfff0c8, sunI: 2.05, amb: 0xbcd8f0, bounce: 0xc4ac7e, ambI: 2.1 },
  { hour: 12.0, sky: 0x7cc2f0, fog: 0xdcecf6, sun: 0xfff6dc, sunI: 2.1, amb: 0xc0dcf4, bounce: 0xc8b082, ambI: 2.2 },
  { hour: 15.5, sky: 0x88c4ee, fog: 0xdeeaf2, sun: 0xfff0ce, sunI: 2.05, amb: 0xbedaf2, bounce: 0xc6ae80, ambI: 2.15 },
  { hour: 18.0, sky: 0x8a96b4, fog: 0xe3a884, sun: 0xffb37c, sunI: 1.85, amb: 0xb4c2d8, bounce: 0xa88866, ambI: 1.85 },
  { hour: 19.5, sky: 0x435270, fog: 0x8a6672, sun: 0xc5806f, sunI: 0.95, amb: 0x8492b2, bounce: 0x625060, ambI: 1.25 },
  { hour: 21.0, sky: 0x10203e, fog: 0x1e3052, sun: 0xa8c4ec, sunI: 0.52, amb: 0x6e88be, bounce: 0x4c4868, ambI: 0.98 },
  { hour: 24.0, sky: 0x0e1832, fog: 0x1a2b4c, sun: 0xa8c4ec, sunI: 0.5, amb: 0x6a86bc, bounce: 0x4a4668, ambI: 0.95 },
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
    bounceColor: mixHex(a.bounce, b.bounce, t),
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
