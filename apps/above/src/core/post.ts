import type { Camera, Scene } from 'three';
import { PostProcessing, type WebGPURenderer } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  max,
  mix,
  mrt,
  normalView,
  output,
  pass,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

/**
 * Everything that happens to the picture after the world is drawn.
 *
 * Three effects, and each is here for a reason the geometry cannot supply:
 *
 * - **Tilt shift.** The frame is sharp in a band across the middle and blurred
 *   above and below it. This is the one that matters most: a depth of field
 *   that shallow only happens to something a few centimetres across, so the
 *   eye reads the whole town as a physical model on a table. It is the effect
 *   the piece is named for.
 * - **Outlines.** A dark line wherever depth or surface direction breaks.
 *   Drawn in screen space, which is the only way it can work here: an outline
 *   measured in metres that reads at 400 m is a heavy border at 12 m, and the
 *   zoom from satellite to street is the whole piece.
 * - **Bloom.** Lit windows spill past their own edges after dark. Without it a
 *   night city is a grid of bright rectangles that stop dead at the wall.
 *
 * The scene is drawn into a buffer with a second target carrying view-space
 * normals, because an edge between two surfaces facing different ways is not
 * an edge in depth: without normals, the corner where two walls of one
 * building meet has no line on it.
 */

export const POST = {
  /** Where the sharp band sits, 0 at the top of the frame and 1 at the bottom. */
  focusY: 0.55,
  /** Half the height of the sharp band, as a fraction of the frame. */
  focusHalf: 0.16,
  /** How far past the band the blur takes to reach full strength. */
  focusFalloff: 0.3,
  blurSigma: 3.5,
  /** How dark an edge goes, 0 to 1. */
  outlineStrength: 0.42,
  /**
   * How much the depth buffer has to jump between neighbouring pixels to count
   * as an edge. This is raw buffer depth, not metres: it is not linear, so the
   * same number means a different distance near and far. That is tolerable
   * here only because the camera's clip planes already scale with altitude
   * (core/camera.ts), which keeps the useful range of the buffer roughly
   * constant however high the view is.
   */
  depthEdge: 0.0009,
  depthEdgeFull: 0.006,
  /** How far apart in direction, as one minus the dot product. */
  normalEdge: 0.35,
  bloomStrength: 0.5,
  bloomRadius: 0.5,
  bloomThreshold: 0.72,
} as const;

export interface Post {
  render: () => void;
  /**
   * Tilt shift belongs to the view from above. Down at street level a human
   * eye would not see it, and blurring the top of the frame there just looks
   * like a smeared lens, so it fades out as the camera comes down.
   */
  setMiniature: (amount: number) => void;
  /** Bloom is a night effect. */
  setNight: (night: number) => void;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera): Post {
  const scenePass = pass(scene, camera);
  // A second target with the view-space normal in it, for the outlines.
  scenePass.setMRT(mrt({ output, normal: normalView }));

  const colour = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normal = scenePass.getTextureNode('normal');

  const miniature = uniform(1);
  const night = uniform(0);

  // --- outlines --------------------------------------------------------------
  const texel = vec2(1, 1).div(screenSize);
  const here = uv();
  const viewZ = (x: number, y: number) => depth.sample(here.add(vec2(x, y).mul(texel))).r;
  const normalAt = (x: number, y: number) => normal.sample(here.add(vec2(x, y).mul(texel))).xyz;

  // Only the neighbours that are *further* away count, so the line lands on
  // the near surface and a building is outlined rather than haloed.
  const d0 = viewZ(0, 0);
  const depthBreak = clamp(viewZ(1, 0).sub(d0))
    .add(clamp(viewZ(-1, 0).sub(d0)))
    .add(clamp(viewZ(0, 1).sub(d0)))
    .add(clamp(viewZ(0, -1).sub(d0)));
  const n0 = normalAt(0, 0);
  const turn = max(
    max(float(1).sub(normalAt(1, 0).dot(n0)), float(1).sub(normalAt(-1, 0).dot(n0))),
    max(float(1).sub(normalAt(0, 1).dot(n0)), float(1).sub(normalAt(0, -1).dot(n0))),
  );
  // An edge in depth has to scale with distance, or a town seen from two
  // kilometres is drawn entirely in outline: at that range a whole building is
  // thinner than the threshold a street-level view needs.
  const depthEdge = smoothstep(float(POST.depthEdge), float(POST.depthEdgeFull), depthBreak);
  const normalEdge = smoothstep(float(POST.normalEdge), float(POST.normalEdge * 2.4), turn);
  const edge = max(depthEdge, normalEdge).mul(POST.outlineStrength);
  const lined = vec4(colour.rgb.mul(float(1).sub(edge)), colour.a);

  // --- tilt shift ------------------------------------------------------------
  const blurred = gaussianBlur(lined, null, POST.blurSigma);
  const offBand = abs(screenUV.y.sub(POST.focusY)).sub(POST.focusHalf).max(0);
  const defocus = smoothstep(0, POST.focusFalloff, offBand).mul(miniature);
  const tilted = mix(lined, blurred, defocus);

  // --- bloom -----------------------------------------------------------------
  const glow = bloom(tilted, POST.bloomStrength, POST.bloomRadius, POST.bloomThreshold);
  const final = tilted.add(glow.mul(night));

  const postProcessing = new PostProcessing(renderer);
  postProcessing.outputNode = final;

  return {
    render: () => {
      postProcessing.render();
    },
    setMiniature: (amount) => {
      miniature.value = amount;
    },
    setNight: (value) => {
      night.value = value;
    },
  };
}
