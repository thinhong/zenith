import { Vector2 } from 'three';
import { float, floor, fract, positionWorld, sin, smoothstep, uniform } from 'three/tsl';

/**
 * The two large patterns that sit on top of everything: cloud shadows drifting
 * over the whole world, and the patchwork of fields out in the country.
 *
 * Both are TSL nodes shared by several materials. They are written as sums of
 * sine waves rather than as sampled noise for two reasons: there is no texture
 * to load, and a hash at city-scale coordinates speckles (AGENTS.md, and
 * world/buildings.ts learned the same thing the hard way).
 *
 * Cloud shadows are the reason an aerial shot in an animated film reads as a
 * living place rather than a map. They cost four sines per fragment.
 */

export const CLOUDS = {
  /**
   * How wide one cloud is, in metres. Note the conversion: a sine repeats every
   * 2*PI, so dividing the position by this number would give clouds 2*PI times
   * wider than it says. Getting that wrong once made every cloud ten kilometres
   * across, which is wider than any frame, so the whole world simply sat under
   * a slightly darker or lighter wash and the feature looked broken.
   */
  spanM: 1500,
  /** How far the ground drops in value under one, as a fraction. */
  depth: 0.45,
  /** Drift speed in metres a second. Slow enough to notice only if you wait. */
  driftMS: 14,
  /** Direction the weather comes from. */
  driftX: 0.82,
  driftZ: 0.57,
} as const;

export const FIELDS = {
  /** Side of one field, in metres. */
  sizeM: 115,
  /** How far a field's colour departs from the base, as a fraction. */
  spread: 0.26,
  /**
   * Fields are weakest downtown, where the ground only shows in thin strips
   * between blocks and a patchwork would read as stripes, and full strength
   * out in the country.
   */
  townTone: 0.45,
  fadeInnerScale: 0.25,
  fadeOuterScale: 1.25,
} as const;

/** The drift offset, advanced once a frame and shared by every material. */
const drift = uniform(new Vector2(0, 0));

/** Moves the weather along. Called once a frame from world.ts. */
export function advanceClouds(elapsedS: number): void {
  const distance = (elapsedS * CLOUDS.driftMS * Math.PI * 2) / CLOUDS.spanM;
  drift.value.set(distance * CLOUDS.driftX, distance * CLOUDS.driftZ);
}

/**
 * How much light reaches a point, 1 in the open and `1 - CLOUDS.depth` under a
 * cloud. Multiply it into a material's colour node.
 */
export function cloudShadow() {
  const q = positionWorld.xz.mul((Math.PI * 2) / CLOUDS.spanM).add(drift);
  const x = q.x;
  const z = q.y;
  // Four waves at unrelated angles and periods, so the pattern never repeats
  // visibly inside the 24 km the land covers. The smallest of them is a
  // quarter the size of the largest, which gives a cloud a ragged edge.
  const n = sin(x)
    .mul(0.5)
    .add(sin(z.mul(1.31).add(1.7)).mul(0.5))
    .add(sin(x.mul(0.61).add(z.mul(0.83)).add(3.1)).mul(0.6))
    .add(sin(x.mul(1.77).sub(z.mul(1.13)).add(5.2)).mul(0.35));
  // Patches with gaps between them, not an even wash: without the threshold
  // the whole world just breathes slightly and reads as a rendering bug.
  const cover = smoothstep(-0.1, 0.75, n);
  return float(1).sub(cover.mul(CLOUDS.depth));
}

/**
 * 0 in the middle of town and 1 out in the country. The land takes two colours
 * and mixes between them on this: what shows between buildings in a real city
 * is yard, path and tarmac, not grass, and painting the whole disc green was
 * the single largest thing making this look like a model railway.
 */
export function townToCountry(cityRadiusM: number) {
  return smoothstep(
    cityRadiusM * FIELDS.fadeInnerScale,
    cityRadiusM * FIELDS.fadeOuterScale,
    positionWorld.xz.length(),
  );
}

/**
 * A value in -1..1, constant across one field and uncorrelated with the next.
 * Weaker inside the city, where the ground shows only in strips between
 * buildings and a patchwork would read as stripes.
 */
export function fieldTone(cityRadiusM: number) {
  const cell = positionWorld.xz.div(FIELDS.sizeM);
  const cx = floor(cell.x);
  const cz = floor(cell.y);
  // The same small-constant hash world/buildings.ts uses. Every term is kept
  // well inside what a 32-bit float resolves, which the usual
  // fract(sin(dot(...)) * 43758) is not at these coordinates.
  const a = fract(cx.mul(0.2317).add(cz.mul(0.7219)).add(0.317));
  const b = fract(cz.mul(0.1379).add(a.mul(43.21)));
  const noise = fract(a.add(b).mul(b.add(19.19)).mul(7.13));

  const strength = float(FIELDS.townTone).add(townToCountry(cityRadiusM).mul(1 - FIELDS.townTone));
  return noise.sub(0.5).mul(2).mul(strength);
}
