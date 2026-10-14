import { type Object3D, Quaternion, Vector3 } from 'three';

/**
 * Two-bone reach: puts a hand on a point by bending the elbow. The poses in
 * character/poses.ts are written joint by joint, which is right for a walk and
 * wrong for a hand that has to land on a desk or in a lap; there the hand's
 * place is what matters and the elbow follows. Works on the model's normalised
 * bones, whose rest rotations are all identity, so a bone's rest direction is
 * simply its child's offset.
 */
export interface Limb {
  upper: Object3D;
  lower: Object3D;
  hand: Object3D;
}

const shoulder = new Vector3();
const elbow = new Vector3();
const toTarget = new Vector3();
const bendTowards = new Vector3();
const scratch = new Vector3();
const rest = new Vector3();
const parentWorld = new Quaternion();
const solvedUpper = new Quaternion();
const solvedLower = new Quaternion();
const keepUpper = new Quaternion();
const keepLower = new Quaternion();

/** The local rotation that turns `bone` from its rest direction to point along `worldDir`. */
function aim(bone: Object3D, child: Object3D, worldDir: Vector3, out: Quaternion): Quaternion {
  const parent = bone.parent;
  if (parent) parent.getWorldQuaternion(parentWorld);
  else parentWorld.identity();
  rest.copy(child.position).normalize();
  scratch.copy(worldDir).applyQuaternion(parentWorld.invert()).normalize();
  return out.setFromUnitVectors(rest, scratch);
}

/**
 * Reaches `limb` for `target` (world), the elbow bending towards `pole` (a
 * world direction), blended over the pose the bones already hold by `weight`.
 * Out of reach, the arm points at the target at full stretch.
 */
export function reach(limb: Limb, target: Vector3, pole: Vector3, weight: number): void {
  if (weight <= 0) return;
  const { upper, lower, hand } = limb;
  const a = lower.position.length();
  const b = hand.position.length();
  upper.getWorldPosition(shoulder);
  toTarget.copy(target).sub(shoulder);
  const d = Math.min(Math.max(toTarget.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const u = toTarget.normalize();
  // The elbow lies in the plane of the arm and the pole, on the pole's side.
  bendTowards.copy(pole).addScaledVector(u, -pole.dot(u));
  if (bendTowards.lengthSq() < 1e-8) bendTowards.set(0, -1, 0).addScaledVector(u, u.y);
  bendTowards.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  elbow.copy(shoulder).addScaledVector(u, a * cosA).addScaledVector(bendTowards, a * sinA);

  keepUpper.copy(upper.quaternion);
  keepLower.copy(lower.quaternion);
  aim(upper, lower, toTarget.copy(elbow).sub(shoulder), solvedUpper);
  upper.quaternion.copy(solvedUpper);
  upper.updateMatrixWorld(true);
  aim(lower, hand, toTarget.copy(target).sub(elbow), solvedLower);
  upper.quaternion.copy(keepUpper).slerp(solvedUpper, weight);
  lower.quaternion.copy(keepLower).slerp(solvedLower, weight);
  upper.updateMatrixWorld(true);
}
