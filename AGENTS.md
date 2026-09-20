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
- An InstancedMesh whose matrices are rewritten every frame needs
  `instanceMatrix.setUsage(DynamicDrawUsage)` (`markDynamic` in
  `world/instanced.ts`). three uploads the buffer once otherwise.
- Checking whether a crowd renders is harder than it sounds, and cost hours
  here. A 1.7 m figure is five to eight pixels from the roof band, the streets
  are dark, and a camera tilted 30 degrees over downtown sees mostly rooftops,
  so "I cannot see anyone" proves nothing. What works: temporarily give the
  figures a flat bright material, float them at y = 60 so no building can hide
  them, and count matching pixels in the screenshot rather than looking. Keep
  the probe inside the real draw path, or it tests the probe instead of the
  code. Note also that anything above `AGENTS.figuresMaxM` hides the figures by
  design, and that a point behind or above the camera is not a rendering bug.
- The headless renderer runs at two or three frames a second, so the day clock
  barely advances during a screenshot. To watch behaviour over a whole day, run
  the systems in node with vite-node and print counts; only use screenshots to
  check how something looks.
- Frame timings from the headless renderer are meaningless. It runs at ten
  frames a second on a software rasteriser, and `requestAnimationFrame` is
  throttled while a Playwright script sleeps, so a three second transition can
  take twenty seconds of wall clock. Time the JavaScript in node with vite-node
  instead, warming each path once before measuring, and use the browser only to
  check that a thing happens and in what order.
- Anything that runs once per lot must not scan a list of the same order. The
  citadel has 5176 lots and 1091 road nodes; `nearestNode` per lot cost 26 ms of
  one frame. `roads.ts buildNodeIndex` and `lots.ts buildLotIndex` are the grids
  for this.
- A grid search for the nearest thing cannot stop one ring after the first hit.
  Ring distance is measured in cells, not metres, so from outside the city the
  true nearest can be several rings past the first one found. Stop when the
  ring's inner edge, `(ring - 1) * cellM`, is further than the best distance so
  far. Both searches have a test against a full scan; keep them.
- Work that builds a world must be split across frames. `Era.build` is a
  generator that yields between stages and `world/world.ts` wraps it in another
  that yields after each mesh, because doing it in one call costs 174 ms.
  `buildLayout()` runs one to the end for tests and for the first city.
- Do not copy a placement list to change one field on it. `props.ts` used to map
  its trees twice, once for trunks and once for canopies, which cost 37 ms for
  4400 trees; passing three size functions over the one list costs 9.
- A procedural pattern on a surface needs a fade by altitude, not just by band.
  The daytime window pattern is a 3.6 m floor: at 300 m it reads as glazing, at
  620 m it is one pixel and turns into black moire across every wall.
  `DETAIL.facade` exists for that, separate from `DETAIL.windows`, which is
  about the lights at satellite height.
- Check the range of an instance attribute before doing arithmetic on it.
  `iSeed` is the lot's jitter times a hundred, so using it as a 0..1 weight
  multiplied the window pattern by up to ninety and every wall came out solid
  black. `fract(seed * 0.01)` folds it back.
- A sine repeats every 2*PI, so dividing a world position by a "size in metres"
  gives a pattern 2*PI times larger than the name says. The cloud shadows were
  ten kilometres wide for this reason, which is wider than any frame, so the
  whole world simply sat under an even wash and the feature looked broken
  rather than wrong.
- An InstancedMesh with no instances has no bounding sphere, and three reports
  that as a NaN radius when the shadow pass culls it. Do not add a mesh whose
  list is empty.
- The lighting sets whether a palette can work at all. Before you repaint
  anything, check that a lit flat surface renders at about its own colour:
  irradiance on a top face is `ambI * ambLinear + sunI * sunLinear * dot(n, s)`
  and Lambert divides by PI, so those two terms have to sum to about PI. They
  summed to 1.6 here, and every palette looked like mud until that was fixed.
- An InstancedMesh that starts with no instances gets a NaN bounding sphere,
  three caches it, and every raycast against it misses from then on. Give one
  a `boundingSphere` by hand if its count starts at zero
  (`world/interiors-mesh.ts`). This is the same root cause as the NaN radius
  warning noted in PLAN.md.
- A budget on how many of something to draw has to be spent on what is on
  screen. `PEOPLE.maxFigures` was filled in agent order from a fixed 700 m
  radius, which is the whole settlement, so at 70 m the HUD reported 2400
  figures drawn and none were visible: the frame was a hundred metres wide and
  held about one per cent of them. `drawRadius(altitudeM)` ties the radius to
  the camera.
- Distances tuned against the old 1400 m city are still all over this code.
  `AGENTS.nearM` was 400, which in a 460 m settlement meant almost every agent
  updated every frame: with twelve thousand people that was 6.6 ms against a
  budget of 4. When something is suddenly slow, look for a metre value that
  used to be a small fraction of the world and now is most of it.
- Measure the distribution, not the worst frame. The agent update has a median
  of 1.1 ms and a p99 of 3.6; all the spikes are the pathfinding batch, so
  `PEOPLE.pathsPerFrame` is the number that sets the worst one.
