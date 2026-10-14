import type { Vec3 } from '@/film/ease';
import { MARKS, type FaceKey, type GazeKey, type Segment } from '@/film/stage';
import type { ShotTiming } from '@/film/timeline';

/**
 * The film: one life in ten shots, about eighty seconds, in one room.
 *
 * The grammar is the life montage of animated film: the same room across the
 * years, the same window, the same framing used twice so the cut between them
 * is the passing of fifty years. Everything is shown and nothing is said.
 *
 * 1 child     A child at the window in spring, who turns and smiles.
 * 2 grown     Cut: grown up, she crosses the room and sits at her desk.
 * 3 young     Close: she looks up from her work at the window.
 * 4 years     Time-lapse: days and seasons race past the window; the tree
 *             grows, the lamp comes on and goes off, her hair turns silver.
 * 5 old       The same close as 3, fifty years on: glasses, silver hair.
 * 6 across    She stands, slowly, and crosses to the armchair.
 * 7 rest      Sunset on her face. Her eyes close.
 * 8 light     A small light rises from her.
 * 9 leave     It crosses the room and leaves by the window.
 * 10 dawn     Morning in the empty room. Then the next life begins.
 */

export interface Frame {
  pos: Vec3;
  look: Vec3;
  fovDeg: number;
}

export interface CameraMove {
  from: Frame;
  /** Where the camera ends up. Absent for a locked-off shot. */
  to?: Frame;
  /** Metres of slow hand-held drift. 0 for a locked-off shot. */
  drift: number;
  /** Look at the light instead of `look` (shot 8). */
  followSoul?: boolean;
}

export interface Shot extends ShotTiming {
  camera: CameraMove;
  /** Her age in years at the start and the end of the shot. */
  age: readonly [number, number];
  /** Hour of the day at the start and the end. Runs past 24 in the time-lapse. */
  hour: readonly [number, number];
  /** Years since the story began at the start and the end: sets the season. */
  year: readonly [number, number];
  body: readonly Segment[];
  face: readonly FaceKey[];
  gaze: readonly GazeKey[];
  /** What is sharp: her face, the light that leaves her, or a point in the room. */
  focus: 'face' | 'soul' | Vec3;
  /** Wind in her hair from the open window, 0 to 1. */
  wind: number;
  /** The small light that leaves her (shots 8 and 9). */
  soul?: boolean;
  /** Seconds of the light's path already gone by when this shot starts. */
  soulOffsetS?: number;
  /** She is not in this shot. */
  empty?: boolean;
  /** Head up from the desk in the time-lapse: follows the day. */
  deskHeadFollowsDay?: boolean;
  /** Stops breathing: the body is still. */
  still?: boolean;
  /** The desk lamp stays off, whatever the hour: nobody is at the desk. */
  lampOff?: boolean;
}

// From the window side of the desk, so the window is the key light on her face.
const DESK_CLOSE: Frame = { pos: [0.52, 1.23, -1.68], look: [1.42, 1.1, -1.14], fovDeg: 33 };
const DESK_CLOSE_IN: Frame = { pos: [0.6, 1.22, -1.62], look: [1.42, 1.1, -1.14], fovDeg: 30 };

export const SHOTS: readonly Shot[] = [
  {
    id: 'child',
    durationS: 8,
    fadeInS: 2.5,
    camera: {
      from: { pos: [1.05, 1.02, -0.95], look: [-0.35, 1.0, -1.95], fovDeg: 40 },
      to: { pos: [0.82, 1.0, -1.12], look: [-0.34, 0.98, -1.9], fovDeg: 36 },
      drift: 0.012,
    },
    age: [7, 7],
    hour: [7.3, 7.55],
    year: [0.08, 0.085],
    body: [
      { kind: 'stand', atS: 0, place: 'windowClose' },
      { kind: 'turn', atS: 3.9, from: 'windowClose', to: 'windowCloseTurned' },
      { kind: 'stand', atS: 5.3, place: 'windowCloseTurned' },
    ],
    face: [{ atS: 0, happy: 0 }, { atS: 4.9, happy: 0 }, { atS: 5.9, happy: 0.85 }],
    gaze: [
      { atS: 0, at: MARKS.windowLow },
      { atS: 4.2, at: 'camera' },
    ],
    focus: 'face',
    wind: 0.7,
  },
  {
    id: 'grown',
    durationS: 8,
    camera: {
      from: { pos: [2.1, 1.55, 1.95], look: [0.1, 1.0, -1.3], fovDeg: 42 },
      to: { pos: [1.85, 1.5, 1.6], look: [0.75, 0.95, -1.35], fovDeg: 40 },
      drift: 0.015,
    },
    age: [19, 19],
    hour: [8.0, 8.2],
    year: [12.1, 12.1],
    body: [
      { kind: 'stand', atS: 0, place: 'window' },
      { kind: 'walk', atS: 1.0, from: 'window', to: 'deskFront' },
      { kind: 'sitDown', atS: 5.6, seat: 'desk' },
      { kind: 'sit', atS: 7.0, seat: 'desk' },
    ],
    face: [{ atS: 0, relaxed: 0.2 }],
    gaze: [
      { atS: 0, at: MARKS.window },
      { atS: 1.2, at: [1.45, 0.9, -1.4] },
      { atS: 6.8, at: MARKS.desk },
    ],
    focus: [0.9, 1.0, -1.2],
    wind: 0.3,
  },
  {
    id: 'young',
    durationS: 6,
    camera: { from: DESK_CLOSE, to: DESK_CLOSE_IN, drift: 0.006 },
    age: [19, 19],
    hour: [8.4, 8.55],
    year: [12.12, 12.12],
    body: [{ kind: 'sit', atS: 0, seat: 'desk' }],
    face: [{ atS: 0, relaxed: 0, happy: 0 }, { atS: 2.6, relaxed: 0.3, happy: 0.35 }],
    gaze: [
      { atS: 0, at: MARKS.desk },
      { atS: 1.8, at: MARKS.window },
    ],
    focus: 'face',
    wind: 0.2,
  },
  {
    id: 'years',
    durationS: 16,
    camera: {
      from: { pos: [-0.42, 1.32, 0.8], look: [0.95, 0.98, -1.55], fovDeg: 45 },
      drift: 0,
    },
    age: [20, 71],
    // Ten days and five years in sixteen seconds.
    hour: [8.6, 8.6 + 24 * 10],
    year: [12.14, 17.1],
    body: [{ kind: 'sit', atS: 0, seat: 'desk' }],
    face: [],
    gaze: [{ atS: 0, at: MARKS.desk }],
    focus: [1.2, 1.0, -1.4],
    wind: 0,
    deskHeadFollowsDay: true,
  },
  {
    id: 'old',
    durationS: 6,
    camera: { from: DESK_CLOSE, to: DESK_CLOSE_IN, drift: 0.006 },
    age: [72, 72],
    hour: [16.9, 17.05],
    year: [17.12, 17.12],
    body: [{ kind: 'sit', atS: 0, seat: 'desk' }],
    face: [{ atS: 0, relaxed: 0.1 }, { atS: 2.8, relaxed: 0.55, happy: 0.2 }],
    gaze: [
      { atS: 0, at: MARKS.desk },
      { atS: 2.1, at: MARKS.window },
    ],
    focus: 'face',
    wind: 0.15,
  },
  {
    id: 'across',
    durationS: 10,
    camera: {
      from: { pos: [0.3, 1.5, 2.0], look: [0.1, 0.95, -1.2], fovDeg: 44 },
      to: { pos: [-0.15, 1.45, 1.75], look: [-0.9, 0.9, -1.3], fovDeg: 42 },
      drift: 0.015,
    },
    age: [72, 72],
    hour: [17.3, 17.6],
    year: [17.13, 17.13],
    body: [
      { kind: 'sit', atS: 0, seat: 'desk' },
      { kind: 'standUp', atS: 0.4, seat: 'desk' },
      { kind: 'walk', atS: 2.8, from: 'deskFront', to: 'armchairFront' },
      { kind: 'sitDown', atS: 7.7, seat: 'armchair' },
      { kind: 'sit', atS: 9.8, seat: 'armchair' },
    ],
    face: [{ atS: 0, relaxed: 0.4 }],
    gaze: [
      { atS: 0, at: MARKS.window },
      { atS: 3.0, at: [-1.4, 0.8, -1.3] },
      { atS: 8.8, at: MARKS.window },
    ],
    focus: [-0.5, 1.0, -1.1],
    wind: 0.2,
  },
  {
    id: 'rest',
    lampOff: true,
    durationS: 9,
    camera: {
      from: { pos: [-0.66, 1.17, -1.66], look: [-1.52, 1.0, -1.1], fovDeg: 30 },
      to: { pos: [-0.74, 1.15, -1.6], look: [-1.52, 1.0, -1.1], fovDeg: 27 },
      drift: 0.006,
    },
    age: [72, 72],
    hour: [18.25, 19.3],
    year: [17.14, 17.14],
    body: [{ kind: 'sit', atS: 0, seat: 'armchair' }],
    face: [
      { atS: 0, relaxed: 0.5, closed: 0 },
      { atS: 3.5, relaxed: 0.7, happy: 0.15, closed: 0 },
      { atS: 7.2, relaxed: 0.8, happy: 0.1, closed: 1 },
    ],
    gaze: [{ atS: 0, at: MARKS.window }],
    focus: 'face',
    wind: 0.25,
  },
  {
    id: 'light',
    lampOff: true,
    durationS: 4.5,
    camera: {
      from: { pos: [-0.74, 1.15, -1.6], look: [-1.52, 1.0, -1.1], fovDeg: 27 },
      to: { pos: [-0.62, 1.2, -1.52], look: [-1.5, 1.3, -1.12], fovDeg: 31 },
      drift: 0.006,
      followSoul: true,
    },
    age: [72, 72],
    hour: [19.3, 19.5],
    year: [17.14, 17.14],
    body: [{ kind: 'sit', atS: 0, seat: 'armchair' }],
    face: [{ atS: 0, relaxed: 0.8, happy: 0.1, closed: 1 }],
    gaze: [{ atS: 0, at: MARKS.window }],
    focus: 'soul',
    wind: 0,
    soul: true,
    soulOffsetS: 0,
    still: true,
  },
  {
    id: 'leave',
    lampOff: true,
    durationS: 7,
    fadeOutS: 2.5,
    camera: {
      from: { pos: [0.95, 1.1, 0.35], look: [-0.5, 1.45, -1.8], fovDeg: 44 },
      to: { pos: [0.8, 1.02, 0.1], look: [-0.2, 2.2, -2.9], fovDeg: 44 },
      drift: 0.01,
      followSoul: true,
    },
    age: [72, 72],
    hour: [19.5, 19.95],
    year: [17.14, 17.14],
    body: [{ kind: 'sit', atS: 0, seat: 'armchair' }],
    face: [{ atS: 0, relaxed: 0.8, happy: 0.1, closed: 1 }],
    gaze: [{ atS: 0, at: MARKS.window }],
    focus: 'soul',
    wind: 0,
    soul: true,
    soulOffsetS: 4.5,
    still: true,
  },
  {
    id: 'dawn',
    lampOff: true,
    durationS: 7,
    fadeInS: 2.5,
    fadeOutS: 2.5,
    camera: {
      from: { pos: [0.9, 1.35, 0.9], look: [-0.9, 1.1, -1.6], fovDeg: 42 },
      to: { pos: [0.6, 1.33, 0.4], look: [-0.7, 1.15, -1.7], fovDeg: 40 },
      drift: 0.01,
    },
    age: [72, 72],
    hour: [6.3, 6.9],
    year: [18.08, 18.08],
    body: [{ kind: 'stand', atS: 0, place: 'window' }],
    face: [],
    gaze: [],
    focus: [-1.2, 0.9, -1.4],
    wind: 0,
    empty: true,
  },
];
