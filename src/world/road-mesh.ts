import { Color, InstancedMesh, Matrix4, MeshLambertMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { LAYER_Y } from '@/world/ground';
import type { RoadGraph } from '@/world/roads';

/** Modern-era road colour. Moves into eras/modern.ts in M5. */
export const ROAD_COLOR = 0x474a50;

/**
 * Every road in one InstancedMesh: a flat quad per edge, plus a square at each
 * junction so corners do not show a notch. One draw call for the whole network.
 */
export function createRoadMesh(graph: RoadGraph): InstancedMesh {
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);

  const count = graph.edges.length + graph.nodes.length;
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ color: new Color(ROAD_COLOR) }),
    Math.max(count, 1),
  );
  mesh.name = 'roads';
  mesh.count = count;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  let i = 0;

  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    position.set((a.x + b.x) / 2, LAYER_Y.road, (a.z + b.z) / 2);
    // Local +x runs along the edge after a Y rotation of atan2(-dz, dx).
    quaternion.setFromAxisAngle(up, Math.atan2(-dz, dx));
    // Overrun by the road width so the quad reaches under the junction square.
    scale.set(length + edge.widthM, 1, edge.widthM);
    mesh.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
  }

  const junctionWidth = new Float64Array(graph.nodes.length);
  for (const edge of graph.edges) {
    junctionWidth[edge.a] = Math.max(junctionWidth[edge.a] ?? 0, edge.widthM);
    junctionWidth[edge.b] = Math.max(junctionWidth[edge.b] ?? 0, edge.widthM);
  }
  quaternion.identity();
  for (const node of graph.nodes) {
    const width = junctionWidth[node.id] ?? 0;
    if (width <= 0) continue;
    position.set(node.x, LAYER_Y.road, node.z);
    scale.set(width, 1, width);
    mesh.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
  }

  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
