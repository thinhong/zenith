/**
 * Settings read once from the address. None of them is part of the film: they
 * exist so a reviewer or a headless render can set up one moment and hold it.
 *
 * - `?t=31.5` starts the film at that second.
 * - `?pause=1` holds it there.
 * - `?life=2` starts on the third life (a new look, the same room).
 * - `?capture=12` renders one frame per call of `window.lives.frame()`, each
 *   1/12 s after the last, for recording a preview frame by frame.
 * - `?debug=1` shows the shot and the time in a corner.
 * - `?view=x,y,z,lx,ly,lz,fov` puts the camera there instead of where the shot does.
 */
export interface Settings {
  startS: number;
  paused: boolean;
  life: number;
  /** Frames per second of film time in capture mode, or null for real time. */
  captureFps: number | null;
  debug: boolean;
  reducedMotion: boolean;
  /** A camera placed by hand: position, the point it looks at, field of view in degrees. */
  view: { pos: [number, number, number]; look: [number, number, number]; fovDeg: number } | null;
}

export function parseSettings(search: string, reducedMotion: boolean): Settings {
  const q = new URLSearchParams(search);
  const capture = finiteOrNull(q.get('capture'));
  return {
    startS: Math.max(0, finiteOrNull(q.get('t')) ?? 0),
    paused: q.get('pause') === '1',
    life: Math.max(0, Math.floor(finiteOrNull(q.get('life')) ?? 0)),
    captureFps: capture !== null && capture > 0 ? Math.min(60, capture) : null,
    debug: q.get('debug') === '1',
    reducedMotion,
    view: parseView(q.get('view')),
  };
}

export function readSettings(): Settings {
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return parseSettings(window.location.search, reduced);
}

function parseView(raw: string | null): Settings['view'] {
  if (raw === null) return null;
  const n = raw.split(',').map((part) => finiteOrNull(part));
  if (n.length !== 7 || n.some((v) => v === null)) return null;
  const [x, y, z, lx, ly, lz, fov] = n as number[];
  return { pos: [x ?? 0, y ?? 0, z ?? 0], look: [lx ?? 0, ly ?? 0, lz ?? 0], fovDeg: fov ?? 40 };
}

function finiteOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
