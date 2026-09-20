import { ERA_LABELS, ERA_ORDER, type EraId } from '@/world/eras';

/**
 * The quiet bar along the bottom: the era dial, the hour, an x-ray toggle and
 * a help button. It hides itself after a few seconds of stillness and comes
 * back on any movement (PLAN.md 1.1, "Quiet UI").
 *
 * Pulled forward from M4 so the eras can be reached at all. The vantage
 * buttons and the mute control belong to M4 and are not here yet.
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
  /** The hour of the day, 0 to 24, and whether the clock is running. */
  hour: () => number;
  paused: () => boolean;
  onHour: (hour: number) => void;
  onPause: (paused: boolean) => void;
  /** Whether the walls are see-through. */
  xray: () => boolean;
  onXray: (on: boolean) => void;
}

export interface Bar {
  /** Called every frame; handles the fade and follows the clock. */
  update: (dtS: number) => void;
  /** Redraws which stop is lit and which toggles are on. */
  refresh: () => void;
}

/** "07:30" from 7.5. The bar shows the hour; the HUD has the same in full. */
function clockLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

  // --- the day ---------------------------------------------------------------
  const clock = document.createElement('div');
  clock.className = 'dial clock';

  const play = document.createElement('button');
  play.className = 'icon';
  play.type = 'button';
  play.title = 'Hold the day still (space)';
  clock.appendChild(play);

  const time = document.createElement('input');
  time.type = 'range';
  time.min = '0';
  time.max = '1440';
  time.step = '5';
  time.className = 'hours';
  time.title = 'Time of day';
  clock.appendChild(time);

  const readout = document.createElement('span');
  readout.className = 'readout';
  clock.appendChild(readout);
  root.appendChild(clock);

  // Dragging the slider sets the hour. It does not pause: watching the light
  // swing round while you drag is most of the point of having it.
  let dragging = false;
  time.addEventListener('pointerdown', () => {
    dragging = true;
  });
  for (const event of ['pointerup', 'pointercancel']) {
    window.addEventListener(event, () => {
      dragging = false;
    });
  }
  time.addEventListener('input', () => {
    options.onHour(Number(time.value) / 60);
    wake();
  });
  play.addEventListener('click', () => {
    options.onPause(!options.paused());
    refresh();
    wake();
  });

  // --- see-through walls -----------------------------------------------------
  const xray = document.createElement('button');
  xray.id = 'xray';
  xray.type = 'button';
  xray.textContent = 'X';
  xray.title = 'See through the walls (X)';
  xray.addEventListener('click', () => {
    options.onXray(!options.xray());
    refresh();
    wake();
  });
  root.appendChild(xray);

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
    '<b>Slider</b> sets the hour',
    '<b>Space</b> holds the day still',
    '<b>X</b> makes the walls see-through',
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
    const paused = options.paused();
    play.textContent = paused ? '▶' : '‖';
    play.classList.toggle('here', paused);
    xray.classList.toggle('here', options.xray());
  }
  refresh();

  return {
    refresh,
    update: (dtS) => {
      const hour = options.hour();
      readout.textContent = clockLabel(hour);
      // The slider follows the clock, except while it is being dragged, or it
      // fights the hand holding it.
      if (!dragging) time.value = String(Math.round(hour * 60));

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
