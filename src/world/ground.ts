import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { centrelinePoint, TERRAIN, type MountainSpec, type TerrainSpec } from '@/world/terrain';

/**
 * The land, the water and the mountain ring as three.js objects. Everything is
 * flat colour and instanced (AGENTS.md 6); the shape comes from terrain.ts.
 */

/** The mountains ring every era, so their colour does not change with one. */
export const GROUND_PALETTE = {
  mountainLow: 0x3b4536,
  mountainHigh: 0x4a5244,
} as const;

/**
 * Coplanar surfaces need a little separation or they fight for the same depth.
 * The camera's near plane grows with altitude (core/camera.ts) so these small
 * gaps stay resolvable from 6 km up.
 */
export const LAYER_Y = { ground: 0, water: 0.3, road: 0.6 } as const;

export interface Ground {
  group: Group;
  /** The land and the water take their colour from the era, cross-faded on a switch. */
  setColours: (land: Color, water: Color) => void;
}

export function createGround(terrain: TerrainSpec, land: number, water: number): Ground {
  const group = new Group();
  group.name = 'ground';
  const landMesh = createLand(terrain, land);
  const waterMesh = createWater(terrain, water);
  group.add(landMesh, waterMesh);
  for (const mesh of createMountains(terrain.mountains)) group.add(mesh);

  const landMaterial = landMesh.material;
  const waterMaterial = waterMesh.material;
  return {
    group,
    setColours: (nextLand, nextWater) => {
      landMaterial.color.copy(nextLand);
      waterMaterial.color.copy(nextWater);
    },
  };
}

function createLand(terrain: TerrainSpec, colour: number): Mesh<CircleGeometry, MeshLambertMaterial> {
  const geometry = new CircleGeometry(terrain.groundRadiusM, 128);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshLambertMaterial({
    color: new Color(colour),
    // Push the land a touch further away so the roads drawn on top of it win.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'land';
  mesh.position.y = LAYER_Y.ground;
  return mesh;
}

function createWater(terrain: TerrainSpec, colour: number): Mesh<BufferGeometry, MeshLambertMaterial> {
  const water = terrain.water;
  const centre: { x: number; z: number }[] = [];
  for (let i = 0; i < water.offsetsM.length; i++) centre.push(centrelinePoint(water, i));
  // Run the two ends far past the land, or the strip shows a cut edge from high up.
  const head = centre[0];
  const tail = centre[centre.length - 1];
  if (head) {
    centre.unshift({
      x: head.x - water.dirX * TERRAIN.waterReachM,
      z: head.z - water.dirZ * TERRAIN.waterReachM,
    });
  }
  if (tail) {
    centre.push({
      x: tail.x + water.dirX * TERRAIN.waterReachM,
      z: tail.z + water.dirZ * TERRAIN.waterReachM,
    });
  }

  const inner: { x: number; z: number }[] = [];
  const outer: { x: number; z: number }[] = [];
  for (const p of centre) {
    // A river is a band around its centreline; a coast is everything on one
    // side of the shore, carried far enough out to vanish into fog.
    const innerOffset = water.kind === 'river' ? -water.halfWidthM : 0;
    const outerOffset = water.kind === 'river' ? water.halfWidthM : TERRAIN.waterReachM;
    inner.push({ x: p.x + water.nrmX * innerOffset, z: p.z + water.nrmZ * innerOffset });
    outer.push({ x: p.x + water.nrmX * outerOffset, z: p.z + water.nrmZ * outerOffset });
  }
  const mesh = new Mesh(
    ribbonGeometry(inner, outer, LAYER_Y.water),
    new MeshLambertMaterial({ color: new Color(colour) }),
  );
  mesh.name = 'water';
  return mesh;
}

/**
 * Two meshes, split by height, so the ring reads as hills rather than as one
 * repeated cone. Two draw calls for the whole horizon.
 */
function createMountains(mountains: readonly MountainSpec[]): InstancedMesh[] {
  const low = mountains.filter((m) => m.heightM < 250);
  const high = mountains.filter((m) => m.heightM >= 250);
  return [
    mountainMesh(low, GROUND_PALETTE.mountainLow, 'mountains-low'),
    mountainMesh(high, GROUND_PALETTE.mountainHigh, 'mountains-high'),
  ];
}

function mountainMesh(specs: readonly MountainSpec[], color: number, name: string): InstancedMesh {
  // Seven sides keeps the silhouette faceted, in keeping with the toy world.
  const geometry = new ConeGeometry(1, 1, 7, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ color: new Color(color), flatShading: true }),
    Math.max(specs.length, 1),
  );
  mesh.name = name;
  mesh.count = specs.length;
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < specs.length; i++) {
    const m = specs[i];
    if (!m) continue;
    position.set(m.x, 0, m.z);
    // Turning each cone hides the shared silhouette.
    quaternion.setFromAxisAngle(up, (i * 2.399963) % (Math.PI * 2));
    scale.set(m.radiusM, m.heightM, m.radiusM);
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A flat strip between two lines of points, lying at height `y` with normals
 * pointing up. The winding is checked once and reversed if needed, so callers
 * do not have to reason about which side is "inner".
 */
export function ribbonGeometry(
  inner: ReadonlyArray<{ x: number; z: number }>,
  outer: ReadonlyArray<{ x: number; z: number }>,
  y: number,
): BufferGeometry {
  const count = Math.min(inner.length, outer.length);
  const positions = new Float32Array(count * 6);
  const normals = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const a = inner[i];
    const b = outer[i];
    if (!a || !b) continue;
    positions.set([a.x, y, a.z, b.x, y, b.z], i * 6);
    normals.set([0, 1, 0, 0, 1, 0], i * 6);
  }
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const v = i * 2;
    index.push(v, v + 1, v + 3, v, v + 3, v + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(facesUp(positions, index) ? index : reverseTriangles(index));
  geometry.computeBoundingSphere();
  return geometry;
}

function facesUp(positions: Float32Array, index: readonly number[]): boolean {
  const i0 = index[0];
  const i1 = index[1];
  const i2 = index[2];
  if (i0 === undefined || i1 === undefined || i2 === undefined) return true;
  const ux = (positions[i1 * 3] ?? 0) - (positions[i0 * 3] ?? 0);
  const uz = (positions[i1 * 3 + 2] ?? 0) - (positions[i0 * 3 + 2] ?? 0);
  const vx = (positions[i2 * 3] ?? 0) - (positions[i0 * 3] ?? 0);
  const vz = (positions[i2 * 3 + 2] ?? 0) - (positions[i0 * 3 + 2] ?? 0);
  // y component of the cross product of the two edges
  return uz * vx - ux * vz > 0;
}

function reverseTriangles(index: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < index.length; i += 3) {
    out.push(index[i + 2] ?? 0, index[i + 1] ?? 0, index[i] ?? 0);
  }
  return out;
}
