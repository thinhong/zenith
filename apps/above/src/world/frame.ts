import type { Structure } from '@/world/eras';
import { axesOf } from '@/world/geometry2d';

/**
 * A lot's own frame. Everything that stands on a lot (its roof, its balconies,
 * the wall round its yard, the rooms inside it, the people in them) was first
 * written for lots that all faced the same way, north-south on one grid.
 *
 * The planner now lays streets at any angle and turns each lot to face its
 * street, so those modules keep working in the frame they always used, as if
 * the lot were unturned about its own centre, and this turns the result into
 * the world. One transform in one place, rather than a rotation threaded
 * through every placement in five files.
 */
export interface Frame {
  x: number;
  z: number;
  rotY: number;
}

/** A point given as an offset along the lot's own x and z, in the world. */
export function toWorld(frame: Frame, localX: number, localZ: number): { x: number; z: number } {
  const { ux, uz, vx, vz } = axesOf(frame.rotY);
  return { x: frame.x + localX * ux + localZ * vx, z: frame.z + localX * uz + localZ * vz };
}

/** A world point as an offset along the lot's own x and z. */
export function toLocal(frame: Frame, x: number, z: number): { x: number; z: number } {
  const { ux, uz, vx, vz } = axesOf(frame.rotY);
  const dx = x - frame.x;
  const dz = z - frame.z;
  return { x: dx * ux + dz * uz, z: dx * vx + dz * vz };
}

/** A world direction in the lot's own frame. */
export function directionToLocal(frame: Frame, dx: number, dz: number): { x: number; z: number } {
  const { ux, uz, vx, vz } = axesOf(frame.rotY);
  return { x: dx * ux + dz * uz, z: dx * vx + dz * vz };
}

/**
 * Turns structures laid out round an unturned lot into the lot's real frame:
 * each one's position is swung about the lot's centre and its own turn gains
 * the lot's. `from` is the first index that belongs to this lot.
 */
export function orientToFrame(out: Structure[], from: number, frame: Frame): void {
  if (frame.rotY === 0) return;
  const { ux, uz, vx, vz } = axesOf(frame.rotY);
  for (let i = from; i < out.length; i++) {
    const piece = out[i];
    if (!piece) continue;
    const dx = piece.x - frame.x;
    const dz = piece.z - frame.z;
    piece.x = frame.x + dx * ux + dz * vx;
    piece.z = frame.z + dx * uz + dz * vz;
    piece.rotY += frame.rotY;
  }
}
