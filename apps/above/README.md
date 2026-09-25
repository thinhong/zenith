# Above

The first app of [Zenith](../../README.md). A small browser world you look down on from a high place. Scroll to descend from satellite height to the street. From above there are only patterns; close up there are tiny people with tiny worries. The same land can be seen in four eras. No goals, no score.

Built with three.js (WebGPU with WebGL2 fallback), TypeScript, and Vite. Served at `https://<user>.github.io/zenith/above/`.

## Run it

```
npm install          # once, at the repo root
npm run dev:above    # from the repo root (or `npm run dev` in this folder)
                     # open http://localhost:5173/zenith/above/
```

Press **H** for the debug overlay. Scroll or pinch to change altitude; drag to orbit.

## Build and deploy

The whole collection is built and deployed together from the repo root. See the root `README.md`.

## Plan and rules

- `docs/PLAN.md`: vision, architecture, milestones, budgets, content rules.
- `AGENTS.md`: working rules for coding agents (also loaded by Claude Code via `CLAUDE.md`).
