import type { PerspectiveCamera } from 'three';
import type { ViewState } from '@/core/camera';
import { WALK } from '@/state/altitude';
import { moveBody, type Ground } from '@/walk/body';

/**
 * A person's eyes, and the hands that move them: keys and a mouse on a
 * computer, two thumbs on a phone. This owns the camera while it is active
 * and hands it back untouched otherwise.
 *
 * Yaw turns about the vertical, 0 looking down -z (three's default); pitch
 * tilts the head, clamped short of straight up or down.
 */
export const WALKER = {
  /** Radians per pixel of mouse movement, and of a thumb dragged across the glass. */
  mouseTurn: 0.0022,
  touchTurn: 0.0052,
  /** Radians per second from the arrow keys. */
  keyTurn: 1.9,
  maxPitch: 1.25,
  /** The thumb stick: pixels to full speed, and the dead zone in the middle. */
  stickPx: 58,
  stickDead: 0.12,
  /** A touch that moves less than this, this quickly, is a tap. */
  tapPx: 12,
  tapS: 0.3,
  /** Width of the screen, from the left, that belongs to the stick. */
  stickShare: 0.45,
  /** Head bob while walking, in metres, and steps per second. */
  bobM: 0.022,
  bobRate: 9,
  /** How quickly the eyes follow a change of ground height, per second. */
  settleRate: 10,
  /** Horizontal field of view to keep on any screen, and the vertical limits. */
  wideDeg: 75,
  minFovDeg: 50,
  maxFovDeg: 80,
} as const;

/**
 * The vertical field of view on foot, for a screen of this shape. The view
 * from above keeps a narrow one, which on a phone held upright is a slot:
 * on foot the width is what matters, so it is held at about 75 degrees and
 * the height follows, within limits.
 */
export function walkFovDeg(aspect: number): number {
  const half = (WALKER.wideDeg / 2) * (Math.PI / 180);
  const vertical = (2 * Math.atan(Math.tan(half) / Math.max(aspect, 0.1)) * 180) / Math.PI;
  return Math.min(WALKER.maxFovDeg, Math.max(WALKER.minFovDeg, vertical));
}

export interface WalkerOptions {
  camera: PerspectiveCamera;
  /** The element to take pointer and touch input from. */
  surface: HTMLElement;
  /** Height of whatever is underfoot: a pavement, the ground. */
  groundY: (x: number, z: number) => number;
  reducedMotion: boolean;
  /** A click, a tap, E or Space: talk, or go on. */
  onInteract: () => void;
}

export interface Walker {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  place: (x: number, z: number, faceX: number, faceZ: number) => void;
  setGround: (ground: Ground) => void;
  /** Input on or off. Off, the camera is left alone. */
  setActive: (active: boolean) => void;
  /** Standing still to talk: the feet stop, the head still turns. */
  setHeld: (held: boolean) => void;
  update: (dtS: number) => void;
  view: () => ViewState;
  /** Where the eyes are, and a point they are looking at, for a camera flying in or out. */
  eyes: () => { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number };
  resize: (width: number, height: number) => void;
  /** Lets the mouse go, so a button can be clicked. */
  releasePointer: () => void;
  pointerLocked: () => boolean;
}

export function createWalker(options: WalkerOptions): Walker {
  const { camera, surface } = options;
  let ground: Ground | null = null;
  let active = false;
  let held = false;
  let x = 0;
  let z = 0;
  let yaw = 0;
  let pitch = 0;
  let eyeY = WALK.eyeM;
  let bobPhase = 0;
  let aspect = 1;
  let fovBefore = camera.fov;
  let nearBefore = camera.near;

  const keys = new Set<string>();
  /** The thumb on the stick, and where it went down. */
  let stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  /** The thumb that looks, and where it was a moment ago. */
  let look: { id: number; x: number; y: number; startX: number; startY: number; atS: number } | null = null;

  const base = document.createElement('div');
  base.className = 'stick';
  const knob = document.createElement('div');
  knob.className = 'knob';
  base.appendChild(knob);
  document.body.appendChild(base);

  function forward(): { x: number; z: number } {
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  }

  function turn(dYaw: number, dPitch: number): void {
    yaw += dYaw;
    pitch = Math.min(WALKER.maxPitch, Math.max(-WALKER.maxPitch, pitch + dPitch));
  }

  function fitFov(): void {
    camera.fov = walkFovDeg(aspect);
    camera.updateProjectionMatrix();
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active) return;
    keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (!e.repeat) options.onInteract();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
    stick = null;
    look = null;
    base.classList.remove('on');
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!active) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (document.pointerLockElement === surface) options.onInteract();
      // Refused if asked again too soon after Esc let it go; the next click tries again.
      else surface.requestPointerLock?.()?.catch(() => undefined);
      return;
    }
    // Touch: the left of the screen walks, the right looks.
    const rect = surface.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width * WALKER.stickShare && !stick) {
      stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      knob.style.transform = 'translate(-50%, -50%)';
      base.classList.add('on');
    } else if (!look) {
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, atS: e.timeStamp / 1000 };
    }
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!active) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement === surface) turn(-e.movementX * WALKER.mouseTurn, -e.movementY * WALKER.mouseTurn);
      else if (e.buttons & 1) turn(-e.movementX * WALKER.mouseTurn * 1.6, -e.movementY * WALKER.mouseTurn * 1.6);
      return;
    }
    if (stick && e.pointerId === stick.id) {
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const length = Math.hypot(dx, dy);
      if (length > WALKER.stickPx) {
        dx = (dx / length) * WALKER.stickPx;
        dy = (dy / length) * WALKER.stickPx;
      }
      stick.dx = dx / WALKER.stickPx;
      stick.dy = dy / WALKER.stickPx;
      knob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    } else if (look && e.pointerId === look.id) {
      turn(-(e.clientX - look.x) * WALKER.touchTurn, -(e.clientY - look.y) * WALKER.touchTurn);
      look.x = e.clientX;
      look.y = e.clientY;
    }
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (stick && e.pointerId === stick.id) {
      stick = null;
      base.classList.remove('on');
    }
    if (look && e.pointerId === look.id) {
      const moved = Math.hypot(e.clientX - look.startX, e.clientY - look.startY);
      // By when the touches happened, not when they were handled: after a
      // long frame the two arrive together and a slow tap still counts.
      const quick = e.timeStamp / 1000 - look.atS < WALKER.tapS;
      look = null;
      if (active && moved < WALKER.tapPx && quick) options.onInteract();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  surface.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  function placeCamera(dtS: number, moving: number): void {
    const floor = options.groundY(x, z);
    const target = floor + WALK.eyeM;
    eyeY += (target - eyeY) * Math.min(1, dtS * WALKER.settleRate);
    if (!options.reducedMotion && moving > 0.05) bobPhase += dtS * WALKER.bobRate * Math.min(1.6, moving);
    const bob = options.reducedMotion ? 0 : Math.abs(Math.sin(bobPhase)) * WALKER.bobM * Math.min(1, moving);
    camera.position.set(x, eyeY + bob, z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  return {
    get x() {
      return x;
    },
    get z() {
      return z;
    },
    get yaw() {
      return yaw;
    },
    place: (px, pz, faceX, faceZ) => {
      x = px;
      z = pz;
      yaw = Math.atan2(-faceX, -faceZ);
      pitch = -0.04;
      eyeY = options.groundY(px, pz) + WALK.eyeM;
    },
    setGround: (next) => {
      ground = next;
    },
    setActive: (on) => {
      if (on === active) return;
      active = on;
      keys.clear();
      stick = null;
      look = null;
      base.classList.remove('on');
      if (on) {
        fovBefore = camera.fov;
        nearBefore = camera.near;
        camera.near = WALK.nearM;
        fitFov();
        placeCamera(0, 0);
      } else {
        if (document.pointerLockElement === surface) document.exitPointerLock?.();
        camera.fov = fovBefore;
        camera.near = nearBefore;
        camera.updateProjectionMatrix();
      }
    },
    setHeld: (on) => {
      held = on;
    },
    update: (dtS) => {
      if (!active) return;
      let ahead = 0;
      let side = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) ahead += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) ahead -= 1;
      if (keys.has('KeyD')) side += 1;
      if (keys.has('KeyA')) side -= 1;
      if (keys.has('ArrowLeft')) turn(WALKER.keyTurn * dtS, 0);
      if (keys.has('ArrowRight')) turn(-WALKER.keyTurn * dtS, 0);
      let hurry = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (stick) {
        const length = Math.hypot(stick.dx, stick.dy);
        if (length > WALKER.stickDead) {
          ahead -= stick.dy;
          side += stick.dx;
          // Pushed right to the rim is a hurry.
          hurry = hurry || length > 0.96;
        }
      }
      const length = Math.hypot(ahead, side);
      let moving = 0;
      if (!held && length > 1e-3 && ground) {
        const scale = Math.min(1, length) / length;
        const speed = hurry ? WALK.hurryMS : WALK.speedMS;
        const f = forward();
        // Right is forward turned a quarter clockwise, seen from above.
        const rx = -f.z;
        const rz = f.x;
        const dx = (f.x * ahead + rx * side) * scale * speed * dtS;
        const dz = (f.z * ahead + rz * side) * scale * speed * dtS;
        const next = moveBody(ground, x, z, dx, dz, WALK.radiusM);
        moving = Math.hypot(next.x - x, next.z - z) / Math.max(dtS * WALK.speedMS, 1e-6);
        x = next.x;
        z = next.z;
      }
      placeCamera(dtS, moving);
    },
    view: () => {
      const f = forward();
      return {
        altitudeM: WALK.eyeM,
        targetX: x + f.x * WALK.lookAheadM,
        targetZ: z + f.z * WALK.lookAheadM,
        eyeX: camera.position.x,
        eyeY: camera.position.y,
        eyeZ: camera.position.z,
        walking: true,
      };
    },
    eyes: () => {
      const f = forward();
      const floor = options.groundY(x, z);
      return {
        x,
        y: floor + WALK.eyeM,
        z,
        lookX: x + f.x * 10 * Math.cos(pitch),
        lookY: floor + WALK.eyeM + Math.sin(pitch) * 10,
        lookZ: z + f.z * 10 * Math.cos(pitch),
      };
    },
    resize: (width, height) => {
      aspect = width / Math.max(height, 1);
      if (active) fitFov();
    },
    releasePointer: () => {
      if (document.pointerLockElement === surface) document.exitPointerLock?.();
    },
    pointerLocked: () => document.pointerLockElement === surface,
  };
}
