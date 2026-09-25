import { AdditiveBlending, Color, Group, Mesh, PointLight, SphereGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { dot, normalView, positionViewDirection, pow, uniform } from 'three/tsl';

/**
 * How the light that leaves her looks: a bright pale-gold core, a soft halo
 * that fades at its rim, a short trail, and a real light that touches her face
 * and the room as it passes. The core is brighter than white so bloom spreads it.
 */
export interface SoulLight {
  group: Group;
  /** `lit` 0..1 is how much it lights the room; low while it is still inside her. */
  place: (position: Vector3, glow: number, lit: number) => void;
  hide: () => void;
}

const GOLD = '#ffe2a0';
const TRAIL = 6;

export function buildSoulLight(): SoulLight {
  const group = new Group();
  const strength = uniform(0);

  const coreMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  coreMaterial.colorNode = uniform(new Color(GOLD)).mul(strength.mul(3.2));
  coreMaterial.opacityNode = strength;
  const core = new Mesh(new SphereGeometry(0.022, 16, 12), coreMaterial);
  group.add(core);

  // The halo is brightest where it faces the eye and fades to nothing at its rim.
  const haloMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const facing = pow(dot(normalView, positionViewDirection.negate()).max(0), 2.5);
  haloMaterial.colorNode = uniform(new Color(GOLD)).mul(facing).mul(strength).mul(0.55);
  const halo = new Mesh(new SphereGeometry(0.11, 24, 16), haloMaterial);
  group.add(halo);

  const trailMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  trailMaterial.colorNode = uniform(new Color(GOLD)).mul(strength).mul(0.8);
  const trail: Mesh[] = [];
  for (let k = 0; k < TRAIL; k++) {
    const dot3 = new Mesh(new SphereGeometry(0.012 * (1 - k / TRAIL) + 0.003, 8, 6), trailMaterial);
    group.add(dot3);
    trail.push(dot3);
  }
  const history: Vector3[] = [];

  const light = new PointLight(GOLD, 0, 2.6, 1.6);
  group.add(light);
  group.visible = false;

  return {
    group,
    place: (position, glow, lit) => {
      group.visible = glow > 0.001;
      strength.value = glow;
      core.position.copy(position);
      halo.position.copy(position);
      light.position.copy(position);
      light.intensity = glow * lit * 0.3;
      history.unshift(position.clone());
      if (history.length > TRAIL * 3) history.pop();
      trail.forEach((mesh, k) => {
        const past = history[(k + 1) * 3] ?? position;
        mesh.position.copy(past);
      });
    },
    hide: () => {
      group.visible = false;
      light.intensity = 0;
      history.length = 0;
    },
  };
}
