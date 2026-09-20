import { BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * What the three kinds of body look like. One geometry each, instanced.
 *
 * They are built to the same rule as the people: the silhouette is what
 * carries, because from the roof band any of these is a few pixels tall. What
 * separates them is their outline from directly overhead, since that is the
 * angle Zenith is nearly always seen from. An imp is a small round blob with
 * two points on it. A beast is long and low, on four legs, with a ridged
 * back. A hero is a person with a cloak, which from above is a wedge hanging
 * off their shoulders, and that wedge is the whole reason you can pick them
 * out of a field at all.
 *
 * Each carries a `color` attribute that `createTintedInstanceMaterial`
 * multiplies by the instance colour, the same way a figure does, so one draw
 * gives a dozen shades of the same creature.
 */

const TINT = {
  body: [1, 1, 1],
  dark: [0.62, 0.6, 0.6],
  horn: [1.25, 1.2, 1.08],
  cloak: [0.78, 0.8, 0.88],
} as const;

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

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('could not merge a monster geometry');
  return merged;
}

/** Local +x is forward, feet at y = 0, about one unit tall. */
export function impGeometry(): BufferGeometry {
  const body = new IcosahedronGeometry(0.34, 0);
  body.scale(1, 0.92, 1);
  body.translate(0, 0.38, 0);

  const head = new IcosahedronGeometry(0.22, 0);
  head.translate(0.08, 0.78, 0);

  const horns: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const horn = new ConeGeometry(0.06, 0.26, 4);
    horn.translate(0.02, 0.98, side * 0.13);
    horns.push(tinted(horn, TINT.horn));
  }

  const legs: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const leg = new CylinderGeometry(0.07, 0.05, 0.22, 4);
    leg.translate(0, 0.11, side * 0.14);
    legs.push(tinted(leg, TINT.dark));
  }

  return merge([tinted(body, TINT.body), tinted(head, TINT.body), ...horns, ...legs]);
}

/** A low four-legged thing. Long in x, which is the way it faces. */
export function beastGeometry(): BufferGeometry {
  const body = new IcosahedronGeometry(0.42, 0);
  body.scale(1.75, 0.82, 0.95);
  body.translate(0, 0.52, 0);

  const neck = new CylinderGeometry(0.13, 0.19, 0.42, 5);
  neck.rotateZ(Math.PI * 0.36);
  neck.translate(0.62, 0.48, 0);

  const head = new IcosahedronGeometry(0.2, 0);
  head.scale(1.5, 0.9, 0.9);
  head.translate(0.92, 0.36, 0);

  const tail = new ConeGeometry(0.12, 0.66, 4);
  tail.rotateZ(Math.PI * 0.5);
  tail.translate(-1.02, 0.5, 0);

  const legs: BufferGeometry[] = [];
  for (const front of [0.42, -0.42]) {
    for (const side of [-1, 1]) {
      const leg = new CylinderGeometry(0.09, 0.07, 0.36, 4);
      leg.translate(front, 0.18, side * 0.26);
      legs.push(tinted(leg, TINT.dark));
    }
  }

  // A ridge down the back. Three plates, and they are what tell you at a
  // glance that this is the thing the wall is for.
  const plates: BufferGeometry[] = [];
  for (const along of [0.3, 0, -0.3]) {
    const plate = new ConeGeometry(0.1, 0.3, 4);
    plate.scale(1, 1, 0.35);
    plate.translate(along, 0.86, 0);
    plates.push(tinted(plate, TINT.horn));
  }

  return merge([
    tinted(body, TINT.body),
    tinted(neck, TINT.body),
    tinted(head, TINT.body),
    tinted(tail, TINT.dark),
    ...legs,
    ...plates,
  ]);
}

/** A person, and a cloak that reads from overhead. */
export function heroGeometry(): BufferGeometry {
  const legs = new CylinderGeometry(0.15, 0.1, 0.82, 6);
  legs.translate(0, 0.41, 0);

  const body = new CylinderGeometry(0.18, 0.16, 0.58, 6);
  body.translate(0, 1.1, 0);

  const head = new IcosahedronGeometry(0.14, 0);
  head.scale(1, 1.1, 1);
  head.translate(0, 1.56, 0);

  // The cloak: a wedge hanging off the shoulders and down the back. Wide at
  // the shoulder, narrow at the hem, and tilted so it catches the light.
  const cloak = new ConeGeometry(0.42, 0.95, 4, 1, true);
  cloak.rotateY(Math.PI / 4);
  cloak.rotateZ(0.16);
  cloak.translate(-0.12, 0.92, 0);

  // A blade, held out. Two pixels of bright metal, and it is what makes the
  // shape read as somebody who came here on purpose.
  const blade = new CylinderGeometry(0.03, 0.02, 0.86, 3);
  blade.rotateZ(Math.PI * 0.42);
  blade.translate(0.34, 1.22, 0.16);

  return merge([
    tinted(legs, TINT.dark),
    tinted(body, TINT.body),
    tinted(head, TINT.horn),
    tinted(cloak, TINT.cloak),
    tinted(blade, TINT.horn),
  ]);
}
