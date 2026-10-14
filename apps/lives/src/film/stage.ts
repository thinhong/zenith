import { angleDelta, clamp01, easeInOut, lerp, lerpAngle, type Vec3 } from '@/film/ease';

/**
 * Where things are in the room, and where the person is at any moment of a
 * shot. Pure: the room's layout is plain numbers, and the body's position,
 * heading and posture are worked out from a shot's list of segments.
 *
 * Metres, y up. The person faces +Z at yaw 0, so yaw PI faces the back wall,
 * where the window is. The open side of the room, where the camera usually
 * stands, is +Z.
 */
export const ROOM = {
  halfWidthM: 2.6,
  backZ: -2.1,
  frontZ: 2.2,
  heightM: 2.7,
  window: { x: -0.3, widthM: 1.4, sillM: 0.8, topM: 2.2 },
  desk: { x: 1.45, widthM: 1.2, depthM: 0.62, heightM: 0.74 },
} as const;

export interface Place {
  x: number;
  z: number;
  yaw: number;
}

export interface Seat extends Place {
  heightM: number;
  kind: 'desk' | 'armchair';
}

export const SEATS = {
  // Pulled in close enough that her forearms rest on the desk.
  desk: { x: 1.45, z: -1.1, yaw: Math.PI, heightM: 0.46, kind: 'desk' },
  armchair: { x: -1.62, z: -1.12, yaw: 2.2, heightM: 0.42, kind: 'armchair' },
} as const satisfies Record<string, Seat>;

export type SeatName = keyof typeof SEATS;

/** Standing in front of a seat is a little ahead of where the hips go when seated. */
function frontOf(seat: Seat, stepM: number): Place {
  return {
    x: seat.x + Math.sin(seat.yaw) * stepM,
    z: seat.z + Math.cos(seat.yaw) * stepM,
    yaw: seat.yaw,
  };
}

export const PLACES = {
  window: { x: -0.3, z: -1.62, yaw: Math.PI },
  /** The same spot, turned round to face into the room. */
  windowTurned: { x: -0.3, z: -1.62, yaw: 1.2 },
  /** Close enough to the sill for a child's hands to rest on it. */
  windowClose: { x: -0.3, z: -1.8, yaw: Math.PI },
  windowCloseTurned: { x: -0.3, z: -1.8, yaw: 1.2 },
  deskFront: frontOf(SEATS.desk, 0.2),
  armchairFront: frontOf(SEATS.armchair, 0.22),
  middle: { x: 0.3, z: -0.6, yaw: Math.PI * 0.85 },
} as const satisfies Record<string, Place>;

export type PlaceName = keyof typeof PLACES;

/** Points in the room a person or a camera can look at. */
export const MARKS = {
  window: [-0.3, 1.55, -2.6] as Vec3,
  windowLow: [-0.3, 1.25, -2.6] as Vec3,
  desk: [1.45, 0.76, -1.62] as Vec3,
  sky: [0.4, 3.6, -6] as Vec3,
} as const;

export type Segment =
  | { kind: 'stand'; atS: number; place: PlaceName }
  | { kind: 'walk'; atS: number; from: PlaceName; to: PlaceName }
  | { kind: 'turn'; atS: number; from: PlaceName; to: PlaceName }
  | { kind: 'sitDown'; atS: number; seat: SeatName }
  | { kind: 'sit'; atS: number; seat: SeatName }
  | { kind: 'standUp'; atS: number; seat: SeatName };

export interface BodyState {
  x: number;
  z: number;
  yaw: number;
  /** 0 standing, 1 seated. */
  sit: number;
  seat: SeatName | null;
  /** 0 standing still, 1 walking. */
  walk: number;
  /** Metres walked since this walk began, which sets the step cycle. */
  travelledM: number;
}

export const WALK = {
  /** Seconds spent turning on the spot at each end of a walk. */
  turnS: 0.45,
  /** Seconds to get into stride and out of it again. */
  rampS: 0.35,
} as const;

function segmentEnd(segments: readonly Segment[], index: number, shotS: number): number {
  return segments[index + 1]?.atS ?? shotS;
}

/**
 * Where the body is `localS` seconds into a shot of length `shotS`. Before the
 * first segment starts, the first segment holds.
 */
export function bodyAt(segments: readonly Segment[], localS: number, shotS: number): BodyState {
  const first = segments[0];
  if (!first) throw new Error('a shot with a person in it needs at least one segment');
  let index = 0;
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    if (seg && localS >= seg.atS) index = k;
  }
  const seg = segments[index] ?? first;
  const endS = segmentEnd(segments, index, shotS);
  const durS = Math.max(1e-3, endS - seg.atS);
  const t = clamp01((localS - seg.atS) / durS);

  switch (seg.kind) {
    case 'stand': {
      const p = PLACES[seg.place];
      return { x: p.x, z: p.z, yaw: p.yaw, sit: 0, seat: null, walk: 0, travelledM: 0 };
    }
    case 'sit': {
      const s = SEATS[seg.seat];
      return { x: s.x, z: s.z, yaw: s.yaw, sit: 1, seat: seg.seat, walk: 0, travelledM: 0 };
    }
    case 'sitDown':
    case 'standUp': {
      const s = SEATS[seg.seat];
      const front = frontOf(s, seg.seat === 'desk' ? 0.2 : 0.22);
      const k = easeInOut(seg.kind === 'sitDown' ? t : 1 - t);
      return {
        x: lerp(front.x, s.x, k),
        z: lerp(front.z, s.z, k),
        yaw: s.yaw,
        sit: k,
        seat: seg.seat,
        walk: 0,
        travelledM: 0,
      };
    }
    case 'turn': {
      // Turning round where she stands, with a small shift of the feet.
      const from = PLACES[seg.from];
      const to = PLACES[seg.to];
      const k = easeInOut(t);
      return {
        x: lerp(from.x, to.x, k),
        z: lerp(from.z, to.z, k),
        yaw: lerpAngle(from.yaw, to.yaw, k),
        sit: 0,
        seat: null,
        walk: Math.sin(Math.PI * t) * 0.2,
        travelledM: t * 0.35,
      };
    }
    case 'walk': {
      const from = PLACES[seg.from];
      const to = PLACES[seg.to];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const distanceM = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      const elapsedS = localS - seg.atS;
      const walkS = Math.max(0.3, durS - WALK.turnS * 2);
      // Turn to face the way, walk, then turn to face the way the place faces.
      if (elapsedS < WALK.turnS) {
        const k = easeInOut(elapsedS / WALK.turnS);
        return { x: from.x, z: from.z, yaw: lerpAngle(from.yaw, heading, k), sit: 0, seat: null, walk: k * 0.25, travelledM: 0 };
      }
      const walkedS = elapsedS - WALK.turnS;
      if (walkedS < walkS) {
        const k = walkedS / walkS;
        // Gentle start and stop: the distance follows an eased curve.
        const along = easeInOut(k) * 0.7 + k * 0.3;
        const ramp = Math.min(1, walkedS / WALK.rampS, (walkS - walkedS) / WALK.rampS);
        return {
          x: from.x + dx * along,
          z: from.z + dz * along,
          yaw: heading,
          sit: 0,
          seat: null,
          walk: 0.25 + 0.75 * clamp01(ramp),
          travelledM: distanceM * along,
        };
      }
      const k = easeInOut((walkedS - walkS) / WALK.turnS);
      return { x: to.x, z: to.z, yaw: lerpAngle(heading, to.yaw, k), sit: 0, seat: null, walk: (1 - k) * 0.25, travelledM: distanceM };
    }
  }
}

/** How far the body turns in one segment: used by tests to catch a spin the long way round. */
export function turnSize(a: number, b: number): number {
  return Math.abs(angleDelta(a, b));
}

/** What the face shows, each 0 to 1. */
export interface Face {
  happy: number;
  relaxed: number;
  sad: number;
  /** Eyes shut on purpose, as opposed to a blink. */
  closed: number;
}

export type FaceKey = { atS: number } & Partial<Face>;

const NEUTRAL: Face = { happy: 0, relaxed: 0, sad: 0, closed: 0 };

/** The face at a moment: each value eases from one key to the next and holds after the last. */
export function faceAt(keys: readonly FaceKey[], localS: number): Face {
  if (keys.length === 0) return NEUTRAL;
  const valueAt = (name: keyof Face): number => {
    let before: { atS: number; v: number } | null = null;
    let after: { atS: number; v: number } | null = null;
    for (const key of keys) {
      const v = key[name];
      if (v === undefined) continue;
      if (key.atS <= localS) before = { atS: key.atS, v };
      else if (after === null) after = { atS: key.atS, v };
    }
    if (before === null) return after?.v ?? 0;
    if (after === null) return before.v;
    return lerp(before.v, after.v, easeInOut((localS - before.atS) / (after.atS - before.atS)));
  };
  return { happy: valueAt('happy'), relaxed: valueAt('relaxed'), sad: valueAt('sad'), closed: valueAt('closed') };
}

/** Where the eyes and head go. 'camera' means the lens. */
export type GazeTarget = Vec3 | 'camera';
export interface GazeKey {
  atS: number;
  at: GazeTarget;
}

/** The gaze key in force at a moment, the one before it, and how far the turn between them has got. */
export function gazeAt(
  keys: readonly GazeKey[],
  localS: number,
  turnS: number,
): { from: GazeTarget | null; to: GazeTarget | null; k: number } {
  let current = -1;
  keys.forEach((key, i) => {
    if (key.atS <= localS) current = i;
  });
  if (current < 0) return { from: null, to: keys[0]?.at ?? null, k: 1 };
  const key = keys[current];
  if (!key) return { from: null, to: null, k: 1 };
  const previous = keys[current - 1];
  const k = clamp01((localS - key.atS) / turnS);
  return { from: previous?.at ?? key.at, to: key.at, k: easeInOut(k) };
}
