import { BoxGeometry, Group, InstancedMesh } from 'three';
import type { Structure } from '@/world/eras';
import {
  attachInstanceColors,
  createInstanceColorMaterial,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';

/**
 * Draws the insides of whichever buildings are open.
 *
 * Everything an interior is made of is a box, so this is one instanced mesh
 * with a generous capacity, rewritten whenever the set of open buildings
 * changes. Only a handful are ever open, and the rewrite happens on a click
 * rather than on a frame, so it is not on any hot path.
 */

/** Boxes this can hold at once. About thirty buildings' worth of rooms. */
const CAPACITY = 4000;

export interface Interiors {
  group: Group;
  /** Starts again from nothing. */
  clear: () => void;
  /** Adds one building's rooms. */
  add: (structures: readonly Structure[]) => void;
}

export function createInteriors(): Interiors {
  const group = new Group();
  group.name = 'interiors';

  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(geometry, createInstanceColorMaterial(true), CAPACITY);
  mesh.name = 'interiors-box';
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const colors = attachInstanceColors(mesh, CAPACITY);
  const matrices = mesh.instanceMatrix.array as Float32Array;
  group.add(mesh);

  let used = 0;

  return {
    group,
    clear: () => {
      used = 0;
      mesh.count = 0;
    },
    add: (structures) => {
      for (const s of structures) {
        if (used >= CAPACITY) break;
        writeInstanceMatrix(matrices, used, s.x, s.y, s.z, s.rotY, s.wM, s.hM, s.dM);
        const linear = paletteToLinear([s.colour]);
        colors[used * 3] = linear[0] ?? 0.5;
        colors[used * 3 + 1] = linear[1] ?? 0.5;
        colors[used * 3 + 2] = linear[2] ?? 0.5;
        used++;
      }
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
      const attribute = mesh.geometry.getAttribute('iColor');
      attribute.needsUpdate = true;
    },
  };
}
