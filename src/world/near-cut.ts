import { cameraPosition, interleavedGradientNoise, positionWorld, screenCoordinate, smoothstep, uniform } from 'three/tsl';
import { nearCutRange } from '@/state/altitude';

/**
 * The cut-away round the camera (state/altitude.ts NEAR_CUT), as one mask
 * node every solid material in the town shares. Two uniforms, moved once a
 * frame, and a discard: no extra pass and nothing to sort.
 *
 * The edge of the cut is a dither rather than transparency, so it stays in
 * the opaque pass and keeps writing depth, and a wall half dissolved still
 * hides what is behind the half that is left.
 */
const cutFrom = uniform(0);
const cutTo = uniform(0);

/** Moves the cut with the camera. Called once a frame from world.ts. */
export function setNearCut(altitudeM: number): void {
  const range = nearCutRange(altitudeM);
  cutFrom.value = range.fromM;
  cutTo.value = range.toM;
}

/** True where a fragment is kept. Assign it to a material's `maskNode`. */
export function nearCutMask() {
  const keep = smoothstep(cutFrom, cutTo, positionWorld.distance(cameraPosition));
  return interleavedGradientNoise(screenCoordinate.xy).lessThan(keep);
}
