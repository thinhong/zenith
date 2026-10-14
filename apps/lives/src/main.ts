import { PerspectiveCamera, Scene } from 'three';
import { loadActor } from '@/character/actor';
import { createPost } from '@/core/post';
import { createRenderer } from '@/core/renderer';
import { createDirector } from '@/film/director';
import { buildRoom } from '@/room/room';
import { buildSoulLight } from '@/soul/light';
import { readSettings } from '@/state/settings';

/** The film's frame is always twice as wide as it is tall. */
const FRAME_ASPECT = 2;
const MODEL = 'models/VRM1_Constraint_Twist_Sample.vrm';

declare global {
  interface Window {
    /**
     * Present only in capture mode (`?capture=12`): `frame` renders the next
     * frame, `seek` jumps to a moment and lets the hair settle there.
     */
    lives?: { frame: () => Promise<void>; seek: (timeS: number) => Promise<void> };
  }
}

async function main(): Promise<void> {
  const settings = readSettings();
  const film = document.getElementById('film');
  const hud = document.getElementById('hud');
  const home = document.getElementById('home');
  if (!film || !hud || !home) throw new Error('the page is missing its elements');
  if (home instanceof HTMLAnchorElement) home.href = `${import.meta.env.BASE_URL}../`;
  hud.classList.toggle('hidden', !settings.debug);

  const { renderer, backend } = await createRenderer(film);
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, FRAME_ASPECT, 0.05, 220);
  const room = buildRoom();
  scene.add(room.group);
  const actor = await loadActor(`${import.meta.env.BASE_URL}${MODEL}`);
  scene.add(actor.root);
  const soul = buildSoulLight();
  scene.add(soul.group);
  const post = createPost(renderer, scene, camera);
  const director = createDirector({
    camera,
    actor,
    room,
    soul,
    post,
    firstLife: settings.life,
    reducedMotion: settings.reducedMotion,
    view: settings.view,
  });

  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const width = Math.min(w, h * FRAME_ASPECT);
    renderer.setSize(Math.round(width), Math.round(width / FRAME_ASPECT));
  };
  window.addEventListener('resize', resize);
  resize();

  let filmS = settings.startS;
  let paused = settings.paused;
  let frameNo = 0;
  const step = (dtS: number): void => {
    if (!paused) filmS += dtS;
    director.show(filmS, paused ? 0 : dtS);
    post.setFrame(frameNo++);
    post.render();
    if (settings.debug) hud.textContent = `${backend}  ${director.info()}`;
  };

  // Space holds the film, the arrows move five seconds either way, H shows the numbers.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      paused = !paused;
    } else if (e.code === 'ArrowRight') filmS += 5;
    else if (e.code === 'ArrowLeft') filmS = Math.max(0, filmS - 5);
    else if (e.code === 'KeyH') hud.classList.toggle('hidden');
  });
  let idleTimer = 0;
  window.addEventListener('pointermove', () => {
    home.classList.add('on');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => home.classList.remove('on'), 2500);
  });

  if (settings.captureFps !== null) {
    const dt = 1 / settings.captureFps;
    step(0);
    const nextFrame = (): Promise<void> => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    window.lives = {
      frame: async () => {
        step(dt);
        await nextFrame();
      },
      seek: async (timeS) => {
        // Arrive a moment early so the hair and the blink are where they would be.
        filmS = Math.max(0, timeS - 0.5);
        // One step per animation frame, as in the film itself: the renderer
        // refreshes some of its state once per frame, not once per render.
        for (let i = 0; i < 6; i++) {
          step(0.5 / 6);
          await nextFrame();
        }
        await nextFrame();
      },
    };
  } else {
    let lastMs = performance.now();
    const loop = (nowMs: number): void => {
      const dt = Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      step(dt);
      requestAnimationFrame(loop);
    };
    step(0);
    requestAnimationFrame(loop);
  }
  document.body.dataset.ready = '1';
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.dataset.ready = 'error';
  const film = document.getElementById('film');
  if (film) film.textContent = 'Lives could not start. Your browser may not support WebGL2 or WebGPU.';
});
