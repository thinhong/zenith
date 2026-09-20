import { createRenderer } from '@/core/renderer';
import { createCameraRig } from '@/core/camera';
import { startLoop } from '@/core/loop';
import { createWorld } from '@/world/world';
import { createHud } from '@/ui/hud';
import { altitudeBand } from '@/state/altitude';
import { readSettings } from '@/state/settings';
import { TERRAIN } from '@/world/terrain';

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');

  const settings = readSettings();
  const { renderer, backend } = await createRenderer(container);
  const rig = createCameraRig(renderer.domElement, {
    startAltitudeM: settings.startAltitudeM ?? undefined,
    startTarget: settings.startTarget ?? undefined,
    panLimitM: TERRAIN.cityRadiusM,
  });
  const world = createWorld({
    seed: settings.seed,
    startHour: settings.startHour,
    paused: settings.paused,
    camera: rig.camera,
    canvas: container,
  });
  const hud = createHud();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      world.clock.paused = !world.clock.paused;
    }
  });

  let view = rig.view();
  let fps = 0;

  startLoop({
    update: (dt, elapsed) => {
      renderer.info.reset();
      rig.update(dt);
      view = rig.view();
      fps = 1 / Math.max(dt, 1e-6);
      world.update(dt, elapsed, view);
    },
    render: () => {
      renderer.render(world.scene, rig.camera);
      // After render(), so the counters describe the frame just drawn.
      const stats = renderer.info.render;
      hud.set(
        `backend: ${backend}\n` +
          `altitude: ${view.altitudeM.toFixed(0)} m (${altitudeBand(view.altitudeM)})\n` +
          `${world.info()}\n` +
          `draws: ${stats.drawCalls}  tris: ${stats.triangles.toFixed(0)}\n` +
          `fps: ${fps.toFixed(0)}`,
      );
    },
  });

  const onResize = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  };
  window.addEventListener('resize', onResize);
  onResize();
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('app');
  if (el) el.textContent = 'Zenith could not start. Your browser may not support WebGL2/WebGPU.';
});
