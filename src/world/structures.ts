import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  type Material,
  PlaneGeometry,
} from 'three';
import type { Structure, StructureKind } from '@/world/eras';
import {
  attachInstanceColors,
  createInstanceColorMaterial,
  paletteToLinear,
  setMaterialsXray,
  writeInstanceMatrix,
} from '@/world/instanced';

/**
 * The shapes an era needs that a lot cannot express: city walls, gate roofs,
 * moats, paved courtyards. Three instanced meshes cover all of them, so a whole
 * citadel costs three draw calls.
 *
 * Nothing here moves, so the matrices are written once.
 */
export interface Structures {
  group: Group;
  /** Makes the walls, roofs and paving see-through (ui/bar.ts, the X key). */
  setXray: (on: boolean) => void;
}

export function createStructures(structures: readonly Structure[]): Structures {
  const group = new Group();
  group.name = 'structures';
  const materials: Material[] = [];
  for (const kind of ['flat', 'box', 'roof', 'gable', 'tank'] as const) {
    const mine = structures.filter((structure) => structure.kind === kind);
    if (mine.length === 0) continue;
    const mesh = meshFor(kind, mine);
    materials.push(mesh.material);
    group.add(mesh);
  }
  return { group, setXray: (on) => setMaterialsXray(materials, on) };
}

function meshFor(
  kind: StructureKind,
  structures: readonly Structure[],
): InstancedMesh<BufferGeometry, Material> {
  const mesh = new InstancedMesh(geometryFor(kind), createInstanceColorMaterial(true), structures.length);
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

function geometryFor(kind: StructureKind): BufferGeometry {
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
  if (kind === 'gable') return gableGeometry();
  if (kind === 'tank') {
    // Four sides. A tank is about two metres across, so the extra facets were
    // never visible and cost more than the building underneath them.
    const tank = new CylinderGeometry(0.5, 0.5, 1, 4);
    tank.translate(0, 0.5, 0);
    return tank;
  }
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  return plane;
}

/**
 * A ridged roof: a unit box footprint with the ridge running along local x and
 * the apex at y = 1. Eight triangles, written out rather than indexed so each
 * face keeps its own normal and the two slopes catch the sun differently,
 * which is what makes a row of houses read as houses from above.
 */
function gableGeometry(): BufferGeometry {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [0.5, 0, 0.5];
  const d = [-0.5, 0, 0.5];
  const e = [-0.5, 1, 0];
  const f = [0.5, 1, 0];
  const faces = [
    // The two slopes.
    a, e, f, a, f, b,
    c, f, e, c, e, d,
    // The two gable ends.
    a, d, e,
    b, f, c,
    // The underside, which is only seen from below the eaves.
    a, b, c, a, c, d,
  ];
  const positions = new Float32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const p = faces[i];
    if (!p) continue;
    positions[i * 3] = p[0] ?? 0;
    positions[i * 3 + 1] = p[1] ?? 0;
    positions[i * 3 + 2] = p[2] ?? 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
