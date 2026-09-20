import { BoxGeometry, Group, InstancedMesh, type Object3D, Sphere, Vector3 } from 'three';
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
  add: (lotId: number, structures: readonly Structure[]) => void;
  /**
   * Which open building a click landed on. Once a building is open its own box
   * is scaled to nothing, so there is nothing of it left to click: without
   * this, clicking an open building fell through to whatever stood behind it
   * and opened that instead, and nothing could ever be shut again.
   */
  lotAt: (mesh: Object3D, instanceId: number) => number | undefined;
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
  // A bounding sphere given by hand, never computed. This mesh starts with no
  // instances in it, and three works a sphere out from the instances it has:
  // with none, the radius comes out NaN, gets cached, and every ray misses it
  // from then on. That is what stopped an open building from being clicked
  // shut again, because once it is open its own box is scaled to nothing and
  // the interior is the only thing left there to hit.
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1e5);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const colors = attachInstanceColors(mesh, CAPACITY);
  const owners = new Int32Array(CAPACITY).fill(-1);
  const matrices = mesh.instanceMatrix.array as Float32Array;
  group.add(mesh);

  let used = 0;

  return {
    group,
    clear: () => {
      used = 0;
      mesh.count = 0;
    },
    lotAt: (object, instanceId) => {
      if (object !== mesh) return undefined;
      const owner = owners[instanceId] ?? -1;
      return owner >= 0 ? owner : undefined;
    },
    add: (lotId, structures) => {
      for (const s of structures) {
        if (used >= CAPACITY) break;
        owners[used] = lotId;
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
