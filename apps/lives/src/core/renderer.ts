import { NeutralToneMapping, PCFSoftShadowMap, SRGBColorSpace } from 'three';
import { WebGPURenderer } from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

/**
 * The renderer. WebGPU where the browser has it, WebGL2 otherwise; three
 * chooses by itself, and nothing else in the app needs to know which.
 */
export async function createRenderer(container: HTMLElement): Promise<{ renderer: WebGPURenderer; backend: Backend }> {
  const renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  await renderer.init();
  // Depth of field and bloom cost fragment work per pixel; a phone reports a
  // pixel ratio of 3, and 1.5 looks the same at arm's length.
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 760;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  // Neutral keeps the character's flat anime colours close to what the model
  // was painted with, and still rolls off a bright window gently.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const backend: Backend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
