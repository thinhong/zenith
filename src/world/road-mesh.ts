import { Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { cloudShadow } from '@/world/atmosphere';
import { LAYER_Y } from '@/world/ground';
import type { RoadGraph } from '@/world/roads';

/**
 * Every road in one InstancedMesh: a flat quad per edge, plus a square at each
 * junction so corners do not show a notch. One draw call for the whole network.
 */
function roadMaterial(colour: number): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.colorNode = uniform(new Color(colour)).mul(cloudShadow());
  return material;
}

export function createRoadMesh(
  graph: RoadGraph,
  colour: number,
): InstancedMesh<PlaneGeometry, MeshLambertNodeMaterial> {
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);

  const count = graph.edges.length + graph.nodes.length;
  const mesh = new InstancedMesh(
    geometry,
    // Transparent so two eras can cross-fade over one another.
    roadMaterial(colour),
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
