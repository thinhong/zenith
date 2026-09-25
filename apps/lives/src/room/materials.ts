import { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { floor, fract, hash, mix, positionWorld, sin, smoothstep, vec3 } from 'three/tsl';

/**
 * Surfaces for the room. Matte and warm: an anime background is painted, not
 * photographed, so nothing here is glossy and nothing is textured from an
 * image. What variety there is comes from a few lines of shader.
 */
export function matte(hex: string, roughness = 0.88): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: new Color(hex), roughness, metalness: 0 });
  return material;
}

/**
 * Floorboards running from the window towards the room, each a slightly
 * different shade, with a dark seam between them and a faint grain.
 */
export function floorboards(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.72, metalness: 0 });
  const boardM = 0.14;
  const across = positionWorld.x.div(boardM);
  const board = floor(across);
  // Boards are laid in lengths, so the seams across them are staggered.
  const lengthM = 1.3;
  const along = positionWorld.z.div(lengthM).add(hash(board).mul(3));
  const piece = floor(along);
  const shade = hash(board.mul(17.3).add(piece.mul(3.1))).mul(0.16).add(0.9);
  const edge = fract(across);
  const end = fract(along);
  const seam = smoothstep(0.0, 0.035, edge).mul(smoothstep(1.0, 0.965, edge)).mul(smoothstep(0.0, 0.006, end));
  const grain = sin(positionWorld.z.mul(38).add(hash(board).mul(20)).add(sin(positionWorld.x.mul(9)).mul(0.6)))
    .mul(0.035)
    .add(1);
  const wood = vec3(0.56, 0.37, 0.23).mul(shade).mul(grain);
  material.colorNode = mix(vec3(0.2, 0.12, 0.08), wood, seam.mul(0.85).add(0.15));
  return material;
}

/** Plaster, a touch lighter towards the ceiling where the window light bounces. */
export function plaster(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const lift = smoothstep(0, 2.7, positionWorld.y).mul(0.05);
  material.colorNode = vec3(0.86, 0.81, 0.73).add(lift);
  return material;
}
