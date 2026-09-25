import { clamp01, lerp } from '@/film/ease';

/**
 * The body's poses, written by hand as rotations of the model's normalised
 * bones. Pure: plain numbers in, plain numbers out, tested without a GPU.
 *
 * The frame these numbers live in is three-vrm's normalised rig: every bone
 * starts at rest in a T-pose with no rotation, its axes lined up with the
 * world, and the person facing +Z. Each rotation is an Euler triple in
 * three's default XYZ order, which applies Z first, then Y, then X, all about
 * the parent's axes. With the person facing +Z, their left is +X, so:
 *
 * - An arm comes down to the side about Z: the left arm by a negative angle,
 *   the right by a positive one. It then swings forward about X by a negative
 *   angle.
 * - An elbow bends the forearm forward about Y: negative on the left,
 *   positive on the right.
 * - A thigh swings forward about X by a negative angle; a knee bends back by a
 *   positive one; a foot points its toes down by a positive one.
 * - The spine, neck and head bend forward by a positive X, turn to the left by
 *   a positive Y, and tilt towards the right shoulder by a positive Z.
 *
 * These are the only conventions the rest of the file relies on, and the
 * tests check the ones that are easy to get backwards.
 */

export type Euler3 = readonly [number, number, number];

export type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg'
  | 'leftFoot'
  | 'rightFoot'
  | FingerBone;

type Side = 'left' | 'right';
type Finger = 'Index' | 'Middle' | 'Ring' | 'Little';
type Joint = 'Proximal' | 'Intermediate' | 'Distal';
export type FingerBone = `${Side}${Finger}${Joint}` | `${Side}Thumb${'Metacarpal' | 'Proximal' | 'Distal'}`;

export type Pose = Partial<Record<BoneName, Euler3>>;

/** A pose, and how far the hips sit from where they rest in the T-pose. */
export interface PoseFrame {
  pose: Pose;
  /** Metres to move the hips, in the person's own frame: up is +y, forward is +z. */
  hipsOffset: readonly [number, number];
}

/** The model's legs, in metres, read from the model at load time. */
export interface Legs {
  /** Height of the hip joint above the floor, standing. */
  hipsM: number;
  thighM: number;
  shinM: number;
}

export const DEFAULT_LEGS: Legs = { hipsM: 0.908, thighM: 0.353, shinM: 0.414 };

const FINGERS: readonly Finger[] = ['Index', 'Middle', 'Ring', 'Little'];

/**
 * Fingers are straight in the T-pose, and a straight hand reads as a mannequin.
 * A hand at rest curls a little, the little finger most.
 */
export function relaxedHands(curl: number): Pose {
  const pose: Pose = {};
  FINGERS.forEach((finger, k) => {
    const c = curl * (0.8 + k * 0.12);
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? -1 : 1;
      pose[`${side}${finger}Proximal`] = [0, 0, s * c * 0.8];
      pose[`${side}${finger}Intermediate`] = [0, 0, s * c * 1.1];
      pose[`${side}${finger}Distal`] = [0, 0, s * c * 0.7];
    }
  });
  pose.leftThumbProximal = [0, 0.25 * curl, 0];
  pose.rightThumbProximal = [0, -0.25 * curl, 0];
  return pose;
}

export interface StandOptions {
  /** -1..1 through a breath. */
  breath: number;
  /** -1..1 slow weight shift from foot to foot. */
  sway: number;
  /** 0 straight to 1 an old back (life/age.ts). */
  stoop: number;
}

export function standPose({ breath, sway, stoop }: StandOptions): PoseFrame {
  const bend = stoop;
  return {
    pose: {
      ...relaxedHands(0.35),
      hips: [0, 0, sway * 0.025],
      spine: [0.02 + bend * 0.2, 0, -sway * 0.015],
      chest: [breath * 0.012 + bend * 0.16, 0, 0],
      upperChest: [breath * 0.01 + bend * 0.08, 0, 0],
      neck: [bend * 0.24, 0, 0],
      // The head lifts back up so an old person still looks ahead, not at the floor.
      head: [0.02 - bend * 0.3, 0, sway * 0.02],
      leftShoulder: [0, 0, -0.02 - breath * 0.012 - bend * 0.05],
      rightShoulder: [0, 0, 0.02 + breath * 0.012 + bend * 0.05],
      leftUpperArm: [-0.05 - bend * 0.18, 0, -1.22],
      rightUpperArm: [-0.05 - bend * 0.18, 0, 1.22],
      leftLowerArm: [0, -0.2 - bend * 0.25, 0],
      rightLowerArm: [0, 0.2 + bend * 0.25, 0],
      leftUpperLeg: [-0.02 - bend * 0.08 - Math.max(0, -sway) * 0.05, 0, 0],
      rightUpperLeg: [-0.02 - bend * 0.08 - Math.max(0, sway) * 0.05, 0, 0],
      leftLowerLeg: [0.03 + bend * 0.16 + Math.max(0, -sway) * 0.1, 0, 0],
      rightLowerLeg: [0.03 + bend * 0.16 + Math.max(0, sway) * 0.1, 0, 0],
      leftFoot: [-0.01 - bend * 0.08, 0, 0],
      rightFoot: [-0.01 - bend * 0.08, 0, 0],
    },
    hipsOffset: [-0.004 - bend * 0.035, bend * -0.02],
  };
}

export interface WalkOptions {
  /** 0..1 through one full cycle of two steps. The left foot is mid-swing at 0. */
  phase: number;
  /** How far a thigh swings each way, in radians. Smaller when old. */
  stride: number;
  stoop: number;
}

/** One cycle of two steps covers about this far per radian of stride, in metres. */
export const CYCLE_M_PER_RAD = 3.1;

/** Distance covered in one full cycle at this stride. */
export function cycleLength(stride: number): number {
  return Math.max(0.2, stride * CYCLE_M_PER_RAD);
}

export function walkPose({ phase, stride, stoop }: WalkOptions): PoseFrame {
  const a = stride;
  const turn = Math.PI * 2 * phase;
  const s = Math.sin(turn);
  const c = Math.cos(turn);
  // Each knee folds while its foot swings through, most at mid-swing.
  const swingLeft = Math.max(0, c) ** 1.5;
  const swingRight = Math.max(0, -c) ** 1.5;
  const knee = 0.4 + a * 1.9;
  const arm = a * 0.75;
  const bend = stoop;
  return {
    pose: {
      ...relaxedHands(0.4),
      hips: [0.03, -a * 0.3 * s, 0],
      spine: [0.04 + bend * 0.22, a * 0.22 * s, 0],
      chest: [0.02 + bend * 0.16, a * 0.2 * s, 0],
      upperChest: [bend * 0.08, 0, 0],
      neck: [bend * 0.24, -a * 0.08 * s, 0],
      head: [-0.03 - bend * 0.32, -a * 0.06 * s, 0],
      leftShoulder: [0, 0, -0.02 - bend * 0.05],
      rightShoulder: [0, 0, 0.02 + bend * 0.05],
      leftUpperArm: [arm * s - bend * 0.15, 0, -1.2],
      rightUpperArm: [-arm * s - bend * 0.15, 0, 1.2],
      leftLowerArm: [0, -0.28 - 0.35 * Math.max(0, -s) - bend * 0.25, 0],
      rightLowerArm: [0, 0.28 + 0.35 * Math.max(0, s) + bend * 0.25, 0],
      leftUpperLeg: [-a * s - 0.06 - bend * 0.08, 0, 0],
      rightUpperLeg: [a * s - 0.06 - bend * 0.08, 0, 0],
      leftLowerLeg: [0.1 + knee * swingLeft + bend * 0.14, 0, 0],
      rightLowerLeg: [0.1 + knee * swingRight + bend * 0.14, 0, 0],
      leftFoot: [-0.25 * swingLeft + 0.3 * Math.max(0, -s) * (1 - swingLeft), 0, 0],
      rightFoot: [-0.25 * swingRight + 0.3 * Math.max(0, s) * (1 - swingRight), 0, 0],
    },
    // The body is highest when one leg stands straight under it, twice a cycle.
    hipsOffset: [-0.02 - a * 0.07 * (1 - Math.cos(turn * 2)) * 0.5 - bend * 0.04, 0],
  };
}

export type SeatKind = 'desk' | 'armchair';

export interface SitOptions {
  kind: SeatKind;
  /** Height of the seat's top above the floor. */
  seatM: number;
  legs: Legs;
  breath: number;
  stoop: number;
  /** 0..1 through a small writing movement of the right hand, at the desk only. */
  write: number;
  /** 0 looking at the desk, 1 head up and looking ahead. */
  headUp: number;
}

export function sitPose(options: SitOptions): PoseFrame {
  const { kind, seatM, legs, breath, stoop, write, headUp } = options;
  // The hip joint sits about a hand's width above the seat.
  const hipsY = seatM + 0.1;
  const drop = hipsY - legs.hipsM;
  // The knee is as high as the shin is long, plus the ankle; the thigh runs
  // from the hip joint to it, a little up on a low seat, a little down on a
  // high one. A thigh level ahead is -PI/2; tilting its knee up takes it past.
  const kneeY = legs.shinM + 0.09;
  const thighTilt = Math.asin(Math.max(-0.9, Math.min(0.9, (kneeY - (hipsY - 0.04)) / legs.thighM)));
  const thigh = -Math.PI / 2 - thighTilt;
  // The shin undoes the thigh's turn to hang straight down, less a little so
  // the feet rest slightly forward.
  const shin = Math.PI / 2 + thighTilt - 0.1;
  const bend = stoop;
  const w = Math.sin(Math.PI * 2 * write);

  const base: Pose = {
    ...relaxedHands(0.45),
    leftUpperLeg: [thigh, 0, 0.08],
    rightUpperLeg: [thigh, 0, -0.08],
    leftLowerLeg: [shin, 0, 0],
    rightLowerLeg: [shin, 0, 0],
    leftFoot: [0.02, 0, 0],
    rightFoot: [0.02, 0, 0],
  };

  if (kind === 'desk') {
    const down = 1 - clamp01(headUp);
    return {
      pose: {
        ...base,
        hips: [0.05, 0, 0],
        spine: [0.1 + bend * 0.12, 0, 0],
        chest: [0.08 + breath * 0.01 + bend * 0.1, 0, 0],
        upperChest: [0.04 + bend * 0.06, 0, 0],
        neck: [lerp(0.04, 0.16, down) + bend * 0.1, 0, 0],
        head: [lerp(-0.12, 0.3, down) - bend * 0.12, 0, 0],
        leftShoulder: [0, 0, -0.02],
        rightShoulder: [0, 0, 0.02],
        // Both forearms rest on the desk, the right hand writing.
        leftUpperArm: [-0.8, 0.1, -1.0],
        rightUpperArm: [-0.82 + w * 0.02, -0.1, 1.0],
        leftLowerArm: [0, -1.25, 0],
        rightLowerArm: [0, 1.2 + w * 0.05, 0],
        leftHand: [0, 0, 0.1],
        rightHand: [w * 0.08, 0, -0.1 + w * 0.06],
      },
      hipsOffset: [drop, -0.02],
    };
  }

  return {
    pose: {
      ...base,
      // An armchair lets the back rest; age pulls the shoulders forward again.
      hips: [-0.06, 0, 0],
      spine: [-0.06 + bend * 0.2, 0, 0],
      chest: [-0.02 + breath * 0.014 + bend * 0.12, 0, 0],
      upperChest: [bend * 0.06, 0, 0],
      neck: [0.06 + bend * 0.16, 0, 0],
      head: [0.02 - bend * 0.14 - headUp * 0.08, 0, 0],
      leftShoulder: [0, 0, -0.02],
      rightShoulder: [0, 0, 0.02],
      // Hands in the lap.
      leftUpperArm: [-0.5, 0.15, -1.18],
      rightUpperArm: [-0.5, -0.15, 1.18],
      leftLowerArm: [0, -1.1, 0],
      rightLowerArm: [0, 1.1, 0],
      leftHand: [0, 0, 0.15],
      rightHand: [0, 0, -0.15],
    },
    hipsOffset: [drop, -0.03],
  };
}

/** Every bone named in either pose, blended from a to b. Missing bones count as no rotation. */
export function blendFrames(a: PoseFrame, b: PoseFrame, weight: number): PoseFrame {
  const w = clamp01(weight);
  const names = new Set<BoneName>([...(Object.keys(a.pose) as BoneName[]), ...(Object.keys(b.pose) as BoneName[])]);
  const pose: Pose = {};
  const zero: Euler3 = [0, 0, 0];
  for (const name of names) {
    const ea = a.pose[name] ?? zero;
    const eb = b.pose[name] ?? zero;
    pose[name] = [lerp(ea[0], eb[0], w), lerp(ea[1], eb[1], w), lerp(ea[2], eb[2], w)];
  }
  return {
    pose,
    hipsOffset: [lerp(a.hipsOffset[0], b.hipsOffset[0], w), lerp(a.hipsOffset[1], b.hipsOffset[1], w)],
  };
}
