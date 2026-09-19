import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
} from 'three';
import { mulberry32, range } from '@/world/seed';

export interface World {
  scene: Scene;
  update: (dt: number, elapsed: number, altitude: number) => void;
}

export interface WorldOptions {
  seed: number;
}

/**
 * Placeholder world: a flat ground and a grid of low-poly blocks so the camera
 * has something to look down on. Milestone 1 replaces this with the real
 * procedural city (see docs/PLAN.md).
 */
export function createWorld({ seed }: WorldOptions): World {
  const rng = mulberry32(seed);
  const scene = new Scene();
  scene.background = new Color('#0b0f14');
  scene.fog = new Fog('#0b0f14', 1500, 6000);

  scene.add(new AmbientLight('#8fa3bf', 0.6));
  const sun = new DirectionalLight('#fff2dc', 1.4);
  sun.position.set(600, 1000, 400);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(4000, 4000),
    new MeshLambertMaterial({ color: '#1c2430' }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // One InstancedMesh for all buildings: one draw call regardless of count.
  const cols = 40;
  const rows = 40;
  const spacing = 40;
  const count = cols * rows;
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0); // pivot at the base so scaling in y grows upward
  const buildings = new InstancedMesh(box, new MeshLambertMaterial({ color: '#4a5a70' }), count);
  const m = new Matrix4();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * spacing + range(rng, -6, 6);
      const z = (r - rows / 2) * spacing + range(rng, -6, 6);
      const w = range(rng, 14, 26);
      const d = range(rng, 14, 26);
      const h = range(rng, 8, 120);
      m.makeScale(w, h, d).setPosition(x, 0, z);
      buildings.setMatrixAt(i++, m);
    }
  }
  buildings.instanceMatrix.needsUpdate = true;
  scene.add(buildings);

  return {
    scene,
    update: () => {
      /* nothing moves yet; see PLAN.md milestone 2 */
    },
  };
}
