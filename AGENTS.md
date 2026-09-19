# Instructions for coding agents

You are working on Zenith, a contemplative browser world seen from above. Read `docs/PLAN.md` fully before your first change. It holds the vision, the architecture, the milestones, and the budgets. This file holds only the working rules.

## Working rules

1. **One milestone task per pull request.** Name the branch `m<N>/<short-task>` (for example `m1/road-graph`). Small, reviewable changes. Do not start milestone N+1 while N has open acceptance items.
2. **Before you claim done**, run all four and paste the results in the PR description:
   `npm run typecheck`, `npm test`, `npm run build` (report the gzipped size), `npm run smoke` (attach `docs/screenshots/smoke.png` and say what you see in it).
3. **Pure logic first.** Any decision that can be expressed as plain data in, plain data out (layouts, schedules, band maths, selection) goes in a function with no three.js imports and gets a Vitest test next to it (`foo.test.ts`). three.js objects live in thin system files that call those functions.
4. **Budgets are hard limits** (see PLAN.md section 3.1). If your change pushes draw calls, bundle size, or agent CPU over budget, fix it in the same PR or do not merge.
5. **Altitude drives everything.** New visuals or sounds must read `altitude` and fade with `smoothstep` at the band edges defined in `src/state/altitude.ts`. Never hard-code a metre threshold elsewhere; add a named constant there.
6. **Instancing by default.** Anything drawn more than ~20 times is an `InstancedMesh` (or `Points`). Never create a `Mesh` per person, car, tree, or window.
7. **No new dependencies without a reason written in the PR.** three, vite, typescript, vitest, playwright are the whole stack. No UI frameworks, no state libraries, no physics engines.
8. **Content rules apply to code too.** Thoughts and life cards must follow PLAN.md section 7 (plain, tender, under 60 characters, no mocking, no politics, no brands). If you write content, add it as data in `src/thoughts/content.ts` or `src/souls/lives.ts`, not inline.
9. **Do not add** goals, scores, achievements, timers, text input, accounts, analytics, or network calls. These are non-goals and will be reverted.
10. **Update PLAN.md** in the same PR when you change a decision, a threshold, a file path, or close a milestone (status line + screenshot in `docs/screenshots/`).
11. **Keep the fallback working.** The smoke test runs on WebGL2 without a GPU. If a feature only works on WebGPU, it must degrade gracefully, not crash.
12. **Commits**: conventional style, e.g. `feat(m1): road graph with A* pathfinding`, `fix(m2): stagger commute start`, `docs: close M1`.

## Commands

```
npm install          # once
npm run dev          # http://localhost:5173/zenith/
npm run typecheck
npm test
npm run build        # also type-checks; prints gzipped size
npm run preview      # serve dist/ locally
npm run smoke        # headless render check -> docs/screenshots/smoke.png
                     # first time: npx playwright install chromium
                     # on machines with a system Chromium: CHROME_PATH=/path/to/chrome npm run smoke
```

## Code style

- TypeScript strict, `noUncheckedIndexedAccess` on, no `any`, no `!` non-null assertions unless commented.
- Named exports only. One concept per file. Files are lower-case with hyphens if needed.
- Comments explain *why* (a design choice, a tuning note), not *what* the next line does.
- Units: metres, seconds, radians. Name variables with units when it helps (`altitudeM`, `durationS`).
- No magic numbers in systems: constants live at the top of the module or in `src/state/`.
- Keep `src/main.ts` a thin bootstrap; wiring only.

## What exists today (M0 and M1)

Pure modules, each with a test file beside it: `src/state/altitude.ts` (bands,
detail fades, fog range), `src/state/clock.ts`, `src/state/settings.ts`,
`src/world/seed.ts`, `src/world/sky.ts`, `src/world/terrain.ts`,
`src/world/roads.ts` (graph + A*), `src/world/lots.ts`.

three.js modules: `src/core/renderer.ts` (WebGPURenderer + WebGL2 fallback),
`src/core/camera.ts` (orbit rig, altitude, view state, altitude-scaled clip
planes), `src/core/loop.ts`, `src/world/ground.ts` (land, water, mountains),
`src/world/road-mesh.ts`, `src/world/buildings.ts` (TSL window lights),
`src/world/props.ts` (trees, lamps), `src/world/world.ts` (assembly + per-frame
sky and detail), `src/ui/hud.ts` (press H).

Start with M2 in `docs/PLAN.md`.

## Notes that cost time to find

- `Color.set(hex)` already lands in the renderer's working (linear) space.
  Calling `convertSRGBToLinear()` on top made every building ten times too dark.
- TSL: instance attributes are read in the vertex stage. Wrap them in
  `varying()` before using them in `colorNode` / `emissiveNode`, or the whole
  expression is evaluated per vertex and smears across each face.
- `renderer.info` is reset inside three's own animation loop, which runs before
  ours. `autoReset` is off and `reset()` is called from `core/loop.ts`; read the
  counters after `render()`.
- `emissiveNode` is only declared on `MeshStandardNodeMaterial` in the types,
  but `NodeMaterial.setupLighting()` reads it on every node material.
- A `fract(sin(dot(...)) * 43758)` hash speckles once world coordinates get to
  city scale. `world/buildings.ts` uses a small-constant hash instead.
