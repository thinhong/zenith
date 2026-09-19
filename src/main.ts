import { createRenderer } from '@/core/renderer';
import { createCameraRig } from '@/core/camera';
import { startLoop } from '@/core/loop';
import { createWorld } from '@/world/world';
import { createHud } from '@/ui/hud';
import { altitudeBand } from '@/state/altitude';

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');

  const { renderer, backend } = await createRenderer(container);
  const rig = createCameraRig(renderer.domElement);
  const world = createWorld({ seed: 1 });
  const hud = createHud();

  startLoop({
    update: (dt, elapsed) => {
      rig.update(dt);
      world.update(dt, elapsed, rig.altitude());
      hud.set(
        `backend: ${backend}\n` +
          `altitude: ${rig.altitude().toFixed(0)} m (${altitudeBand(rig.altitude())})\n` +
          `fps: ${(1 / Math.max(dt, 1e-6)).toFixed(0)}`,
      );
    },
    render: () => {
      renderer.render(world.scene, rig.camera);
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
