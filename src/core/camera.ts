import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ALTITUDE } from '@/state/altitude';

export interface CameraRig {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  /** Height of the camera above the ground plane, in metres. */
  altitude: () => number;
  update: (dt: number) => void;
  resize: (w: number, h: number) => void;
}

/**
 * A single orbit camera whose distance-to-target is the "altitude" of the
 * viewer. Zooming (scroll / pinch) changes altitude; altitude drives what the
 * world shows. The polar angle is clamped so the viewer always looks down.
 */
export function createCameraRig(domElement: HTMLElement): CameraRig {
  const camera = new PerspectiveCamera(45, 1, 1, ALTITUDE.max * 4);
  camera.position.set(0, ALTITUDE.start, ALTITUDE.start * 0.6);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = ALTITUDE.min;
  controls.maxDistance = ALTITUDE.max;
  controls.minPolarAngle = 0.05; // almost straight down
  controls.maxPolarAngle = Math.PI * 0.42; // never below the horizon
  controls.zoomSpeed = 0.6;
  controls.screenSpacePanning = false;

  const tmp = new Vector3();

  return {
    camera,
    controls,
    altitude: () => Math.max(0, camera.position.y - controls.target.y),
    update: () => {
      controls.update();
      tmp.copy(camera.position);
    },
    resize: (w, h) => {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    },
  };
}
