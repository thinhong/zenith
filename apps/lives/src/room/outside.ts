import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  dot,
  floor,
  hash,
  max,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import { makeRng } from '@/film/ease';
import { ROOM } from '@/film/stage';
import type { Season, Sky } from '@/life/sky';
import { matte } from '@/room/materials';

/**
 * What is seen through the window: the sky, a tree, the ground, far hills.
 * The tree is the calendar of the film. It grows over the life, blossoms,
 * greens, turns and goes bare, and whatever the season lets go of falls past
 * the glass.
 */
export interface Outside {
  group: Group;
  update: (sky: Sky, season: Season, growth: number, wind: number, timeS: number) => void;
}

export const TREE = { x: -1.15, z: -4.3 } as const;

export function buildOutside(): Outside {
  const group = new Group();

  // --- sky ---------------------------------------------------------------------
  const top = uniform(new Color('#5b9be2'));
  const horizon = uniform(new Color('#d6e9f6'));
  const sunColour = uniform(new Color('#ffffff'));
  const sunDir = uniform(new Vector3(0, 0.5, -1).normalize());
  const sunAmount = uniform(1);
  const night = uniform(0);
  const skyMaterial = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  const dir = positionLocal.normalize();
  const upness = smoothstep(-0.02, 0.5, dir.y);
  const along = max(dot(dir, sunDir), 0);
  const halo = pow(along, 24).mul(0.35).add(pow(along, 600).mul(3.0)).mul(sunAmount);
  const cell = floor(dir.mul(220));
  const twinkle = step(0.9972, hash(cell.x.add(cell.y.mul(113)).add(cell.z.mul(7919))));
  const stars = twinkle.mul(night).mul(smoothstep(0.08, 0.35, dir.y)).mul(1.4);
  skyMaterial.colorNode = mix(horizon, top, upness).add(sunColour.mul(halo)).add(stars);
  const dome = new Mesh(new SphereGeometry(90, 40, 20), skyMaterial);
  dome.renderOrder = -1;
  group.add(dome);

  // --- ground, with snow in winter --------------------------------------------
  const snow = uniform(0);
  const groundMaterial = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const patch = mx_noise_float(positionWorld.xz.mul(0.35)).mul(0.5).add(0.5);
  const grass = mix(vec3(0.17, 0.3, 0.09), vec3(0.3, 0.42, 0.14), patch);
  groundMaterial.colorNode = mix(grass, vec3(0.9, 0.92, 0.96), snow.mul(smoothstep(0.2, 0.6, patch.add(snow.mul(0.6)))));
  const ground = new Mesh(new PlaneGeometry(160, 120), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, ROOM.backZ - 60.3);
  ground.receiveShadow = true;
  group.add(ground);

  // --- far hills, blued by the air between ---------------------------------
  const haze = uniform(new Color('#9fb6c8'));
  const hillMaterial = new MeshBasicNodeMaterial();
  hillMaterial.colorNode = mix(vec3(0.24, 0.36, 0.3), haze, 0.62).mul(night.mul(-0.55).add(1));
  for (const [x, z, r, h] of [
    [-22, -48, 20, 7],
    [8, -56, 26, 9],
    [30, -46, 18, 6],
    [-45, -60, 26, 10],
  ] as const) {
    const hill = new Mesh(new SphereGeometry(1, 24, 12), hillMaterial);
    hill.scale.set(r, h, r * 0.6);
    hill.position.set(x, -1, z);
    group.add(hill);
  }

  // --- a low fence across the garden ------------------------------------------
  const fenceWood = matte('#8b7358', 0.9);
  const posts = new InstancedMesh(new BoxGeometry(0.08, 0.9, 0.08), fenceWood, 26);
  const m = new Matrix4();
  for (let i = 0; i < 26; i++) {
    m.makeTranslation(-7 + i * 0.56, 0.45, -8.5);
    posts.setMatrixAt(i, m);
  }
  posts.castShadow = true;
  group.add(posts);
  for (const y of [0.35, 0.72]) {
    const rail = new Mesh(new BoxGeometry(14.5, 0.06, 0.04), fenceWood);
    rail.position.set(0, y, -8.46);
    group.add(rail);
  }

  // --- the tree ---------------------------------------------------------------
  const tree = new Group();
  tree.position.set(TREE.x, 0, TREE.z);
  const bark = matte('#5a4636', 0.95);
  const trunk = new Mesh(new CylinderGeometry(0.1, 0.17, 2.3, 10), bark);
  trunk.position.y = 1.15;
  trunk.castShadow = true;
  tree.add(trunk);
  const crown = new Group();
  crown.position.y = 2.2;
  tree.add(crown);
  const rng = makeRng(11);
  for (let k = 0; k < 5; k++) {
    const branch = new Mesh(new CylinderGeometry(0.03, 0.06, 1.3, 6), bark);
    const a = (k / 5) * Math.PI * 2 + rng() * 0.6;
    branch.position.set(Math.cos(a) * 0.3, 0.35, Math.sin(a) * 0.3);
    branch.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
    branch.castShadow = true;
    crown.add(branch);
  }
  const crownColour = uniform(new Color('#5c9a47'));
  const crownSnow = uniform(0);
  const leafMaterial = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const dapple = mx_noise_float(positionWorld.mul(3.1)).mul(0.18).add(0.92);
  leafMaterial.colorNode = mix(
    crownColour.mul(dapple),
    vec3(0.93, 0.95, 0.98),
    crownSnow.mul(smoothstep(0.35, 0.8, normalWorld.y)),
  );
  const blobs: Mesh[] = [];
  const blobGeometry = new IcosahedronGeometry(1, 2);
  for (let k = 0; k < 14; k++) {
    const blob = new Mesh(blobGeometry, leafMaterial);
    const a = rng() * Math.PI * 2;
    const r = 0.35 + rng() * 0.75;
    const size = 0.42 + rng() * 0.32;
    blob.position.set(Math.cos(a) * r, 0.5 + rng() * 1.1, Math.sin(a) * r * 0.8);
    blob.userData.size = size;
    blob.scale.setScalar(size);
    blob.castShadow = true;
    crown.add(blob);
    blobs.push(blob);
  }
  group.add(tree);

  // --- what falls: petals, leaves, snow ----------------------------------------
  const fallCount = 110;
  const fallMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const fallColour = uniform(new Color('#f7c9d6'));
  fallMaterial.colorNode = fallColour;
  const falling = new InstancedMesh(new PlaneGeometry(1, 0.7), fallMaterial, fallCount);
  falling.instanceMatrix.setUsage(DynamicDrawUsage);
  falling.frustumCulled = false;
  group.add(falling);
  const seeds = Array.from({ length: fallCount }, () => ({
    x: -2.4 + rng() * 4.2,
    z: ROOM.backZ - 0.25 - rng() * 3.2,
    offset: rng() * 10,
    speed: 0.8 + rng() * 0.5,
    freq: 0.6 + rng() * 0.9,
    phase: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 6,
  }));
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();
  const heightM = 3.4;

  return {
    group,
    update: (sky, season, growth, wind, timeS) => {
      top.value.setRGB(sky.top[0], sky.top[1], sky.top[2], SRGBColorSpace);
      horizon.value.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2], SRGBColorSpace);
      sunColour.value.setRGB(sky.sunColour[0], sky.sunColour[1], sky.sunColour[2], SRGBColorSpace);
      sunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      sunAmount.value = Math.min(1, sky.sun);
      night.value = sky.night;
      haze.value.setRGB(sky.horizon[0], sky.horizon[1], sky.horizon[2], SRGBColorSpace);
      snow.value = season.snow;
      crownSnow.value = season.snow;
      crownColour.value.setRGB(season.crown[0], season.crown[1], season.crown[2], SRGBColorSpace);

      tree.scale.setScalar(0.42 + 0.58 * growth);
      for (const blob of blobs) {
        const size = (blob.userData.size as number | undefined) ?? 0.5;
        blob.scale.setScalar(size * (0.25 + 0.75 * season.density));
      }
      crown.rotation.z = Math.sin(timeS * 0.9) * 0.015 * (0.4 + wind);
      crown.rotation.x = Math.sin(timeS * 0.7 + 1) * 0.01 * (0.4 + wind);

      const kind = season.fall;
      const sizeM = kind === 'leaf' ? 0.045 : kind === 'snow' ? 0.02 : 0.028;
      const fallSpeed = kind === 'leaf' ? 0.55 : kind === 'snow' ? 0.32 : 0.36;
      if (kind === 'leaf') fallColour.value.set('#d9823b');
      else if (kind === 'snow') fallColour.value.set('#f4f7fb');
      else fallColour.value.set('#f7c9d6');
      falling.count = Math.round(fallCount * season.fallAmount);
      const drift = 0.25 + wind * 0.5;
      for (let i = 0; i < falling.count; i++) {
        const seed = seeds[i];
        if (!seed) continue;
        const y = heightM - ((timeS * fallSpeed * seed.speed + seed.offset) % heightM);
        p.set(
          seed.x + Math.sin(timeS * seed.freq + seed.phase) * 0.18 + ((timeS * drift * 0.2 + seed.offset) % 1.5) - 0.75,
          y,
          seed.z + Math.cos(timeS * seed.freq * 0.7 + seed.phase) * 0.12,
        );
        e.set(timeS * seed.spin, timeS * seed.spin * 0.7 + seed.phase, 0);
        q.setFromEuler(e);
        s.setScalar(sizeM);
        m.compose(p, q, s);
        falling.setMatrixAt(i, m);
      }
      falling.instanceMatrix.needsUpdate = true;
    },
  };
}
