import { describe, expect, it } from 'vitest';
import { blendFrames, cycleLength, DEFAULT_LEGS, relaxedHands, sitPose, standPose, walkPose } from './poses';

const x = (e: readonly [number, number, number] | undefined): number => e?.[0] ?? Number.NaN;
const y = (e: readonly [number, number, number] | undefined): number => e?.[1] ?? Number.NaN;
const z = (e: readonly [number, number, number] | undefined): number => e?.[2] ?? Number.NaN;

describe('standPose', () => {
  it('brings both arms down to the sides from the T-pose', () => {
    const { pose } = standPose({ breath: 0, sway: 0, stoop: 0 });
    expect(z(pose.leftUpperArm)).toBeLessThan(-1);
    expect(z(pose.rightUpperArm)).toBeGreaterThan(1);
  });

  it('bends an old back forward and lifts the head to look ahead', () => {
    const young = standPose({ breath: 0, sway: 0, stoop: 0 }).pose;
    const old = standPose({ breath: 0, sway: 0, stoop: 1 }).pose;
    expect(x(old.spine)).toBeGreaterThan(x(young.spine));
    expect(x(old.neck)).toBeGreaterThan(x(young.neck));
    expect(x(old.head)).toBeLessThan(x(young.head));
  });
});

describe('walkPose', () => {
  it('swings the legs in turn', () => {
    const a = walkPose({ phase: 0.25, stride: 0.4, stoop: 0 }).pose;
    expect(x(a.leftUpperLeg)).toBeLessThan(0);
    expect(x(a.rightUpperLeg)).toBeGreaterThan(-0.1);
    const b = walkPose({ phase: 0.75, stride: 0.4, stoop: 0 }).pose;
    expect(x(b.rightUpperLeg)).toBeLessThan(0);
  });

  it('swings each arm forward with the opposite leg', () => {
    const rightLegForward = walkPose({ phase: 0.75, stride: 0.4, stoop: 0 }).pose;
    expect(x(rightLegForward.leftUpperArm)).toBeLessThan(0);
    expect(x(rightLegForward.rightUpperArm)).toBeGreaterThan(0);
  });

  it('folds the knee of the swinging leg, not the standing one', () => {
    const midSwingLeft = walkPose({ phase: 0, stride: 0.4, stoop: 0 }).pose;
    expect(x(midSwingLeft.leftLowerLeg)).toBeGreaterThan(x(midSwingLeft.rightLowerLeg) + 0.5);
  });

  it('covers more ground with a longer stride', () => {
    expect(cycleLength(0.4)).toBeGreaterThan(cycleLength(0.2));
  });
});

describe('sitPose', () => {
  for (const kind of ['desk', 'armchair'] as const) {
    it(`puts the hips on the seat with level thighs and hanging shins (${kind})`, () => {
      const seatM = 0.45;
      const frame = sitPose({ kind, seatM, legs: DEFAULT_LEGS, breath: 0, stoop: 0, write: 0, headUp: 0 });
      expect(DEFAULT_LEGS.hipsM + frame.hipsOffset[0]).toBeCloseTo(seatM + 0.1, 5);
      const thigh = x(frame.pose.leftUpperLeg);
      const shin = x(frame.pose.leftLowerLeg);
      expect(Math.abs(thigh + Math.PI / 2)).toBeLessThan(0.25);
      // The shin's rotation undoes the thigh's, less a small forward lean.
      expect(thigh + shin).toBeCloseTo(-0.1, 5);
    });
  }

  it('reaches both forearms forward onto the desk', () => {
    const { pose } = sitPose({ kind: 'desk', seatM: 0.46, legs: DEFAULT_LEGS, breath: 0, stoop: 0, write: 0, headUp: 0 });
    expect(x(pose.leftUpperArm)).toBeLessThan(-0.5);
    expect(y(pose.leftLowerArm)).toBeLessThan(-1);
    expect(y(pose.rightLowerArm)).toBeGreaterThan(1);
  });
});

describe('relaxedHands', () => {
  it('curls fingers towards the palm on both hands', () => {
    const pose = relaxedHands(0.5);
    expect(z(pose.leftIndexProximal)).toBeLessThan(0);
    expect(z(pose.rightIndexProximal)).toBeGreaterThan(0);
    expect(Math.abs(z(pose.leftLittleProximal))).toBeGreaterThan(Math.abs(z(pose.leftIndexProximal)));
  });
});

describe('blendFrames', () => {
  it('returns each end at 0 and 1 and the average between', () => {
    const a = standPose({ breath: 0, sway: 0, stoop: 0 });
    const b = sitPose({ kind: 'armchair', seatM: 0.42, legs: DEFAULT_LEGS, breath: 0, stoop: 0, write: 0, headUp: 0 });
    expect(blendFrames(a, b, 0).pose.leftUpperLeg).toEqual(a.pose.leftUpperLeg);
    expect(blendFrames(a, b, 1).pose.leftUpperLeg).toEqual(b.pose.leftUpperLeg);
    const mid = blendFrames(a, b, 0.5);
    expect(x(mid.pose.leftUpperLeg)).toBeCloseTo((x(a.pose.leftUpperLeg) + x(b.pose.leftUpperLeg)) / 2);
    expect(mid.hipsOffset[0]).toBeCloseTo((a.hipsOffset[0] + b.hipsOffset[0]) / 2);
  });

  it('treats a bone only one pose names as unrotated in the other', () => {
    const a = { pose: { head: [0.4, 0, 0] as const }, hipsOffset: [0, 0] as const };
    const b = { pose: {}, hipsOffset: [0, 0] as const };
    expect(x(blendFrames(a, b, 0.5).pose.head)).toBeCloseTo(0.2);
  });
});
