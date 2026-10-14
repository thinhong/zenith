import type { Camera, Scene } from 'three';
import { Color } from 'three';
import { RenderPipeline, type Node, type WebGPURenderer } from 'three/webgpu';
import { float, hash, mix, pass, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

/**
 * What happens to the picture after it is drawn, and why each step is there:
 *
 * - **Depth of field.** A film lens is sharp at one distance. Close-ups blur
 *   the window behind her, which is most of what makes them look shot rather
 *   than rendered.
 * - **Bloom.** The window and the light that leaves her spill past their edges.
 * - **Grade, vignette and grain.** A warm or cool cast set by the hour, corners
 *   a little darker than the middle, and a faint moving grain so flat colour
 *   does not read as a screen.
 * - **Fade.** The joins between lives go through black.
 */
export const POST = {
  bloomStrength: 0.38,
  bloomRadius: 0.45,
  bloomThreshold: 0.82,
  vignetteInner: 0.32,
  vignetteOuter: 0.86,
  vignetteDepth: 0.3,
  grain: 0.03,
} as const;

export interface Post {
  render: () => void;
  /** Distance to what is sharp, and how far from it the blur is complete, in metres. */
  setFocus: (distanceM: number, spreadM: number) => void;
  setGrade: (tint: Color) => void;
  /** 0 clear, 1 black. */
  setDarkness: (amount: number) => void;
  setFrame: (frame: number) => void;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera): Post {
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();

  const focus = uniform(2);
  const spread = uniform(2);
  const tint = uniform(new Color(1, 1, 1));
  const darkness = uniform(0);
  const frame = uniform(0);

  // The typings give the effect node none of the swizzles a vec4 has; it is one.
  const sharp = dof(colour, viewZ, focus, spread, float(1)) as unknown as Node<'vec4'>;
  const glow = bloom(sharp, POST.bloomStrength, POST.bloomRadius, POST.bloomThreshold);
  const lit = sharp.rgb.add(glow.rgb);

  const graded = lit.mul(tint);
  const fromCentre = screenUV.sub(0.5).mul(vec2(1.25, 1)).length();
  const vignette = mix(float(1 - POST.vignetteDepth), float(1), smoothstep(POST.vignetteOuter, POST.vignetteInner, fromCentre));
  const noise = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)).add(frame.mul(9973)))
    .sub(0.5)
    .mul(POST.grain);
  const finished = graded.mul(vignette).add(noise);
  const faded = mix(finished, vec3(0, 0, 0), darkness);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = vec4(faded, 1);

  return {
    render: () => {
      pipeline.render();
    },
    setFocus: (distanceM, spreadM) => {
      focus.value = distanceM;
      spread.value = spreadM;
    },
    setGrade: (value) => {
      tint.value.copy(value);
    },
    setDarkness: (amount) => {
      darkness.value = amount;
    },
    setFrame: (value) => {
      frame.value = value % 1000;
    },
  };
}
