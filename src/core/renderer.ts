import { WebGPURenderer } from 'three/webgpu';
import { SRGBColorSpace } from 'three';

export type Backend = 'webgpu' | 'webgl2';

/**
 * Creates the renderer. WebGPURenderer uses WebGPU where available and
 * transparently falls back to a WebGL2 backend otherwise, so the rest of the
 * app never needs to know which one is active.
 */
export async function createRenderer(
  container: HTMLElement,
): Promise<{ renderer: WebGPURenderer; backend: Backend }> {
  const renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // three resets these counters inside its own animation loop, which runs
  // before ours and would always hand the HUD zeroes. core/loop.ts drives the
  // frame here, so reset them there instead.
  renderer.info.autoReset = false;
  renderer.outputColorSpace = SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const backend: Backend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
