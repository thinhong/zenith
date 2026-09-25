import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { luminance, materialColor, mix, texture, uniform, vec3, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  MToonMaterialLoaderPlugin,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  type VRMHumanBoneName,
} from '@pixiv/three-vrm';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { clamp, makeRng } from '@/film/ease';
import type { Face } from '@/film/stage';
import type { Look } from '@/life/age';
import type { Palette } from '@/life/lives';
import { OLD_TOP } from '@/life/lives';
import { reach, type Limb } from '@/character/ik';
import type { BoneName, Legs, PoseFrame } from '@/character/poses';

/**
 * The person: one anime model (a VRM file) that plays a whole life. This file
 * is the only one that touches the model. It poses the normalised bones from
 * the plain numbers in character/poses.ts, turns the head and eyes towards
 * what she looks at, blinks, and shows age with the cues in life/age.ts:
 * size, silver hair, glasses.
 */
export interface Actor {
  /** Placed and turned by the director. Scaled for a child. */
  root: Group;
  legs: Legs;
  pose: (frame: PoseFrame) => void;
  /** Puts a hand on a point in the room, the elbow bending towards `pole`, over the pose by `weight`. */
  reach: (side: 'left' | 'right', target: Vector3, pole: Vector3, weight: number) => void;
  /** Turns the head towards a point, on top of the pose, and the eyes with it. */
  gaze: (target: Vector3 | null, weight: number) => void;
  face: (face: Face, timeS: number, pace: number, still: boolean) => void;
  look: (look: Look, palette: Palette) => void;
  wind: (amount: number, timeS: number) => void;
  update: (dtS: number) => void;
  /** Puts the hair back at rest: at a cut the body jumps, and the hair must not fly. */
  resetPhysics: () => void;
  headWorld: (out: Vector3) => Vector3;
  chestWorld: (out: Vector3) => Vector3;
  setVisible: (visible: boolean) => void;
}

const CONTROLLED: readonly VRMHumanBoneName[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
  'leftThumbProximal', 'rightThumbProximal',
];

const GAZE = {
  /** How far the head turns before only the eyes go further, in radians. */
  maxYaw: 1.05,
  maxPitch: 0.45,
  /** Share of the turn taken by the neck; the head takes the rest. */
  neckShare: 0.35,
} as const;

/** Blinks every few seconds, seeded so two renders of a moment agree. */
function blinkSchedule(seed: number, spanS: number): number[] {
  const rng = makeRng(seed);
  const times: number[] = [];
  let t = 0.8;
  while (t < spanS) {
    times.push(t);
    t += 2.2 + rng() * 3.6;
    // Now and then a quick double blink.
    if (rng() < 0.15) times.push(t - 0.32);
  }
  return times.sort((a, b) => a - b);
}

function blinkAt(schedule: readonly number[], timeS: number, lengthS: number): number {
  let lo = 0;
  let hi = schedule.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((schedule[mid] ?? 0) <= timeS) lo = mid;
    else hi = mid - 1;
  }
  const start = schedule[lo] ?? -10;
  const since = timeS - start;
  if (since < 0 || since > lengthS) return 0;
  // Shut fast, open a little slower.
  const shut = lengthS * 0.38;
  return since < shut ? since / shut : 1 - (since - shut) / (lengthS - shut);
}

function buildGlasses(): Group {
  const frame = new MeshBasicNodeMaterial({ color: new Color('#5a4436') });
  const glasses = new Group();
  for (const side of [-1, 1]) {
    const rim = new Mesh(new TorusGeometry(0.021, 0.0019, 6, 28), frame);
    rim.scale.set(1.25, 1, 1);
    rim.position.set(side * 0.032, 0, 0);
    glasses.add(rim);
    const temple = new Mesh(new BoxGeometry(0.003, 0.003, 0.1), frame);
    temple.position.set(side * 0.056, 0.004, -0.05);
    glasses.add(temple);
  }
  const bridge = new Mesh(new CylinderGeometry(0.0016, 0.0016, 0.014, 6), frame);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.set(0, 0.006, 0);
  glasses.add(bridge);
  return glasses;
}

export async function loadActor(url: string): Promise<Actor> {
  const loader = new GLTFLoader();
  loader.register((parser) => {
    const mtoonMaterialPlugin = new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial });
    return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin });
  });
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`${url} is not a VRM model`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);
  VRMUtils.rotateVRM0(vrm);

  const root = new Group();
  root.add(vrm.scene);
  vrm.scene.traverse((object) => {
    object.frustumCulled = false;
    if ((object as Mesh).isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const humanoid = vrm.humanoid;
  const node = (name: VRMHumanBoneName): Object3D | null => humanoid.getNormalizedBoneNode(name);
  const hipsNode = node('hips');
  if (!hipsNode) throw new Error('the model has no hips');
  const hipsRest = hipsNode.position.clone();

  // Leg lengths, read off the model standing in its rest pose.
  vrm.scene.updateMatrixWorld(true);
  const worldY = (name: VRMHumanBoneName): number => node(name)?.getWorldPosition(new Vector3()).y ?? 0;
  const legs: Legs = {
    hipsM: worldY('hips'),
    thighM: Math.max(0.2, worldY('leftUpperLeg') - worldY('leftLowerLeg')),
    shinM: Math.max(0.2, worldY('leftLowerLeg') - worldY('leftFoot')),
  };

  // --- hair and clothes, recoloured in the shader --------------------------------
  const hairTint = uniform(new Color('#6b4a35'));
  const hairAmount = uniform(0);
  const grey = uniform(0);
  const silver = vec3(0.86, 0.87, 0.9);
  const recolour = (base: Node<'vec3'>): Node<'vec3'> => {
    const tinted = mix(base, vec3(luminance(base)).mul(hairTint).mul(2.2), hairAmount);
    return mix(tinted, vec3(luminance(tinted)).mul(silver).mul(2.6).add(0.3), grey);
  };
  const tops: Material[] = [];
  vrm.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const name = material.name;
      if (name.includes('_HAIR') && material instanceof MToonNodeMaterial) {
        const map = material.map;
        const base = map ? materialColor.mul(texture(map)) : vec4(materialColor, 1);
        material.colorNode = vec4(recolour(base.rgb), base.a);
        const shadeMap = material.shadeMultiplyTexture;
        // The same Color object the material reads, so it stays in step with it.
        const shadeFactor = uniform(material.shadeColorFactor).rgb;
        const shade = shadeMap ? shadeFactor.mul(texture(shadeMap).rgb) : shadeFactor;
        material.shadeColorNode = recolour(shade).mul(0.88);
        material.needsUpdate = true;
      }
      if (name.includes('Tops') && material instanceof MToonNodeMaterial && !tops.includes(material)) tops.push(material);
    }
  });
  const topColour = new Color();
  const oldTop = new Color().setRGB(OLD_TOP[0], OLD_TOP[1], OLD_TOP[2], SRGBColorSpace);

  // --- glasses, worn on the head --------------------------------------------------
  // Placed once, in the rest pose, in front of the eyes, then carried by the
  // skinned head bone wherever it goes. The model faces +Z at rest.
  const glasses = buildGlasses();
  const rawHead = humanoid.getRawBoneNode('head');
  if (rawHead) {
    const eyes = new Vector3();
    const leftEye = humanoid.getRawBoneNode('leftEye');
    const rightEye = humanoid.getRawBoneNode('rightEye');
    if (leftEye && rightEye) {
      eyes.copy(leftEye.getWorldPosition(new Vector3())).add(rightEye.getWorldPosition(new Vector3())).multiplyScalar(0.5);
    } else {
      rawHead.getWorldPosition(eyes).add(new Vector3(0, 0.063, 0.02));
    }
    const at = eyes.add(new Vector3(0, 0.005, 0.08));
    rawHead.add(glasses);
    glasses.position.copy(rawHead.worldToLocal(at));
    glasses.quaternion.copy(rawHead.getWorldQuaternion(new Quaternion()).invert());
  }
  glasses.visible = false;

  // --- wind in the hair ------------------------------------------------------------
  const joints = [...(vrm.springBoneManager?.joints ?? [])].map((joint) => ({
    joint,
    dir: joint.settings.gravityDir.clone(),
    power: joint.settings.gravityPower,
  }));
  const windDir = new Vector3(0.35, 0.1, 1).normalize();

  // --- eyes ----------------------------------------------------------------------------
  const eyeTarget = new Object3D();
  root.add(eyeTarget);
  if (vrm.lookAt) {
    vrm.lookAt.target = eyeTarget;
    vrm.lookAt.autoUpdate = true;
  }
  const blinks = blinkSchedule(1234, 4000);

  const euler = new Euler();
  const quat = new Quaternion();
  const posed = new Map<BoneName, readonly [number, number, number]>();
  const headPos = new Vector3();
  const toTarget = new Vector3();
  const inverse = new Quaternion();

  const limbOf = (side: 'left' | 'right'): Limb | null => {
    const upper = node(side === 'left' ? 'leftUpperArm' : 'rightUpperArm');
    const lower = node(side === 'left' ? 'leftLowerArm' : 'rightLowerArm');
    const hand = node(side === 'left' ? 'leftHand' : 'rightHand');
    return upper && lower && hand ? { upper, lower, hand } : null;
  };
  const limbs = { left: limbOf('left'), right: limbOf('right') };

  const setBone = (name: VRMHumanBoneName, e: readonly [number, number, number]): void => {
    const bone = node(name);
    if (!bone) return;
    euler.set(e[0], e[1], e[2], 'XYZ');
    bone.quaternion.setFromEuler(euler);
  };

  return {
    root,
    legs,
    pose: (frame) => {
      posed.clear();
      for (const name of CONTROLLED) {
        const e = frame.pose[name as BoneName] ?? [0, 0, 0];
        posed.set(name as BoneName, e);
        setBone(name, e);
      }
      hipsNode.position.set(hipsRest.x, hipsRest.y + frame.hipsOffset[0], hipsRest.z + frame.hipsOffset[1]);
    },
    reach: (side, target, pole, weight) => {
      const limb = limbs[side];
      if (limb) reach(limb, target, pole, weight);
    },
    gaze: (target, weight) => {
      if (!target || weight <= 0) {
        eyeTarget.position.set(0, 1.45, 2);
        return;
      }
      eyeTarget.position.copy(target);
      root.worldToLocal(eyeTarget.position);
      // Head turn: where the target is from the head, in the body's own frame.
      const head = node('head');
      if (!head) return;
      head.getWorldPosition(headPos);
      toTarget.copy(target).sub(headPos);
      root.getWorldQuaternion(inverse).invert();
      toTarget.applyQuaternion(inverse);
      const yaw = clamp(Math.atan2(toTarget.x, toTarget.z), -GAZE.maxYaw, GAZE.maxYaw) * weight;
      const pitch = clamp(Math.atan2(-toTarget.y, Math.hypot(toTarget.x, toTarget.z)), -GAZE.maxPitch, GAZE.maxPitch) * weight;
      const add = (name: 'neck' | 'head', share: number): void => {
        const base = posed.get(name) ?? [0, 0, 0];
        setBone(name, [base[0] + pitch * share, base[1] + yaw * share, base[2]]);
      };
      add('neck', GAZE.neckShare);
      add('head', 1 - GAZE.neckShare);
    },
    face: (face, timeS, pace, still) => {
      const em = vrm.expressionManager;
      if (!em) return;
      const blink = still ? 0 : blinkAt(blinks, timeS * pace, 0.17 / Math.max(0.5, pace));
      em.setValue('happy', face.happy);
      em.setValue('relaxed', face.relaxed);
      em.setValue('sad', face.sad);
      em.setValue('blink', Math.max(blink, face.closed));
    },
    look: (look, palette) => {
      root.scale.setScalar(look.scale);
      rawHead?.scale.setScalar(look.headScale);
      glasses.visible = look.glasses;
      grey.value = look.grey;
      hairTint.value.setRGB(palette.hair[0], palette.hair[1], palette.hair[2], SRGBColorSpace);
      hairAmount.value = palette.hairAmount * (1 - look.grey * 0.6);
      topColour.setRGB(palette.top[0], palette.top[1], palette.top[2], SRGBColorSpace).lerp(oldTop, look.fade * 0.7);
      for (const material of tops) {
        if (material instanceof MToonNodeMaterial) material.color.copy(topColour);
      }
    },
    wind: (amount, timeS) => {
      const gust = amount * (0.55 + 0.45 * Math.sin(timeS * 1.7) * Math.sin(timeS * 0.63 + 1));
      for (const { joint, dir, power } of joints) {
        joint.settings.gravityDir.copy(dir).addScaledVector(windDir, gust * 0.55).normalize();
        joint.settings.gravityPower = power + gust * 0.12;
      }
    },
    update: (dtS) => {
      vrm.update(dtS);
    },
    resetPhysics: () => {
      vrm.springBoneManager?.reset();
    },
    headWorld: (out) => node('head')?.getWorldPosition(out) ?? out,
    chestWorld: (out) => (node('upperChest') ?? node('chest'))?.getWorldPosition(out) ?? out,
    setVisible: (visible) => {
      root.visible = visible;
    },
  };
}
