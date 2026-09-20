import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
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

/**
 * How far the pavement reaches past the kerb, in metres. It is drawn as one
 * wider quad under the road rather than as two strips beside it, so junctions
 * and bridges take care of themselves.
 */
export const PAVEMENT_M = 2.2;

/** How far the kerb stands above the carriageway, in metres. */
export const KERB_M = 0.16;
/** How wide that raised line is. */
export const KERB_WIDTH_M = 0.45;

export interface Roads {
  group: Group;
  /** Both layers fade together when one era gives way to the next. */
  setOpacity: (value: number) => void;
}

/**
 * The carriageway, and a pavement under it reaching a little further out.
 *
 * Drawing the pavement as one wider quad underneath, rather than as two strips
 * beside the road, means junctions, bridges and the ring road all take care of
 * themselves: whatever shape the carriageway makes, the pavement makes the
 * same shape two metres larger. From above that pale border is most of what
 * makes a road read as a street rather than as a line on a map.
 */
export function createRoads(graph: RoadGraph, colour: number, pavementColour: number): Roads {
  const group = new Group();
  group.name = 'roads';
  const pavement = layer(graph, pavementColour, PAVEMENT_M, LAYER_Y.pavement, 'pavement', 0);
  const road = layer(graph, colour, 0, LAYER_Y.road, 'carriageway', 0);
  // And a raised line where the pavement meets the carriageway. Two thin
  // strips per edge rather than a raised slab: a slab the width of the
  // pavement would swallow the carriageway drawn inside it, and the thing that
  // gives a street its depth is the shadow along the kerb, not the step.
  const kerbs = kerbMesh(graph, pavementColour);
  group.add(pavement, road, kerbs);
  return {
    group,
    setOpacity: (value) => {
      pavement.material.opacity = value;
      road.material.opacity = value;
      kerbs.material.opacity = value;
    },
  };
}

function layer(
  graph: RoadGraph,
  colour: number,
  growM: number,
  y: number,
  name: string,
  _riseM: number,
): InstancedMesh<BufferGeometry, MeshLambertNodeMaterial> {
  const geometry: BufferGeometry = flatSlab();

  const count = graph.edges.length + graph.nodes.length;
  const mesh = new InstancedMesh(
    geometry,
    // Transparent so two eras can cross-fade over one another.
    roadMaterial(colour),
    Math.max(count, 1),
  );
  mesh.name = name;
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
    position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    // Local +x runs along the edge after a Y rotation of atan2(-dz, dx).
    quaternion.setFromAxisAngle(up, Math.atan2(-dz, dx));
    // Overrun by the road width so the quad reaches under the junction square.
    scale.set(length + edge.widthM + growM * 2, 1, edge.widthM + growM * 2);
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
    position.set(node.x, y, node.z);
    scale.set(width + growM * 2, 1, width + growM * 2);
    mesh.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
  }

  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function flatSlab(): BufferGeometry {
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  return plane;
}

/** Two low strips down each edge, where the pavement meets the carriageway. */
function kerbMesh(
  graph: RoadGraph,
  colour: number,
): InstancedMesh<BufferGeometry, MeshLambertNodeMaterial> {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(geometry, roadMaterial(colour), Math.max(graph.edges.length * 2, 1));
  mesh.name = 'kerbs';

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
    const dirX = dx / length;
    const dirZ = dz / length;
    const offset = edge.widthM / 2 + KERB_WIDTH_M / 2;
    quaternion.setFromAxisAngle(up, Math.atan2(-dz, dx));
    scale.set(length, KERB_M, KERB_WIDTH_M);
    for (const side of [-1, 1]) {
      const cx = (a.x + b.x) / 2 - dirZ * offset * side;
      const cz = (a.z + b.z) / 2 + dirX * offset * side;
      position.set(cx, LAYER_Y.pavement, cz);
      mesh.setMatrixAt(i++, matrix.compose(position, quaternion, scale));
    }
  }

  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
