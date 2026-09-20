import { BoxGeometry, ConeGeometry, Group, InstancedMesh, PlaneGeometry } from 'three';
import type { Structure, StructureKind } from '@/world/eras';
import {
  attachInstanceColors,
  createInstanceColorMaterial,
  paletteToLinear,
  writeInstanceMatrix,
} from '@/world/instanced';

/**
 * The shapes an era needs that a lot cannot express: city walls, gate roofs,
 * moats, paved courtyards. Three instanced meshes cover all of them, so a whole
 * citadel costs three draw calls.
 *
 * Nothing here moves, so the matrices are written once.
 */
export function createStructures(structures: readonly Structure[]): Group {
  const group = new Group();
  group.name = 'structures';
  for (const kind of ['flat', 'box', 'roof'] as const) {
    const mine = structures.filter((structure) => structure.kind === kind);
    if (mine.length === 0) continue;
    group.add(meshFor(kind, mine));
  }
  return group;
}

function meshFor(kind: StructureKind, structures: readonly Structure[]): InstancedMesh {
  const mesh = new InstancedMesh(geometryFor(kind), createInstanceColorMaterial(), structures.length);
  mesh.name = `structures-${kind}`;
  mesh.frustumCulled = false;

  const colors = attachInstanceColors(mesh, structures.length);
  const matrices = mesh.instanceMatrix.array as Float32Array;
  const palette = paletteToLinear(structures.map((structure) => structure.colour));

  for (let i = 0; i < structures.length; i++) {
    const structure = structures[i];
    if (!structure) continue;
    writeInstanceMatrix(
      matrices,
      i,
      structure.x,
      structure.y,
      structure.z,
      structure.rotY,
      structure.wM,
      structure.hM,
      structure.dM,
    );
    colors[i * 3] = palette[i * 3] ?? 0.5;
    colors[i * 3 + 1] = palette[i * 3 + 1] ?? 0.5;
    colors[i * 3 + 2] = palette[i * 3 + 2] ?? 0.5;
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function geometryFor(kind: StructureKind): BoxGeometry | ConeGeometry | PlaneGeometry {
  if (kind === 'box') {
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // base on the ground, so scaling in y grows upward
    return box;
  }
  if (kind === 'roof') {
    // A four-sided pyramid whose base is a unit square: the radius is the
    // circumradius, and the quarter turn puts its edges along the axes.
    const cone = new ConeGeometry(Math.SQRT1_2, 1, 4);
    cone.rotateY(Math.PI / 4);
    cone.translate(0, 0.5, 0);
    return cone;
  }
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  return plane;
}
