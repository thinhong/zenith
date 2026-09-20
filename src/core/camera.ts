import { PerspectiveCamera } from 'three';
import { MOUSE, TOUCH } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ALTITUDE } from '@/state/altitude';

export interface CameraRigOptions {
  startAltitudeM?: number;
  /** Ground point to look at. Defaults to the centre of the world. */
  startTarget?: { x: number; z: number };
  /** How far the viewer may pan the look-at point from the centre, in metres. */
  panLimitM?: number;
}

/** What every system reads each frame: how high, and over what. */
export interface ViewState {
  altitudeM: number;
  targetX: number;
  targetZ: number;
}

export interface CameraRig {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  /** Height of the camera above the ground plane, in metres. */
  altitude: () => number;
  view: () => ViewState;
  update: (dt: number) => void;
  resize: (w: number, h: number) => void;
}

/** Opening view: looking down at about 30 degrees off vertical (PLAN.md 2). */
const START_TILT = 0.58;

/**
 * A single orbit camera whose distance-to-target is the "altitude" of the
 * viewer. Zooming (scroll / pinch) changes altitude; altitude drives what the
 * world shows. The polar angle is clamped so the viewer always looks down.
 */
export function createCameraRig(domElement: HTMLElement, options: CameraRigOptions = {}): CameraRig {
  const startAltitudeM = options.startAltitudeM ?? ALTITUDE.start;
  const panLimitM = options.panLimitM ?? ALTITUDE.max;

  const target = options.startTarget ?? { x: 0, z: 0 };

  const camera = new PerspectiveCamera(45, 1, 1, ALTITUDE.max * 4);
  camera.position.set(target.x, startAltitudeM, target.z + startAltitudeM * START_TILT);
  camera.lookAt(target.x, 0, target.z);

  const controls = new OrbitControls(camera, domElement);
  controls.target.set(target.x, 0, target.z);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = ALTITUDE.min;
  controls.maxDistance = ALTITUDE.max;
  controls.minPolarAngle = 0.05; // almost straight down
  controls.maxPolarAngle = Math.PI * 0.42; // never below the horizon
  controls.zoomSpeed = 0.6;
  controls.screenSpacePanning = false;
  /**
   * Touch: one finger moves over the town, two fingers pinch to rise and fall
   * and twist to turn. That is what every map does, and it is what a hand
   * expects here, where the view is from above and moving is the common thing.
   * three's default is the opposite way round, with one finger turning, which
   * on a phone means you cannot go anywhere without rotating the world.
   */
  controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
  // The mouse keeps the usual arrangement: drag turns, right-drag moves.
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

  const altitude = (): number => Math.max(0, camera.position.y - controls.target.y);

  return {
    camera,
    controls,
    altitude,
    view: () => ({ altitudeM: altitude(), targetX: controls.target.x, targetZ: controls.target.z }),
    update: () => {
      controls.update();
      clampTarget(controls, panLimitM);
      updateClipPlanes(camera, altitude());
    },
    resize: (w, h) => {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    },
  };
}

/** Panning must not carry the viewer off the edge of the world. */
function clampTarget(controls: OrbitControls, panLimitM: number): void {
  const r = Math.hypot(controls.target.x, controls.target.z);
  if (r > panLimitM) {
    const k = panLimitM / r;
    controls.target.x *= k;
    controls.target.z *= k;
  }
  controls.target.y = 0;
}

/**
 * Depth precision scales with the near plane, and Zenith spans 12 m to 6 km.
 * A fixed near plane of 1 m leaves metres of depth error at satellite height,
 * which makes the roads fight with the ground they are painted on. Growing the
 * near plane with altitude keeps the error well under the layer offsets in
 * world/ground.ts. The thresholds only trip on a real change, so the projection
 * matrix is not rebuilt every frame.
 */
function updateClipPlanes(camera: PerspectiveCamera, altitudeM: number): void {
  const near = Math.min(90, Math.max(0.5, altitudeM * 0.012));
  const far = altitudeM * 3 + 8000;
  const nearDrift = near < camera.near * 0.8 || near > camera.near * 1.25;
  const farDrift = far < camera.far * 0.8 || far > camera.far * 1.25;
  if (!nearDrift && !farDrift) return;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}
