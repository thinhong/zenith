import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh } from 'three';
import { attribute, varying } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';

/**
 * Shared bits for the crowds. Everything that repeats more than about twenty
 * times is an InstancedMesh (AGENTS.md 6), and for people and vehicles the
 * matrices are rewritten every frame, so the writer below matters.
 */

/** Flat per-instance colour, the same attribute trick world/buildings.ts uses. */
export function createInstanceColorMaterial(): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();
  material.colorNode = varying(attribute('iColor', 'vec3'));
  return material;
}

/**
 * Marks a mesh as one whose matrices change every frame.
 *
 * This is not optional. three uploads an instance matrix buffer once and never
 * looks at it again unless the attribute says DynamicDrawUsage, so without this
 * an InstancedMesh that is rewritten each frame draws whatever happened to be
 * in the buffer at start-up, which for a freshly allocated one is nothing at
 * all. Buildings and trees never move, which is why only the crowds need it.
 */
export function markDynamic(mesh: InstancedMesh): void {
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
}

/** Attaches an empty per-instance colour buffer that the caller then fills. */
export function attachInstanceColors(mesh: InstancedMesh, capacity: number): Float32Array {
  const colors = new Float32Array(capacity * 3);
  const attribute = new InstancedBufferAttribute(colors, 3);
  attribute.setUsage(DynamicDrawUsage);
  mesh.geometry.setAttribute('iColor', attribute);
  return colors;
}

export function markColorsChanged(mesh: InstancedMesh): void {
  const colors = mesh.geometry.getAttribute('iColor');
  colors.needsUpdate = true;
}

/** Turns a list of hex colours into linear rgb triples ready to copy per instance. */
export function paletteToLinear(palette: readonly number[]): Float32Array {
  const out = new Float32Array(palette.length * 3);
  const color = new Color();
  for (let i = 0; i < palette.length; i++) {
    // Color.set() already lands in the renderer's working (linear) space.
    color.set(palette[i] ?? 0x808080);
    out[i * 3] = color.r;
    out[i * 3 + 1] = color.g;
    out[i * 3 + 2] = color.b;
  }
  return out;
}

/**
 * Writes a translate, a turn about y and a scale straight into an instance
 * matrix array. `Matrix4.compose` plus `setMatrixAt` costs several times more,
 * and this runs for every drawn agent on every frame.
 *
 * Local +x ends up pointing along `rotY`, so pass the negative of a heading
 * taken with atan2(dz, dx) to make a figure or a car face where it is going.
 */
export function writeInstanceMatrix(
  out: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): void {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const o = index * 16;
  out[o] = c * scaleX;
  out[o + 1] = 0;
  out[o + 2] = -s * scaleX;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = scaleY;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * scaleZ;
  out[o + 9] = 0;
  out[o + 10] = c * scaleZ;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}
