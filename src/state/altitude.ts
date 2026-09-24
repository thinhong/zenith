/**
 * Altitude is the single most important state in Zenith. Everything the world
 * shows (detail, sound, text) is a function of it. Units are metres above ground.
 */
export const ALTITUDE = {
  min: 12,
  /** High enough to hold the whole settlement in frame, and no higher. */
  start: 520,
  /**
   * Past about this the settlement is a smudge in a plain, which is not worth
   * scrolling to. It was 6000 when the city was five times the area.
   */
  max: 2600,
} as const;

export type AltitudeBand = 'street' | 'roof' | 'mountain' | 'cloud' | 'satellite';

/** Band boundaries in metres. Tune these by feel; keep them in one place. */
export const BANDS: ReadonlyArray<{ band: AltitudeBand; below: number }> = [
  { band: 'street', below: 60 },
  { band: 'roof', below: 300 },
  { band: 'mountain', below: 900 },
  { band: 'cloud', below: 1800 },
  { band: 'satellite', below: Number.POSITIVE_INFINITY },
];

export function altitudeBand(metres: number): AltitudeBand {
  for (const b of BANDS) if (metres < b.below) return b.band;
  return 'satellite';
}

/** 0 at `from`, 1 at `to`, smooth in between. Use for fading detail in/out. */
export function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Detail fades. Every metre threshold in Zenith lives in this file (AGENTS.md 5).
 * A fade is `{ offM, onM }`: the factor is 0 at or above `offM` and 1 at or
 * below `onM`, smooth in between, so nothing pops at a band edge.
 */
export interface Fade {
  offM: number;
  onM: number;
}

export const DETAIL = {
  /** Window lights. Above this the city is flat colour (PLAN.md M1 task 7). */
  windows: { offM: 3800, onM: 3200 },
  /**
   * The daytime window pattern, which is a different question from the lights.
   * A floor is 3.6 m, so above about 400 m it is roughly one pixel tall and a
   * hard pattern sampled at that rate turns into black moire across every
   * shaded wall. An aerial photograph shows facades as flat tone from there
   * anyway, so it fades out well before it can alias.
   */
  facade: { offM: 520, onM: 240 },
  /** Trees and street lamps. */
  props: { offM: 3800, onM: 3100 },
  /**
   * There is deliberately no threshold here for the fine detail on a
   * building's face (the `trim` structure kind: balconies, pilasters,
   * shopfronts, benches). It is drawn at every altitude.
   *
   * Not because switching it off looks bad. Held at one camera position,
   * 910 m up, taking it away changes 1.97% of the pixels against a control
   * of 0.33%, which nobody would see. It is because the saving is 144k
   * triangles and two draw calls, and that is not worth a threshold to tune,
   * a band to pop across, and a branch in the frame loop.
   *
   * A warning for whoever measures this next. The first two attempts put the
   * pop at 76% and then 37%, and both were nonsense: they compared renders
   * 10 m apart in altitude, and in a city of thin vertical edges a 10 m
   * camera move shifts that many pixels on its own. A control pair with the
   * detail unchanged gives the same numbers. To measure a level-of-detail
   * pop, hold the camera exactly still and change only the detail.
   */
  /**
   * Thought labels. The acceptance is that the text is unreadable by 60 m and
   * gone by 70 m (PLAN.md M3), so the fade is finished a little under that.
   */
  thoughts: { offM: 66, onM: 44 },
  /** The sun only casts shadows below this (PLAN.md 5, "Light"). */
  shadowMaxM: 800,
  /** Hysteresis around `shadowMaxM` so scrubbing the boundary does not thrash. */
  shadowHysteresisM: 40,
} as const;

/**
 * Whatever comes between the camera and what it is looking at is cut away.
 *
 * The camera looks at a point on the ground, and its altitude is its
 * distance from that point. In 2300 a tower can be three times taller than
 * the camera is high, and coming down beside one used to fill the frame with
 * a single flat wall, or put the camera inside it. Now anything nearer the
 * camera than a share of that distance dissolves, in a fine dither so the
 * edge of the cut is soft, and the point being looked at is never touched.
 *
 * The cut is capped in metres as well: from the roof band up, a tower top
 * a hundred metres below the camera is part of the view, not in the way of it.
 */
export const NEAR_CUT = {
  /** Fully gone nearer than this share of the altitude, or `maxM`. */
  share: 0.38,
  maxM: 44,
  /**
   * Fully there beyond this share, or `fadeMaxM`. A narrow band on purpose:
   * the dither is a grain, and spread over twenty metres it turned a whole
   * tower top into a screen door. Over five it is only the edge of the cut.
   */
  fadeShare: 0.45,
  fadeMaxM: 50,
} as const;

export function nearCutRange(altitudeM: number): { fromM: number; toM: number } {
  return {
    fromM: Math.min(altitudeM * NEAR_CUT.share, NEAR_CUT.maxM),
    toM: Math.min(altitudeM * NEAR_CUT.fadeShare, NEAR_CUT.fadeMaxM),
  };
}

export function detailFactor(fade: Fade, altitudeM: number): number {
  return smoothstep(fade.offM, fade.onM, altitudeM);
}

/**
 * Fog hides the edge of the world. three's Fog measures distance from the
 * camera, so the range has to grow with altitude: looking straight down from
 * 5 km the ground below is 5 km away and must still be sharp. These numbers are
 * tuned so haze starts a little past the mountain ring at every height and the
 * land dissolves before its rim is reached.
 */
export const FOG = {
  nearScale: 1.05,
  nearOffsetM: 350,
  farScale: 1.5,
  farOffsetM: 2600,
} as const;

/** How far out figures are worth drawing, for a camera at this height. */
export function drawRadius(altitudeM: number): number {
  return Math.min(AGENTS.drawRadiusM, Math.max(AGENTS.drawMinM, altitudeM * AGENTS.drawPerAltitude));
}

export function fogRange(altitudeM: number): { nearM: number; farM: number } {
  return {
    nearM: altitudeM * FOG.nearScale + FOG.nearOffsetM,
    farM: altitudeM * FOG.farScale + FOG.farOffsetM,
  };
}

/**
 * Where people and vehicles appear and what they turn into. Same rule as the
 * rest of this file: no metre threshold for agents lives anywhere else.
 */
export const AGENTS = {
  /**
   * Below this, people are walking figures. Above it they are dots.
   *
   * It sits on the roof band boundary on purpose. A person is roughly
   * 1450/altitude pixels tall, so three metres up from here a figure is three
   * pixels and its triangles buy nothing a dot does not give; and above the roof band you are looking at the town rather than at
   * anybody in it.
   */
  figuresMaxM: 300,
  /** Above this, people are not drawn at all. */
  peopleDotsMaxM: 1250,
  /** Below this, vehicles are boxes. Above it they are dots. */
  vehiclesMaxM: 1250,
  /** Above this, vehicles are not drawn at all. */
  vehicleDotsMaxM: 3500,
  /** Agents this close to the look-at point update every frame. */
  /**
   * Agents this close to the look-at point are updated every frame; the rest
   * take turns. 400 m was written for a city of radius 1400, where it meant a
   * small part of the town. In a settlement of 460 m it meant almost all of
   * it, and with twelve thousand people that came to 6.6 ms a frame against a
   * budget of 4.
   */
  nearM: 140,
  /** How often the rest update. One in this many frames. */
  farStride: 14,
  /**
   * Figures are only drawn within this of the look-at point, and the radius
   * comes down with the camera.
   *
   * A fixed 700 m was the whole settlement, so the cap on figures was spent on
   * people scattered across the town and only a handful of them landed in the
   * frame. At 70 m the HUD said 2400 figures were being drawn and you could
   * not see one, because the frame was about a hundred metres wide and held
   * roughly one per cent of them. Tying the radius to altitude spends the
   * budget on what is actually on screen.
   */
  drawRadiusM: 700,
  drawMinM: 90,
  drawPerAltitude: 3.2,
} as const;

/**
 * On foot (walk/, story/). The lowest altitude there is: a person's eyes.
 * Everything else in this file still applies at this height, which is the
 * point of keeping it here: the town at 1.6 m is the same town, with every
 * fade at its fullest and nothing left for the view from above to add.
 */
export const WALK = {
  /** Eyes above whatever is underfoot. */
  eyeM: 1.62,
  /** The disc a person takes up, for bumping into things (walk/body.ts). */
  radiusM: 0.35,
  /** A brisk walk, and a hurry. Faster than life: the town is small but a day is short. */
  speedMS: 2.9,
  hurryMS: 5.8,
  /** The camera's near plane on foot. Under the radius, so a wall touched is not cut open. */
  nearM: 0.25,
  /** Where "the point being looked at" is on foot, for systems that centre on one. */
  lookAheadM: 45,
  /** Figures are drawn this far from that point, which on foot is most of a street. */
  drawRadiusM: 170,
  /** Water this far in from the bank cannot be stood in. */
  shoreM: 1.2,
  /** Close enough to talk to somebody, and close enough to have arrived. */
  talkM: 4.2,
  arriveM: 7,
} as const;
