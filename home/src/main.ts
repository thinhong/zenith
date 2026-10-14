import { APPS } from './apps';
import { forwardTarget } from './forward';

/**
 * The chooser: a still, a name and one line for each finished app, and nothing
 * else. No text about calm, no tips, no counters (AGENTS.md at the repo root).
 */
const STILL = {
  /** The stills are 16:10. Set on the element so nothing jumps as they load. */
  widthPx: 1200,
  heightPx: 750,
} as const;

const base = import.meta.env.BASE_URL;
const target = forwardTarget(window.location.search);
if (target === null) render();
else window.location.replace(`${base}${target}`);

function render(): void {
  const list = document.getElementById('apps');
  if (!list) return;
  for (const app of APPS) {
    const card = document.createElement('a');
    card.className = 'app';
    card.href = `${base}${app.slug}/`;

    const still = document.createElement('img');
    still.src = `${base}stills/${app.still}`;
    // The name below is the card's label; the picture adds nothing to read.
    still.alt = '';
    still.width = STILL.widthPx;
    still.height = STILL.heightPx;
    still.decoding = 'async';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = app.name;

    const line = document.createElement('span');
    line.className = 'line';
    line.textContent = app.line;

    card.append(still, name, line);
    list.appendChild(card);
  }
}
