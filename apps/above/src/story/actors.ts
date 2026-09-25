import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { figureGeometry, FIGURE } from '@/agents/figure';
import {
  attachInstanceColors,
  createTintedInstanceMaterial,
  markColorsChanged,
  markDynamic,
  writeInstanceMatrix,
} from '@/world/instanced';
import { ROAD_LOOK } from '@/world/road-mesh';

/**
 * The people a day is about, standing where the day needs them: the figure
 * every passer-by is made of, in their own clothes, plus the one grey cat
 * and a machine that floats. A faint ring on the ground marks whoever is
 * waiting for you; nothing else does.
 */
export const ACTORS = {
  max: 8,
  /** The ring round whoever is waiting. */
  ringInnerM: 0.55,
  ringOuterM: 0.7,
  ringColour: 0xf2d38a,
  /** How fast somebody turns to face you when you speak, in radians a second. */
  turnRate: 4,
  machineHoverM: 1.45,
  catColour: 0x86888a,
} as const;

export interface ActorPlace {
  id: string;
  kind: 'person' | 'cat' | 'machine';
  x: number;
  y: number;
  z: number;
  faceX: number;
  faceZ: number;
  clothes: number;
  scale: number;
  /** Waiting for you: the ring goes under them. */
  marked: boolean;
}

export interface Actors {
  group: Group;
  set: (places: readonly ActorPlace[]) => void;
  /** Turns whoever is named towards a point, as somebody does when spoken to. */
  update: (dtS: number, lookAt: { id: string | null; x: number; z: number }) => void;
  /** Where somebody's head is, for hanging their words over it. Null if they are not here. */
  head: (id: string) => { x: number; y: number; z: number } | null;
  near: (x: number, z: number, radiusM: number) => ActorPlace | null;
}

/** A small grey cat, sitting up. One white paw, front left, because there always is. */
function catGeometry(): BufferGeometry {
  const parts: { geometry: BufferGeometry; tint: [number, number, number] }[] = [];
  const add = (geometry: BufferGeometry, tint: [number, number, number]): void => {
    parts.push({ geometry: geometry.index ? geometry.toNonIndexed() : geometry, tint });
  };
  const grey: [number, number, number] = [1, 1, 1];
  const dark: [number, number, number] = [0.7, 0.7, 0.72];
  const white: [number, number, number] = [2.2, 2.2, 2.15];
  add(new BoxGeometry(0.34, 0.2, 0.18).translate(-0.02, 0.2, 0), grey);
  add(new BoxGeometry(0.16, 0.16, 0.15).translate(0.2, 0.34, 0), grey);
  add(new ConeGeometry(0.035, 0.07, 4).translate(0.2, 0.45, 0.045), dark);
  add(new ConeGeometry(0.035, 0.07, 4).translate(0.2, 0.45, -0.045), dark);
  add(new BoxGeometry(0.04, 0.12, 0.04).translate(0.1, 0.06, 0.06), white);
  add(new BoxGeometry(0.04, 0.12, 0.04).translate(0.1, 0.06, -0.06), grey);
  add(new BoxGeometry(0.04, 0.12, 0.04).translate(-0.14, 0.06, 0.06), grey);
  add(new BoxGeometry(0.04, 0.12, 0.04).translate(-0.14, 0.06, -0.06), grey);
  add(new BoxGeometry(0.28, 0.035, 0.035).rotateZ(0.9).translate(-0.26, 0.3, 0), dark);
  for (const part of parts) {
    const count = part.geometry.getAttribute('position').count;
    const colour = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colour.set(part.tint, i * 3);
    part.geometry.setAttribute('color', new BufferAttribute(colour, 3));
  }
  const merged = mergeGeometries(parts.map((part) => part.geometry));
  if (!merged) throw new Error('the cat did not merge');
  return merged;
}

export function createActors(): Actors {
  const group = new Group();
  group.name = 'story-actors';

  const people = new InstancedMesh(figureGeometry(), createTintedInstanceMaterial(), ACTORS.max);
  people.name = 'story-people';
  people.count = 0;
  people.frustumCulled = false;
  markDynamic(people);
  const colours = attachInstanceColors(people, ACTORS.max);
  const matrices = people.instanceMatrix.array as Float32Array;

  const catMaterial = new MeshLambertMaterial({ vertexColors: true, color: new Color(ACTORS.catColour) });
  const cat = new Mesh(catGeometry(), catMaterial);
  cat.name = 'story-cat';
  cat.visible = false;

  const machine = new Group();
  const shell = new Mesh(new IcosahedronGeometry(0.26, 1), new MeshLambertMaterial({ color: 0xe8edf0 }));
  const halo = new Mesh(new TorusGeometry(0.38, 0.025, 6, 28), new MeshBasicMaterial({ color: 0xbfe6ff }));
  halo.rotation.x = Math.PI / 2;
  machine.add(shell, halo);
  machine.name = 'story-machine';
  machine.visible = false;

  const ring = new Mesh(
    new RingGeometry(ACTORS.ringInnerM, ACTORS.ringOuterM, 40),
    new MeshBasicMaterial({ color: ACTORS.ringColour, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  // After the road layers, which are transparent too and drawn in their own
  // order: drawn before them, the pavement painted straight over the ring.
  ring.renderOrder = ROAD_LOOK.order.paint + 1;
  ring.name = 'story-ring';
  ring.visible = false;

  group.add(people, cat, machine, ring);
  for (const object of [people, cat, shell]) {
    object.castShadow = true;
    object.receiveShadow = true;
  }

  let placed: ActorPlace[] = [];
  /** Current heading of each, so a turn is a turn and not a snap. */
  const heading = new Map<string, number>();
  let elapsedS = 0;
  const colour = new Color();

  function draw(): void {
    let slot = 0;
    cat.visible = false;
    machine.visible = false;
    ring.visible = false;
    for (const actor of placed) {
      const angle = heading.get(actor.id) ?? Math.atan2(actor.faceZ, actor.faceX);
      if (actor.marked) {
        ring.visible = true;
        ring.position.set(actor.x, actor.y + 0.03, actor.z);
      }
      if (actor.kind === 'cat') {
        cat.visible = true;
        cat.position.set(actor.x, actor.y, actor.z);
        cat.rotation.y = -angle;
        continue;
      }
      if (actor.kind === 'machine') {
        machine.visible = true;
        machine.position.set(actor.x, actor.y + ACTORS.machineHoverM + Math.sin(elapsedS * 1.7) * 0.06, actor.z);
        machine.rotation.y = elapsedS * 0.6;
        continue;
      }
      if (slot >= ACTORS.max) continue;
      writeInstanceMatrix(matrices, slot, actor.x, actor.y, actor.z, -angle, actor.scale, actor.scale, actor.scale);
      colour.set(actor.clothes);
      colours[slot * 3] = colour.r;
      colours[slot * 3 + 1] = colour.g;
      colours[slot * 3 + 2] = colour.b;
      slot++;
    }
    people.count = slot;
    people.instanceMatrix.needsUpdate = true;
    markColorsChanged(people);
  }

  return {
    group,
    set: (next) => {
      placed = [...next];
      // Somebody already here keeps the way they were facing; they turn from there.
      for (const actor of placed) {
        if (!heading.has(actor.id)) heading.set(actor.id, Math.atan2(actor.faceZ, actor.faceX));
      }
      draw();
    },
    update: (dtS, lookAt) => {
      elapsedS += dtS;
      for (const actor of placed) {
        const want =
          actor.id === lookAt.id
            ? Math.atan2(lookAt.z - actor.z, lookAt.x - actor.x)
            : Math.atan2(actor.faceZ, actor.faceX);
        const now = heading.get(actor.id) ?? want;
        let delta = want - now;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), ACTORS.turnRate * dtS);
        heading.set(actor.id, now + step);
      }
      draw();
    },
    head: (id) => {
      const actor = placed.find((each) => each.id === id);
      if (!actor) return null;
      const height =
        actor.kind === 'cat' ? 0.5 : actor.kind === 'machine' ? ACTORS.machineHoverM + 0.3 : FIGURE.heightM * actor.scale;
      return { x: actor.x, y: actor.y + height, z: actor.z };
    },
    near: (x, z, radiusM) => {
      let best: ActorPlace | null = null;
      let bestD = radiusM;
      for (const actor of placed) {
        const d = Math.hypot(actor.x - x, actor.z - z);
        if (d < bestD) {
          bestD = d;
          best = actor;
        }
      }
      return best;
    },
  };
}
