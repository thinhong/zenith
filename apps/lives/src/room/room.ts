import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { abs, attribute, dot, normalView, positionLocal, positionViewDirection, sin, uniform, uv, vec3 } from 'three/tsl';
import { lerp, makeRng } from '@/film/ease';
import { ROOM } from '@/film/stage';
import type { Season, Sky } from '@/life/sky';
import { buildArmchair, buildClock, buildDesk, buildDeskChair, buildDust, buildRug, buildShelf, buildSillPlant } from '@/room/furniture';
import { floorboards, matte, plaster } from '@/room/materials';
import { buildOutside } from '@/room/outside';

/**
 * The one room the film happens in: a floor, three walls, a window in the
 * back one, and the things a life collects. The light comes in through the
 * window, so the walls and the ceiling are there to cast shadow as much as to
 * be seen: the bright shape of the window on the floor is the sun's patch, and
 * it moves across the room as the day goes.
 */
export interface RoomState {
  sky: Sky;
  season: Season;
  /** 0 a young tree to 1 a grown one. */
  growth: number;
  /** Breeze through the open window, 0 to 1. */
  wind: number;
  /** Hour of the day, for the clock. May run past 24. */
  hour: number;
}

export interface Room {
  group: Group;
  update: (state: RoomState, timeS: number) => void;
}

const WALL_T = 0.16;

function slab(w: number, h: number, d: number, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoom(): Room {
  const group = new Group();
  const { halfWidthM, backZ, frontZ, heightM } = ROOM;
  const win = ROOM.window;
  const winLeft = win.x - win.widthM / 2;
  const winRight = win.x + win.widthM / 2;

  // --- shell ---------------------------------------------------------------
  const floor = new Mesh(new PlaneGeometry(halfWidthM * 2, frontZ - backZ), floorboards());
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (frontZ + backZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const wall = plaster();
  const bz = backZ - WALL_T / 2;
  // The back wall runs on past the side walls, so no light gets in at the corners.
  const outer = halfWidthM + WALL_T;
  group.add(slab(winLeft + outer, heightM, WALL_T, wall, (-outer + winLeft) / 2, heightM / 2, bz));
  group.add(slab(outer - winRight, heightM, WALL_T, wall, (winRight + outer) / 2, heightM / 2, bz));
  group.add(slab(win.widthM, win.sillM, WALL_T, wall, win.x, win.sillM / 2, bz));
  group.add(slab(win.widthM, heightM - win.topM, WALL_T, wall, win.x, (heightM + win.topM) / 2, bz));
  const depth = frontZ - backZ + WALL_T;
  group.add(slab(WALL_T, heightM, depth, wall, -halfWidthM - WALL_T / 2, heightM / 2, (frontZ + backZ - WALL_T) / 2));
  group.add(slab(WALL_T, heightM, depth, wall, halfWidthM + WALL_T / 2, heightM / 2, (frontZ + backZ - WALL_T) / 2));
  const ceiling = slab(halfWidthM * 2 + WALL_T * 2, 0.12, depth, matte('#efe8dc', 0.95), 0, heightM + 0.06, (frontZ + backZ - WALL_T) / 2);
  group.add(ceiling);

  const trim = matte('#cbb99f', 0.8);
  group.add(slab(halfWidthM * 2, 0.09, 0.02, trim, 0, 0.045, backZ + 0.01));
  group.add(slab(0.02, 0.09, frontZ - backZ, trim, -halfWidthM + 0.01, 0.045, (frontZ + backZ) / 2));
  group.add(slab(0.02, 0.09, frontZ - backZ, trim, halfWidthM - 0.01, 0.045, (frontZ + backZ) / 2));

  // --- window ------------------------------------------------------------------
  const frame = matte('#f2ede3', 0.7);
  const fz = backZ - WALL_T / 2;
  const bar = 0.06;
  group.add(slab(win.widthM, bar, WALL_T + 0.02, frame, win.x, win.topM - bar / 2, fz));
  group.add(slab(win.widthM, bar, WALL_T + 0.02, frame, win.x, win.sillM + bar / 2, fz));
  group.add(slab(bar, win.topM - win.sillM, WALL_T + 0.02, frame, winLeft + bar / 2, (win.topM + win.sillM) / 2, fz));
  group.add(slab(bar, win.topM - win.sillM, WALL_T + 0.02, frame, winRight - bar / 2, (win.topM + win.sillM) / 2, fz));
  group.add(slab(0.04, win.topM - win.sillM, 0.05, frame, win.x, (win.topM + win.sillM) / 2, fz));
  group.add(slab(win.widthM, 0.04, 0.05, frame, win.x, win.sillM + (win.topM - win.sillM) * 0.7, fz));
  group.add(slab(win.widthM + 0.2, 0.04, 0.24, frame, win.x, win.sillM - 0.02, backZ + 0.03));
  const plant = buildSillPlant();
  group.add(plant);

  // Curtains either side, moving in the breeze.
  const breeze = uniform(0);
  const clockS = uniform(0);
  const curtainMaterial = new MeshStandardNodeMaterial({ color: new Color('#f3eadb'), roughness: 0.95, side: DoubleSide });
  const folds = sin(positionLocal.x.mul(48)).mul(0.022);
  const hang = uv().y.oneMinus();
  const sway = sin(clockS.mul(1.3).add(positionLocal.y.mul(2.2))).mul(breeze).mul(hang).mul(0.07);
  curtainMaterial.positionNode = positionLocal.add(vec3(sway.mul(0.3), 0, folds.add(sway)));
  for (const side of [-1, 1]) {
    const curtain = new Mesh(new PlaneGeometry(0.46, 1.8, 30, 12), curtainMaterial);
    curtain.position.set(win.x + side * (win.widthM / 2 + 0.2), win.topM + 0.15 - 0.9, backZ + 0.1);
    curtain.castShadow = true;
    curtain.receiveShadow = true;
    group.add(curtain);
  }
  group.add(slab(win.widthM + 1.1, 0.025, 0.025, matte('#7a5b3f', 0.6), win.x, win.topM + 0.16, backZ + 0.1));

  // --- furniture ---------------------------------------------------------------
  const desk = buildDesk();
  group.add(desk.group);
  group.add(buildDeskChair());
  group.add(buildArmchair());
  group.add(buildShelf());
  group.add(buildRug());
  const clock = buildClock();
  group.add(clock.group);
  // A picture on the left wall.
  const picture = slab(0.03, 0.42, 0.56, matte('#6b5440', 0.7), -halfWidthM + 0.02, 1.55, -0.3);
  picture.add(slab(0.01, 0.34, 0.48, matte('#9db4a8', 0.9), 0.012, 0, 0));
  group.add(picture);

  // --- outside -----------------------------------------------------------------
  const outside = buildOutside();
  group.add(outside.group);

  // --- light -------------------------------------------------------------------
  const sun = new DirectionalLight('#ffffff', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -5.5;
  cam.right = 5.5;
  cam.top = 5.5;
  cam.bottom = -5.5;
  cam.near = 1;
  cam.far = 45;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(-0.4, 0.4, -1.4);
  group.add(sun, sun.target);
  const skyFill = new HemisphereLight('#bcd6f0', '#8a6a4f', 0.6);
  group.add(skyFill);
  const bounce = new AmbientLight('#ffe0c2', 0.2);
  group.add(bounce);

  // --- the sunbeam: a faint volume from the window to the floor -------------
  const shaftGeometry = new BufferGeometry();
  const shaftPositions = new Float32Array(8 * 3);
  const shaftAlong = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);
  const shaftPositionAttr = new BufferAttribute(shaftPositions, 3);
  shaftGeometry.setAttribute('position', shaftPositionAttr);
  shaftGeometry.setAttribute('along', new BufferAttribute(shaftAlong, 1));
  // Four sides of the box between the window's quad (0-3) and the floor's (4-7).
  shaftGeometry.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  const beamColour = uniform(new Color('#ffe9c4'));
  const beamStrength = uniform(0);
  const shaftMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
  // Faces seen side-on fade out, or the beam's edges show as hard lines.
  const faceOn = abs(dot(normalView, positionViewDirection)).pow(1.3);
  shaftMaterial.colorNode = beamColour
    .mul(beamStrength)
    .mul(attribute<'float'>('along', 'float').oneMinus().pow(1.6).mul(0.9).add(0.1))
    .mul(faceOn);
  const shaft = new Mesh(shaftGeometry, shaftMaterial);
  shaft.frustumCulled = false;
  shaft.renderOrder = 2;
  group.add(shaft);

  const dustCount = 50;
  const dust: InstancedMesh = buildDust(dustCount);
  group.add(dust);
  const rng = makeRng(33);
  const specks = Array.from({ length: dustCount }, () => ({ u: rng(), v: rng(), w: rng(), f: 0.1 + rng() * 0.25, p: rng() * 6.28 }));

  const corners = [
    new Vector3(winLeft, win.sillM, backZ),
    new Vector3(winRight, win.sillM, backZ),
    new Vector3(winRight, win.topM, backZ),
    new Vector3(winLeft, win.topM, backZ),
  ];
  const onFloor = corners.map((c) => c.clone());
  const light = new Vector3();
  const m = new Matrix4();
  const at = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const unit = new Object3D();
  const upWindow = new Vector3();
  const upFloor = new Vector3();

  return {
    group,
    update: (state, timeS) => {
      const { sky } = state;
      light.set(-sky.sunDir[0], -sky.sunDir[1], -sky.sunDir[2]);
      sun.color.setRGB(sky.sunColour[0], sky.sunColour[1], sky.sunColour[2], SRGBColorSpace);
      sun.intensity = sky.sun * 3.1;
      sun.position.copy(sun.target.position).addScaledVector(light, -24);
      skyFill.color.setRGB(lerp(sky.top[0], sky.horizon[0], 0.5), lerp(sky.top[1], sky.horizon[1], 0.5), lerp(sky.top[2], sky.horizon[2], 0.5), SRGBColorSpace);
      skyFill.intensity = sky.ambient * 1.25;
      bounce.intensity = 0.08 + sky.sun * 0.32;

      desk.lamp.light.intensity = sky.lamp * 1.8;
      desk.lamp.bulb.color.set(sky.lamp > 0.5 ? '#fff4d6' : '#d8d2c4');

      const hour = ((state.hour % 24) + 24) % 24;
      clock.hourHand.rotation.z = -(hour / 12) * Math.PI * 2;
      clock.minuteHand.rotation.z = -(hour % 1) * Math.PI * 2;

      breeze.value = state.wind;
      clockS.value = timeS;
      plant.scale.setScalar(0.75 + 0.5 * state.growth);

      // The beam runs from the window along the light until it meets the floor.
      corners.forEach((corner, i) => {
        const down = light.y < -0.05 ? corner.y / -light.y : 6;
        const reach = Math.min(down, (ROOM.frontZ - corner.z) / Math.max(0.05, light.z));
        const end = onFloor[i];
        if (end) end.copy(corner).addScaledVector(light, reach);
        shaftPositions.set([corner.x, corner.y, corner.z], i * 3);
        shaftPositions.set([end?.x ?? 0, end?.y ?? 0, end?.z ?? 0], (i + 4) * 3);
      });
      shaftPositionAttr.needsUpdate = true;
      shaftGeometry.computeVertexNormals();
      beamColour.value.setRGB(sky.sunColour[0], sky.sunColour[1], sky.sunColour[2], SRGBColorSpace);
      beamStrength.value = Math.max(0, sky.sun - 0.15) * 0.03;

      // Specks of dust drift slowly inside the beam and show only in the sun.
      const [c0, c1, , c3] = corners;
      const [f0, f1, , f3] = onFloor;
      if (c0 && c3 && f0 && f3) {
        upWindow.copy(c3).sub(c0);
        upFloor.copy(f3).sub(f0);
      }
      specks.forEach((speck, i) => {
        if (!c0 || !c1 || !f0 || !f1) return;
        const u = (speck.u + timeS * 0.006 * speck.f) % 1;
        const v = 0.5 + 0.45 * Math.sin(speck.v * 6.28 + timeS * speck.f * 0.3);
        const w = 0.5 + 0.45 * Math.sin(speck.w * 6.28 + timeS * speck.f * 0.2 + speck.p);
        a.copy(c0).lerp(c1, v).addScaledVector(upWindow, w);
        b.copy(f0).lerp(f1, v).addScaledVector(upFloor, w);
        at.copy(a).lerp(b, 0.15 + u * 0.8);
        unit.position.copy(at);
        unit.scale.setScalar(sky.sun > 0.2 ? 1 : 0.001);
        unit.updateMatrix();
        m.copy(unit.matrix);
        dust.setMatrixAt(i, m);
      });
      dust.instanceMatrix.needsUpdate = true;

      outside.update(sky, state.season, state.growth, state.wind, timeS);
    },
  };
}
