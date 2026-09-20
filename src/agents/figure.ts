import { BufferAttribute, BufferGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * One person, about a hundred and eighty triangles.
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
   * Eight sides, and separate arms.
   *
   * Six sides and no arms was sized for a person five pixels tall, which is
   * what they are from the roof band. But the camera comes down to twelve
   * metres, and there a person fills a good part of the frame: at that range
   * the six facets read as a hexagonal nut and a figure with no arms reads as
   * a skittle. The extra thirty triangles cost nothing next to a building.
   */
  const legs = new CylinderGeometry(0.16, 0.1, 0.82, 8, 1);
  legs.translate(0, 0.41, 0);

  const body = new CylinderGeometry(0.18, 0.16, 0.54, 8, 1);
  body.translate(0, 1.09, 0);

  // A shoulder line, so the head does not sit straight on a tube.
  const shoulders = new CylinderGeometry(0.21, 0.2, 0.15, 8, 1);
  shoulders.translate(0, 1.32, 0);

  // Hanging at the sides, slightly splayed. Not animated: at this size the
  // walking bob carries the movement and a swinging arm would only shimmer.
  const arm = (side: number): BufferGeometry => {
    const g = new CylinderGeometry(0.052, 0.042, 0.56, 5, 1);
    g.rotateZ(side * -0.085);
    g.translate(side * 0.2, 1.02, 0);
    return g;
  };

  const head = new IcosahedronGeometry(0.135, 1);
  head.scale(0.94, 1.1, 0.94);
  head.translate(0, 1.55, 0);

  const merged = mergeGeometries([
    tinted(legs, TINT.legs),
    tinted(body, TINT.body),
    tinted(shoulders, TINT.arms),
    tinted(arm(1), TINT.arms),
    tinted(arm(-1), TINT.arms),
    tinted(head, TINT.head),
  ]);
  if (!merged) throw new Error('could not merge the figure geometry');
  return merged;
}
