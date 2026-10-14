import { BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * One person, about sixty triangles.
 *
 * A figure used to be three boxes painted one colour from the shoes up, which
 * at the roof band is a coloured brick. This is still only a handful of
 * shapes, but they are the right ones: a tapered column for the legs, a
 * narrower one for the body with a slight shoulder, and a rounded head. The
 * silhouette is what carries at this size, so the proportions matter far more
 * than the polygon count.
 *
 * The geometry carries its own `color` attribute, which
 * `createTintedInstanceMaterial` multiplies by the person's clothing colour.
 * One instance can only hold one colour, so this is how a figure gets a
 * warmer head and darker trousers without a second draw call.
 */

export const FIGURE = {
  /** A person is 1.7 m tall (PLAN.md 5). Everything below is a share of that. */
  heightM: 1.7,
} as const;

/** Multipliers on the clothing colour, part by part. */
const TINT = {
  /** Trousers: a shade under the shirt. */
  legs: [0.62, 0.6, 0.63],
  /** The shirt, which is the colour the person was given. */
  body: [1, 1, 1],
  /** Shoulders and arms, a touch darker so the body is not one slab. */
  arms: [0.84, 0.83, 0.85],
  /** Skin. Warmer and lighter than whatever they are wearing. */
  head: [1.34, 1.14, 0.96],
} as const;

/**
 * Flattens the index away and paints the whole part one tint.
 *
 * The index has to go before the merge: a cylinder is indexed and an
 * icosahedron is not, and `mergeGeometries` refuses a mixture rather than
 * picking one. It also means each face keeps its own normal, which is what
 * gives these a faceted look rather than a smooth plastic one.
 */
function tinted(source: BufferGeometry, tint: readonly number[]): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tint[0] ?? 1;
    colors[i * 3 + 1] = tint[1] ?? 1;
    colors[i * 3 + 2] = tint[2] ?? 1;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

export function figureGeometry(): BufferGeometry {
  /**
   * Six sides, no arms, and that is the right answer.
   *
   * This was briefly eight sides with arms, on the reasoning that the camera
   * comes down to 12 m. The owner's correction: spend the triangles on the
   * city, not on the people. It is the better call. A crowd is read as a
   * crowd, by its density and its movement, and the silhouette carries that at
   * any size; a building is read one at a time, so every edge on it counts.
   *
   * What stays is the per-part tinting, which costs nothing: darker trousers,
   * a lighter shirt, a warmer head. That is what stops a figure being a
   * coloured brick, and it works just as well on a simple shape.
   */
  const legs = new CylinderGeometry(0.15, 0.1, 0.82, 6, 1);
  legs.translate(0, 0.41, 0);

  const body = new CylinderGeometry(0.17, 0.15, 0.56, 6, 1);
  body.translate(0, 1.1, 0);

  // A shoulder line, so the head does not sit straight on a tube.
  const shoulders = new CylinderGeometry(0.2, 0.19, 0.16, 6, 1);
  shoulders.translate(0, 1.33, 0);

  const head = new IcosahedronGeometry(0.135, 0);
  head.scale(1, 1.12, 1);
  head.translate(0, 1.56, 0);

  const merged = mergeGeometries([
    tinted(legs, TINT.legs),
    tinted(body, TINT.body),
    tinted(shoulders, TINT.arms),
    tinted(head, TINT.head),
  ]);
  if (!merged) throw new Error('could not merge the figure geometry');
  return merged;
}
