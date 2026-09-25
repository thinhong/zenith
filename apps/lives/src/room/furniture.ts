import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Material,
  Object3D,
  PointLight,
  SphereGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { makeRng } from '@/film/ease';
import { ROOM, SEATS } from '@/film/stage';
import { matte } from '@/room/materials';

/**
 * The things in the room. Boxes and cylinders, sized in metres against a
 * person 1.6 m tall. Each builder returns a group placed in the room; the few
 * parts that change over the film (the lamp, the clock's hands) are returned
 * as handles.
 */

function box(w: number, h: number, d: number, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(rTop: number, rBottom: number, h: number, material: Material, x: number, y: number, z: number, segments = 20): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface Lamp {
  group: Group;
  light: PointLight;
  bulb: MeshBasicNodeMaterial;
}

export function buildDesk(): { group: Group; lamp: Lamp } {
  const group = new Group();
  const wood = matte('#9c6b45', 0.7);
  const dark = matte('#6e4a31', 0.75);
  const { x, widthM, depthM, heightM } = ROOM.desk;
  const z = ROOM.backZ + depthM / 2;
  group.add(box(widthM, 0.04, depthM, wood, x, heightM - 0.02, z));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(box(0.05, heightM - 0.04, 0.05, dark, x + sx * (widthM / 2 - 0.05), (heightM - 0.04) / 2, z + sz * (depthM / 2 - 0.05)));
    }
  }
  // A drawer under the right-hand end.
  group.add(box(0.4, 0.14, depthM - 0.08, wood, x + widthM / 2 - 0.25, heightM - 0.11, z));
  group.add(box(0.1, 0.018, 0.012, dark, x + widthM / 2 - 0.25, heightM - 0.11, z + depthM / 2 - 0.035));

  // Books, a notebook open on the desk, a mug.
  const rng = makeRng(7);
  const bookColours = ['#b8563f', '#3d5f7a', '#d9b25f', '#4f7a55', '#7a4f6e'];
  let bx = x + widthM / 2 - 0.12;
  for (let i = 0; i < 5; i++) {
    const w = 0.03 + rng() * 0.025;
    const h = 0.2 + rng() * 0.07;
    group.add(box(w, h, 0.16, matte(bookColours[i % bookColours.length] ?? '#888888'), bx, heightM + h / 2, ROOM.backZ + 0.12));
    bx -= w + 0.004;
  }
  group.add(box(0.3, 0.012, 0.21, matte('#f4efe4', 0.9), x - 0.05, heightM + 0.006, z + 0.1));
  group.add(box(0.004, 0.013, 0.2, matte('#c9c0ae'), x - 0.05, heightM + 0.008, z + 0.1));
  group.add(cylinder(0.035, 0.032, 0.09, matte('#e9e4da', 0.6), x + 0.32, heightM + 0.045, z + 0.12));

  // The lamp at the left end, which comes on at night.
  const lampGroup = new Group();
  const metal = matte('#2f3a3f', 0.5);
  const lx = x - widthM / 2 + 0.16;
  const lz = ROOM.backZ + 0.18;
  lampGroup.add(cylinder(0.07, 0.08, 0.02, metal, lx, heightM + 0.01, lz));
  const arm = cylinder(0.008, 0.008, 0.36, metal, lx, heightM + 0.19, lz);
  lampGroup.add(arm);
  const shade = cylinder(0.05, 0.11, 0.12, matte('#e8d9b8', 0.8), lx + 0.07, heightM + 0.38, lz + 0.06);
  shade.rotation.x = 0.35;
  shade.rotation.z = -0.4;
  lampGroup.add(shade);
  const bulbMaterial = new MeshBasicNodeMaterial({ color: new Color('#fff1cf') });
  const bulb = new Mesh(new SphereGeometry(0.03, 12, 8), bulbMaterial);
  bulb.position.set(lx + 0.08, heightM + 0.33, lz + 0.08);
  lampGroup.add(bulb);
  const light = new PointLight('#ffcf8f', 0, 5, 2);
  light.position.copy(bulb.position);
  light.castShadow = false;
  lampGroup.add(light);
  group.add(lampGroup);

  return { group, lamp: { group: lampGroup, light, bulb: bulbMaterial } };
}

export function buildDeskChair(): Group {
  const group = new Group();
  const wood = matte('#8a5c3b', 0.72);
  const seat = SEATS.desk;
  // The hips go over the back half of the seat; the chair faces the desk.
  const cz = seat.z + 0.1;
  group.add(box(0.44, 0.04, 0.42, wood, seat.x, seat.heightM - 0.02, cz));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(box(0.035, seat.heightM - 0.04, 0.035, wood, seat.x + sx * 0.19, (seat.heightM - 0.04) / 2, cz + sz * 0.18));
    }
    // The back posts rise behind her.
    group.add(box(0.035, 0.46, 0.035, wood, seat.x + sx * 0.19, seat.heightM + 0.23, cz + 0.19));
  }
  group.add(box(0.4, 0.12, 0.025, wood, seat.x, seat.heightM + 0.38, cz + 0.2));
  return group;
}

export function buildArmchair(): Group {
  const group = new Group();
  const fabric = matte('#6d8b82', 0.95);
  const cushion = matte('#7d9b91', 0.95);
  const wood = matte('#5b4030', 0.7);
  const seat = SEATS.armchair;
  // Built facing +Z around the seat point, then turned to face the window.
  group.add(box(0.72, 0.16, 0.62, fabric, 0, seat.heightM - 0.2, -0.05));
  group.add(box(0.58, 0.1, 0.5, cushion, 0, seat.heightM - 0.05, -0.02));
  const back = box(0.72, 0.62, 0.16, fabric, 0, seat.heightM + 0.25, -0.34);
  back.rotation.x = -0.12;
  group.add(back);
  for (const sx of [-1, 1]) {
    group.add(box(0.12, 0.26, 0.62, fabric, sx * 0.36, seat.heightM + 0.06, -0.05));
    group.add(box(0.05, seat.heightM - 0.28, 0.05, wood, sx * 0.3, (seat.heightM - 0.28) / 2, 0.2));
    group.add(box(0.05, seat.heightM - 0.28, 0.05, wood, sx * 0.3, (seat.heightM - 0.28) / 2, -0.3));
  }
  group.position.set(seat.x, 0, seat.z);
  group.rotation.y = seat.yaw;
  return group;
}

export function buildShelf(): Group {
  const group = new Group();
  const wood = matte('#a07650', 0.75);
  const x = ROOM.halfWidthM - 0.18;
  const z = -0.2;
  const heightM = 1.9;
  const widthM = 0.9;
  group.add(box(0.32, heightM, 0.03, wood, x, heightM / 2, z - widthM / 2));
  group.add(box(0.32, heightM, 0.03, wood, x, heightM / 2, z + widthM / 2));
  const shelves = [0.02, 0.45, 0.9, 1.35, 1.88];
  for (const y of shelves) group.add(box(0.32, 0.03, widthM, wood, x, y, z));
  // Books as one instanced mesh, each a different size and colour.
  const rng = makeRng(21);
  const palette = ['#b5533c', '#3b5d78', '#d7ae5b', '#4d7954', '#7b4d6c', '#c9c2b2', '#2f3e46', '#a4683b'];
  const count = 46;
  const books = new InstancedMesh(new BoxGeometry(1, 1, 1), matte('#ffffff', 0.85), count);
  books.castShadow = true;
  books.receiveShadow = true;
  const m = new Matrix4();
  const colour = new Color();
  let i = 0;
  for (let s = 0; s < shelves.length - 1 && i < count; s++) {
    const base = (shelves[s] ?? 0) + 0.015;
    let cz = z - widthM / 2 + 0.03;
    while (cz < z + widthM / 2 - 0.08 && i < count) {
      const w = 0.025 + rng() * 0.03;
      const h = 0.22 + rng() * 0.14;
      const lean = rng() < 0.08 ? 0.18 : 0;
      m.makeRotationX(lean).setPosition(x - 0.02 - rng() * 0.03, base + h / 2, cz + w / 2);
      m.scale(new Vector3(0.2 + rng() * 0.04, h, w));
      books.setMatrixAt(i, m);
      colour.set(palette[Math.floor(rng() * palette.length)] ?? '#888888');
      books.setColorAt(i, colour);
      cz += w + 0.004;
      i += 1;
    }
    cz += 0.04;
  }
  books.count = i;
  group.add(books);
  return group;
}

export function buildRug(): Mesh {
  const rug = new Mesh(new BoxGeometry(2.3, 0.012, 1.6), matte('#c4876a', 0.98));
  rug.position.set(0.1, 0.006, -0.4);
  rug.receiveShadow = true;
  const border = new Mesh(new BoxGeometry(2.1, 0.013, 1.4), matte('#d9a484', 0.98));
  border.position.y = 0.001;
  border.receiveShadow = true;
  rug.add(border);
  return rug;
}

export interface Clock {
  group: Group;
  hourHand: Object3D;
  minuteHand: Object3D;
}

/** A plain wall clock above the desk. In the time-lapse its hands spin. */
export function buildClock(): Clock {
  const group = new Group();
  const face = new Mesh(new CylinderGeometry(0.16, 0.16, 0.02, 40), matte('#f6f1e6', 0.6));
  face.rotation.x = Math.PI / 2;
  group.add(face);
  const rim = new Mesh(new CylinderGeometry(0.175, 0.175, 0.015, 40), matte('#4a3a2c', 0.6));
  rim.rotation.x = Math.PI / 2;
  rim.position.z = -0.004;
  group.add(rim);
  const ink = new MeshStandardNodeMaterial({ color: new Color('#262626'), roughness: 0.6 });
  for (let k = 0; k < 12; k++) {
    const tick = new Mesh(new BoxGeometry(0.008, k % 3 === 0 ? 0.03 : 0.015, 0.004), ink);
    const a = (k / 12) * Math.PI * 2;
    tick.position.set(Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0.012);
    tick.rotation.z = -a;
    group.add(tick);
  }
  const hand = (length: number, width: number): Object3D => {
    const pivot = new Object3D();
    const bar = new Mesh(new BoxGeometry(width, length, 0.004), ink);
    bar.position.y = length / 2 - 0.015;
    pivot.add(bar);
    pivot.position.z = 0.016;
    group.add(pivot);
    return pivot;
  };
  const hourHand = hand(0.08, 0.012);
  const minuteHand = hand(0.12, 0.008);
  group.position.set(ROOM.desk.x, 2.02, ROOM.backZ + 0.025);
  return { group, hourHand, minuteHand };
}

/** A small plant on the window sill, which grows through the film. */
export function buildSillPlant(): Group {
  const group = new Group();
  group.add(cylinder(0.07, 0.055, 0.12, matte('#b4674a', 0.8), 0, 0.06, 0));
  const leafMaterial = matte('#5f8f4a', 0.85);
  const rng = makeRng(5);
  for (let k = 0; k < 7; k++) {
    const leaf = new Mesh(new IcosahedronGeometry(0.045 + rng() * 0.02, 0), leafMaterial);
    const a = rng() * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.05, 0.16 + rng() * 0.09, Math.sin(a) * 0.05);
    leaf.scale.set(1, 0.7, 1);
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.set(ROOM.window.x + 0.45, ROOM.window.sillM + 0.02, ROOM.backZ + 0.05);
  return group;
}

/** Dust in the sunbeam: a few dozen specks, placed by the room every frame. */
export function buildDust(count: number): InstancedMesh {
  const dust = new InstancedMesh(new IcosahedronGeometry(0.0024, 0), new MeshBasicNodeMaterial({ color: new Color('#e9dfc8') }), count);
  dust.instanceMatrix.setUsage(DynamicDrawUsage);
  dust.frustumCulled = false;
  return dust;
}
