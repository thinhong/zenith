import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import {
  attribute,
  cameraPosition,
  positionGeometry,
  screenSize,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { CAMERA_FOV_DEG } from '@/core/camera';
import { cloudShadow } from '@/world/atmosphere';
import { LAYER_Y } from '@/world/ground';
import type { Mark } from '@/world/markings';
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

/**
 * How far the markings sit above the carriageway. Enough to stay in front of
 * it at the far end of the depth range the markings are still drawn at, and
 * well under the kerb, which stands 0.16 m proud of the pavement below.
 */
export const MARK_RISE_M = 0.03;

/** Twice the tangent of half the camera's vertical field of view. */
const VIEW_SPAN = 2 * Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));

function numberUniform(value: number) {
  return uniform(value);
}
type NumberUniform = ReturnType<typeof numberUniform>;

interface Markings {
  mesh: Mesh<BufferGeometry, MeshLambertNodeMaterial>;
  /** The era cross-fade. */
  opacity: NumberUniform;
  /** 0 by day, 1 at night, for markings that are lights. */
  glow: NumberUniform;
}

export interface Roads {
  group: Group;
  /** Every layer fades together when one era gives way to the next. */
  setOpacity: (value: number) => void;
  /** Lit markings burn after dark. Painted ones do nothing with this. */
  setNight: (night: number) => void;
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
export function createRoads(
  graph: RoadGraph,
  colour: number,
  pavementColour: number,
  marks: readonly Mark[],
  lit: boolean,
): Roads {
  const group = new Group();
  group.name = 'roads';
  const pavement = layer(graph, pavementColour, PAVEMENT_M, LAYER_Y.pavement, 'pavement', 0);
  const road = layer(graph, colour, 0, LAYER_Y.road, 'carriageway', 0);
  // And a raised line where the pavement meets the carriageway. Two thin
  // strips per edge rather than a raised slab: a slab the width of the
  // pavement would swallow the carriageway drawn inside it, and the thing that
  // gives a street its depth is the shadow along the kerb, not the step.
  const kerbs = kerbMesh(graph, pavementColour);
  const markings = markingMesh(marks, lit);
  group.add(pavement, road, kerbs, markings.mesh);
  return {
    group,
    setOpacity: (value) => {
      pavement.material.opacity = value;
      road.material.opacity = value;
      kerbs.material.opacity = value;
      markings.opacity.value = value;
    },
    setNight: (night) => {
      markings.glow.value = lit ? night : 0;
    },
  };
}

/**
 * Every marking on every road as one mesh: four corners per mark, one draw
 * call. Not instanced, because each corner needs to know which way it may
 * grow (below).
 *
 * A lane line is 15 cm wide. From the opening view, 520 m up, that is a
 * quarter of a pixel, and a line a quarter of a pixel wide is either drawn or
 * not depending on where it falls, so a straight dashed line breaks into a
 * crawling dotted one whenever the camera moves. The fix is the one a pen
 * plotter would use: a mark narrower than a pixel is drawn a pixel wide and
 * correspondingly faint. Each corner carries the direction of its mark's thin
 * side, and the vertex stage pushes it out until the mark covers half a pixel
 * either side of its centreline, then fades it by the same ratio. Close up
 * nothing moves and the paint is solid; from high up the roads carry a faint,
 * steady trace of their markings, which is what an aerial photograph shows.
 */
function markingMesh(marks: readonly Mark[], lit: boolean): Markings {
  const count = marks.length;
  const positions = new Float32Array(count * 12);
  const normals = new Float32Array(count * 12);
  const colours = new Float32Array(count * 12);
  // Which way the corner grows, and (half the thin side, ink) for its mark.
  const grow = new Float32Array(count * 8);
  const shape = new Float32Array(count * 8);
  const index = new Uint32Array(count * 6);
  const colour = new Color();
  const y = LAYER_Y.road + MARK_RISE_M;

  for (let i = 0; i < count; i++) {
    const mark = marks[i];
    if (!mark) continue;
    colour.set(mark.colour);
    const acrossX = -mark.dirZ;
    const acrossZ = mark.dirX;
    const halfL = mark.lengthM / 2;
    const halfW = mark.widthM / 2;
    const thinAcross = mark.widthM <= mark.lengthM;
    for (let c = 0; c < 4; c++) {
      const sL = c === 0 || c === 3 ? -1 : 1;
      const sW = c < 2 ? -1 : 1;
      const v = i * 4 + c;
      positions[v * 3] = mark.x + mark.dirX * halfL * sL + acrossX * halfW * sW;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = mark.z + mark.dirZ * halfL * sL + acrossZ * halfW * sW;
      normals[v * 3 + 1] = 1;
      colours[v * 3] = colour.r;
      colours[v * 3 + 1] = colour.g;
      colours[v * 3 + 2] = colour.b;
      grow[v * 2] = thinAcross ? acrossX * sW : mark.dirX * sL;
      grow[v * 2 + 1] = thinAcross ? acrossZ * sW : mark.dirZ * sL;
      shape[v * 2] = thinAcross ? halfW : halfL;
      shape[v * 2 + 1] = mark.ink;
    }
    // Corners go round anticlockwise seen from above, so both faces point up.
    const v0 = i * 4;
    index.set([v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2], i * 6);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setAttribute('grow', new BufferAttribute(grow, 2));
  geometry.setAttribute('shape', new BufferAttribute(shape, 2));
  geometry.setIndex(new BufferAttribute(index, 1));

  const opacity = numberUniform(1);
  const glow = numberUniform(0);
  const material = new MeshLambertNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;

  const growBy = attribute('grow', 'vec2');
  const thin = attribute('shape', 'vec2');
  // The mesh is never moved, so its own positions are world positions.
  const pixelM = positionGeometry.distance(cameraPosition).mul(VIEW_SPAN).div(screenSize.y);
  const extraM = pixelM.mul(0.5).sub(thin.x).max(0);
  material.positionNode = positionGeometry.add(vec3(growBy.x, 0, growBy.y).mul(extraM));
  const coverage = varying(thin.y.mul(thin.x).div(thin.x.add(extraM)));
  const tint = varying(attribute('color', 'vec3'));
  material.colorNode = tint.mul(cloudShadow());
  material.opacityNode = coverage.mul(opacity);
  if (lit) {
    // three declares emissiveNode only on MeshStandardNodeMaterial, but
    // every node material's lighting reads it (world/buildings.ts does the same).
    (material as MeshLambertNodeMaterial & { emissiveNode: unknown }).emissiveNode = tint.mul(coverage).mul(glow).mul(1.6);
  }

  const mesh = new Mesh(geometry, material);
  mesh.name = 'markings';
  mesh.frustumCulled = false;
  // After every road layer, of both eras. Transparent things are sorted by
  // the distance to the centre of their bounds, and the centre of the paint is
  // not the centre of the tarmac, so left to that the carriageway was drawn
  // over its own markings from some angles and they vanished. The roads are
  // the only other transparent things in the world, so this costs nothing.
  mesh.renderOrder = 1;
  // Paint has no thickness to throw a shadow with, and a shadow pass would
  // widen it by the distance to the light rather than to the eye.
  mesh.userData.castsNoShadow = true;
  return { mesh, opacity, glow };
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
