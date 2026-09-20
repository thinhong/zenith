import { ERA_LABELS, ERA_ORDER, type EraId } from '@/world/eras';

/**
 * The quiet bar along the bottom: the era dial and a help button, and nothing
 * else. It hides itself after a few seconds of stillness and comes back on any
 * movement (PLAN.md 1.1, "Quiet UI").
 *
 * Pulled forward from M4 so the eras can be reached at all. The vantage buttons
 * and the mute control belong to M4 and are not here yet.
 */
const BAR = {
  /** Seconds of no input before the bar fades away. */
  idleS: 4,
  fadeS: 0.6,
} as const;

export interface BarOptions {
  /** The eras that actually exist. The rest are shown dark and do nothing. */
  built: ReadonlySet<EraId>;
  current: () => EraId;
  onEra: (id: EraId) => void;
}

export interface Bar {
  /** Called every frame; handles the fade. */
  update: (dtS: number) => void;
  /** Redraws which stop is lit. */
  refresh: () => void;
}

export function createBar(options: BarOptions): Bar {
  const root = document.createElement('div');
  root.id = 'bar';

  const dial = document.createElement('div');
  dial.className = 'dial';
  root.appendChild(dial);

  const stops = new Map<EraId, HTMLButtonElement>();
  ERA_ORDER.forEach((id, index) => {
    const label = ERA_LABELS[id];
    const stop = document.createElement('button');
    stop.className = 'stop';
    stop.type = 'button';
    stop.innerHTML = `<span class="year">${label.year}</span><span class="name">${label.name}</span>`;
    if (!options.built.has(id)) {
      stop.classList.add('unbuilt');
      stop.disabled = true;
      stop.title = 'Not built yet';
    } else {
      stop.title = `${label.name} (${index + 1})`;
      stop.addEventListener('click', () => {
        options.onEra(id);
        wake();
      });
    }
    dial.appendChild(stop);
    stops.set(id, stop);
  });

  const help = document.createElement('button');
  help.id = 'help';
  help.type = 'button';
  help.textContent = '?';
  help.title = 'Controls';
  root.appendChild(help);

  const sheet = document.createElement('div');
  sheet.id = 'helpsheet';
  sheet.className = 'hidden';
  sheet.innerHTML = [
    '<b>Scroll</b> or pinch to rise and fall',
    '<b>Drag</b> to turn, right-drag to move',
    '<b>1</b> to <b>5</b> change the era',
    '<b>Space</b> holds the day still',
    '<b>H</b> shows the numbers',
  ]
    .map((line) => `<div>${line}</div>`)
    .join('');
  root.appendChild(sheet);
  help.addEventListener('click', () => {
    sheet.classList.toggle('hidden');
    wake();
  });

  document.body.appendChild(root);

  let idleS = 0;
  let shown = true;

  function wake(): void {
    idleS = 0;
    if (!shown) {
      shown = true;
      root.classList.remove('away');
    }
  }

  for (const event of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(event, wake, { passive: true });
  }

  function refresh(): void {
    const now = options.current();
    for (const [id, stop] of stops) stop.classList.toggle('here', id === now);
  }
  refresh();

  return {
    refresh,
    update: (dtS) => {
      if (!shown) return;
      idleS += dtS;
      if (idleS < BAR.idleS) return;
      shown = false;
      root.classList.add('away');
      sheet.classList.add('hidden');
    },
  };
}

export const BAR_FADE_S = BAR.fadeS;
