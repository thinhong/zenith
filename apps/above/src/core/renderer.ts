import { WebGPURenderer } from 'three/webgpu';
import { NeutralToneMapping, SRGBColorSpace } from 'three';

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
  // A phone reports a device pixel ratio of 3, and with the post-processing
  // chain on top that is nine times the fragment work of drawing at 1. The
  // difference between 1.5 and 2 is not visible at arm's length; the
  // difference in frame rate is.
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 760;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow ? 1.5 : 2));
  // three resets these counters inside its own animation loop, which runs
  // before ours and would always hand the HUD zeroes. core/loop.ts drives the
  // frame here, so reset them there instead.
  renderer.info.autoReset = false;
  renderer.outputColorSpace = SRGBColorSpace;
  // Khronos PBR Neutral. It is close to linear below about 0.8 and rolls the
  // top off gently, and unlike ACES it does not drain the colour out of a
  // bright roof, which is the whole look (PLAN.md 5).
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  // The sun only casts below the roof band; see world/world.ts.
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  const backend: Backend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
