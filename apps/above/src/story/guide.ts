import { AdditiveBlending, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial } from 'three';
import { ROAD_LOOK } from '@/world/road-mesh';

/**
 * The small light that goes ahead of you to wherever the day is going next.
 * It is the only direction a day gives besides the person's own thought: no
 * arrow, no map. It keeps a little ahead along the way, waits when you fall
 * behind, and settles on whoever is waiting at the end.
 *
 * It is the same light the plan has always had for a soul (PLAN.md 2, step
 * 7), which is why it is gold.
 */
export const GUIDE = {
  /** How far ahead of you it keeps, along the way. */
  leadM: 9,
  /** Past this far from you it stops and waits. */
  waitM: 16,
  speedMS: 4.2,
  heightM: 1.55,
  bobM: 0.12,
  coreM: 0.085,
  haloM: 0.32,
  colour: 0xffe2a0,
  fadeS: 0.8,
} as const;

export interface Guide {
  group: Group;
  /** The way to go, as points on the ground. Empty hides the light. */
  setPath: (xs: readonly number[], zs: readonly number[]) => void;
  update: (dtS: number, fromX: number, fromZ: number, groundY: number) => void;
}

export function createGuide(): Guide {
  const group = new Group();
  group.name = 'story-guide';
  const coreMaterial = new MeshBasicMaterial({ color: GUIDE.colour, transparent: true });
  const haloMaterial = new MeshBasicMaterial({
    color: GUIDE.colour,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const core = new Mesh(new IcosahedronGeometry(GUIDE.coreM, 2), coreMaterial);
  const halo = new Mesh(new IcosahedronGeometry(GUIDE.haloM, 2), haloMaterial);
  // After the road layers, which are transparent and drawn in their own order.
  core.renderOrder = ROAD_LOOK.order.paint + 1;
  halo.renderOrder = ROAD_LOOK.order.paint + 2;
  group.add(core, halo);
  group.visible = false;

  let xs: number[] = [];
  let zs: number[] = [];
  /** Cumulative distance along the path at each point. */
  let along: number[] = [];
  /** Where the light is, as a distance along the path. */
  let at = 0;
  let shown = 0;
  let wanted = 0;
  let elapsedS = 0;

  function pointAt(distance: number): { x: number; z: number } {
    const total = along[along.length - 1] ?? 0;
    const d = Math.min(Math.max(distance, 0), total);
    for (let i = 1; i < along.length; i++) {
      const end = along[i] ?? 0;
      if (d <= end) {
        const start = along[i - 1] ?? 0;
        const t = end > start ? (d - start) / (end - start) : 0;
        const ax = xs[i - 1] ?? 0;
        const az = zs[i - 1] ?? 0;
        return { x: ax + ((xs[i] ?? ax) - ax) * t, z: az + ((zs[i] ?? az) - az) * t };
      }
    }
    return { x: xs[xs.length - 1] ?? 0, z: zs[zs.length - 1] ?? 0 };
  }

  /** The distance along the path of the point on it nearest (x, z). */
  function project(x: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 1; i < xs.length; i++) {
      const ax = xs[i - 1] ?? 0;
      const az = zs[i - 1] ?? 0;
      const bx = xs[i] ?? 0;
      const bz = zs[i] ?? 0;
      const dx = bx - ax;
      const dz = bz - az;
      const length2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length2));
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) {
        bestD = d;
        best = (along[i - 1] ?? 0) + Math.sqrt(length2) * t;
      }
    }
    return best;
  }

  return {
    group,
    setPath: (nextX, nextZ) => {
      xs = [...nextX];
      zs = [...nextZ];
      along = [0];
      for (let i = 1; i < xs.length; i++) {
        along.push((along[i - 1] ?? 0) + Math.hypot((xs[i] ?? 0) - (xs[i - 1] ?? 0), (zs[i] ?? 0) - (zs[i - 1] ?? 0)));
      }
      at = 0;
      wanted = xs.length > 1 ? 1 : 0;
    },
    update: (dtS, fromX, fromZ, groundY) => {
      elapsedS += dtS;
      shown += Math.sign(wanted - shown) * Math.min(Math.abs(wanted - shown), dtS / GUIDE.fadeS);
      group.visible = shown > 0.01;
      coreMaterial.opacity = shown;
      haloMaterial.opacity = 0.22 * shown;
      if (xs.length < 2) return;
      const total = along[along.length - 1] ?? 0;
      const you = project(fromX, fromZ);
      const target = Math.min(total, you + GUIDE.leadM);
      const here = pointAt(at);
      const far = Math.hypot(here.x - fromX, here.z - fromZ) > GUIDE.waitM;
      // Onwards only while you keep up; never back past where it has been.
      if (!far && at < target) at = Math.min(target, at + GUIDE.speedMS * dtS);
      if (at < you) at = you;
      const p = pointAt(at);
      group.position.set(p.x, groundY + GUIDE.heightM + Math.sin(elapsedS * 2.1) * GUIDE.bobM, p.z);
      // At the end of the way it has nothing left to show, and goes out.
      if (at >= total - 0.5 && Math.hypot(p.x - fromX, p.z - fromZ) < GUIDE.leadM) wanted = 0;
    },
  };
}
