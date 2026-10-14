# Lives

The second app of [Zenith](../../README.md), and a first test of it: one person's life, from a child at a window to an old woman in an armchair, in about eighty seconds, like the life montage of an animated film. When it ends, a small light leaves her by the window, and the next life begins in the same room.

Three.js (WebGPU with WebGL2 fallback), TypeScript and Vite. The person is an anime model in the VRM format, loaded with [three-vrm](https://github.com/pixiv/three-vrm); everything else is drawn by code. Served at `https://<user>.github.io/zenith/lives/`, and not on the chooser yet.

## Run it

```
npm install          # once, at the repo root
npm run dev:lives    # from the repo root (or `npm run dev` in this folder)
                     # open http://localhost:5174/zenith/lives/
```

Space holds the film, the arrow keys move five seconds, H shows the shot and the time.

## Plan and rules

- `docs/PLAN.md`: what the test is, how it is built, what it showed, what to decide next.
- `docs/CREDITS.md`: where the model comes from and its licence.
- `AGENTS.md`: working rules for coding agents (also loaded by Claude Code via `CLAUDE.md`).
