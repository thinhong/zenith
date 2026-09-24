# Zenith: implementation plan

Status: v17, 25 September 2026. M0 to M3 closed. M5 closed as four eras, with Wyrmrest (M5b) in place of the two that were never built. A day on foot (section 2, step 9) added outside the milestones, by the owner's call. 2300 rebuilt as a garden town round a great hall on a pond, and the trees of every era drawn in full near the eye (section 5). M4, M6 and M7 open. Owner: Thinh. This file is the source of truth for what Zenith is and how it gets built. Coding agents: read this whole file and `AGENTS.md` before writing code. If you change a decision here, update this file in the same change.

## 1. What Zenith is

Zenith is a small browser world that you look down on from a high place. You scroll to zoom from satellite height down to the street. From high up you see only patterns: rivers of traffic, lights coming on at dusk. As you go lower, sound rises, and you start to see tiny people walking to work, driving, sitting at desks. At street level, short thoughts appear above their heads ("must finish the report", "why hasn't she replied"). Zoom out again and the words shrink to nothing.

The same piece of land can be viewed in different eras (rice fields, an old citadel, a colonial town, a modern city, a green ruin) to carry the idea of reincarnation: the clothes change, the worries do not. A small light (a "soul") can be followed from one life to the next.

The purpose is to remind the viewer to stay calm: to watch the world like an outsider, not an actor. Zenith is not a game with goals. There is nothing to win, collect, or finish. The one exception is a day on foot (section 2, step 9): it tells a story and asks for a reply now and then, and there is still nothing to win.

### 1.1 Feeling we want (design principles)

1. **Altitude is the meaning.** The only real "mechanic" is zooming. Everything the world shows, plays, or says is a function of altitude. Do not add features that ignore altitude.
2. **Show, do not tell.** No explanatory text, no quotes, no onboarding tips about calmness. The scene must carry the idea on its own.
3. **Tender, not contemptuous.** The tiny people are trying hard, like the viewer. Thoughts are relatable and gently funny, never mocking. Any content that laughs *at* people is rejected.
4. **Slow.** Camera moves are damped. Nothing flashes. Time-lapse is the only fast thing, and it is optional.
5. **Toy world, not simulation.** Low-poly shapes, flat colours, no textures. It should feel like a model city on a table, seen from above.
6. **Quiet UI.** Controls hide themselves after a few seconds. No score, no badges, no login, no analytics, no notifications.
7. **Finishable.** Each milestone below must be shippable on its own. Ship M1 to GitHub Pages before starting M2.

### 1.2 Non-goals (do not build these)

- No backend, accounts, database, or network calls at runtime (except loading the site's own static files).
- No free-text input from the viewer (this was considered and rejected).
- No realistic assets, photogrammetry, or textures above 512 px.
- No multiplayer, chat, sharing buttons, or social features.
- No achievements, scores, timers, streaks, or "progress".
- The one story mode allowed is **a day on foot** (owner's call, 24 Sep 2026): soft aims, and two-reply choices that change how a day ends. No fail state, no score, no timer, no typing. Nothing in the view from above depends on it.
- No third-party UI frameworks (React, Vue, etc.). Plain DOM and CSS are enough for the tiny UI.

## 2. The viewer's experience, step by step

1. The page opens on a black-blue background. Within 3 seconds the city fades in, seen from about 900 m ("mountain" band), slightly tilted, near dusk. Soft wind is heard after the first click or touch (browsers require a gesture before audio).
2. The viewer scrolls or pinches. The camera descends with damping. At about 1200 m, cars appear as moving dots on the roads. At about 300 m, people appear as small walking figures. The city murmur fades in as the wind fades out.
3. Below about 60 m ("street" band), a few thought bubbles appear over the nearest people, at most six at a time. They are short, plain sentences. They fade in over half a second and drift away when the person walks out of range.
4. The viewer zooms back out. The words shrink and vanish first, then the people, then the cars, then the buildings flatten into a colour map with lights. At 3500 m and above ("satellite"), there is only the land, the lights, and the wind.
5. A thin bar at the bottom offers: an era dial (five eras), four vantage buttons (roof, mountain, cloud, satellite), a mute button, and a "?" that shows the controls. The bar hides after 4 seconds without input and returns on any move.
6. Dragging the era dial cross-fades the land into another era over about 3 seconds: buildings sink into the ground, new ones rise. The people keep walking, in new clothes (colours), with new thoughts and new sounds.
7. Clicking a person (only in the street band) makes the camera follow them gently and shows a three-line "life" card (a name, an age, one worry). After about 20 seconds, or on any zoom, a small light leaves the person, rises, and settles on someone else, possibly in another era. The camera follows the light. This is the reincarnation moment. It can be ignored entirely.
8. Day and night cycle slowly (a full day in about 6 minutes). A "century in a minute" button in the era dial plays all eras in sequence as a time-lapse and then stops.
9. **A day on foot** (24 Sep 2026). The bar's "A day" button, or L, brings the view down out of the sky into one person's eyes on their doorstep, early in the morning, in whichever era is showing. From there the viewer walks that person's ordinary day: work, the market, a friend, home again, following a small gold light that goes ahead and waits. Near somebody they can talk (a click, E, or a tap), and now and then they pick one of two replies, which changes how the day ends. Each era has its own day: Edda's bread in Wyrmrest, Lài's rice in 1800, Minh's four missed calls in 2020, Sol's street in 2300. At night the day ends where it began, the last thought stays a moment, and the view rises back into the sky and hands the camera back. Esc, or the arrow in the corner, rises out of a day at any time.

## 3. Technology and constraints

| Item | Decision |
|---|---|
| Renderer | three.js `WebGPURenderer` (from `three/webgpu`). It uses WebGPU where available and falls back to WebGL2 by itself. Do not write raw GLSL; use three's node materials / TSL if a custom shader is needed. |
| Language | TypeScript, strict mode, no `any`. |
| Bundler / dev server | Vite 7. Path alias `@/` = `src/`. |
| Tests | Vitest for pure logic (no three.js objects in tests). Playwright smoke test for rendering (`npm run smoke`). |
| Hosting | GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main`. Site URL: `https://<user>.github.io/zenith/`. The base path is set from the repo name. |
| Audio | Web Audio API. Procedural noise for wind; small looped OGG/MP3 files (each under 200 kB) for murmur and era accents. |
| UI | Plain DOM + CSS in `index.html` and `src/ui/`. No framework. |
| Units | 1 world unit = 1 metre. Y is up. Ground is the plane y = 0. |

### 3.1 Performance budgets (hard limits; a change that breaks one is not merged)

**Nothing is frustum-culled.** Every instanced mesh spans the whole settlement, so its bounding sphere covers everything and three never rejects it. That is fine while the settlement is small enough to be on screen, and it is the main reason the settlement is small: at radius 1400 m the whole city was drawn every frame, and again into the shadow map, however little of it was in view. If the settlement ever grows again, this has to become a spatial split, not a wish.

**Sizes are written against the settlement radius, never in metres.** The water, the mountains and the road grid were first written as fixed metres for a 1400 m city. When the radius became 460 the same river was still 190 m wide with 250 m meanders: it swallowed the town, six sevenths of the ground stopped being buildable, and one bank was left with nothing on it. Two tests caught it. Anything that scales with the place is a fraction of `TERRAIN.cityRadiusM`; wavenumbers scale the other way.

**Where it stands after the garden town and the trees of 25 Sep 2026**, same views, same method (the day at 10:00), with the build before the trees beside it on the same layouts:

| | draws | triangles | before the trees |
|---|---|---|---|
| Modern, roof band (250 m) | 60 | 1,758,572 | 62, 1,517,624 |
| Modern, opening view (520 m) | 60 | 1,405,660 | |
| Modern, above the shadow cutoff (910 m) | 43 | 858,120 | |
| Citadel, roof band (250 m) | 56 | 2,988,610 | 58, 2,724,150 |
| 2300, roof band (250 m) | 62 | 1,733,028 | |
| Wyrmrest, roof band (250 m) | 62 | 1,636,264 | 64, 1,445,976 |

From the roof band up every tree is drawn plain, and the plain trees cost about what the old ones did: 150 triangles a broadleaf against 140, 164 a garden tree as before, 100 a conifer against 56, and 60 a shrub against 20, the last two for shapes that no longer read as a party hat and a ball. That, doubled for the shadow pass, is the 0.2 to 0.26 million added here, and two draws went the other way, because trunk and crown are one mesh now. 2300 is lower than the last table because it has no towers. At eye level the trees near the eye are drawn in full (section 5, "Trees, near and far"), and that is where the cost went: see the eye-level figures under "A day on foot". **If the phone cannot hold 30 fps**, the first lever is `TREE_DETAIL`: at eye level the same views cost 0.14 to 0.32 million more with the near trees out to 150 and 185 m than out to 110 and 140, so bringing it in further is the next saving.

**Where it stands after the town plan of 23 Sep 2026**, same views, same method (the day at 10:00):

| | draws | triangles |
|---|---|---|
| Modern, roof band (250 m) | 62 | 1,517,624 |
| Modern, opening view (520 m) | 62 | 1,164,712 |
| Modern, above the shadow cutoff (910 m) | 44 | 737,646 |
| Citadel, roof band (250 m) | 58 | 2,724,150 |
| 2300, roof band (250 m) | 64 | 2,248,090 |
| Wyrmrest, roof band (250 m) | 64 | 1,445,976 |

2020 has 1234 lots where the grid had 1925, and 2300 has 1050 where it had 1173, which is most of their drop: the estates and the suburbs keep gardens. The citadel went the other way, 1947 lots against 1655, because the houses inside the walls now run right up to the wall and the lanes stop at its foot. The agents cost what they did: at rush hour, timed in node, they average 2 to 3 ms a frame in every era, as they did on the grid, although 2020's graph now has twice the nodes. The longest single building step is still under 30 ms.

**Where it stood after the landscape and street pass of 23 Sep 2026**, same views, same method:

| | draws | triangles |
|---|---|---|
| Modern, roof band (250 m) | 62 | 2,013,990 |
| Modern, opening view (520 m) | 62 | 1,661,078 |
| Modern, above the shadow cutoff (910 m) | 44 | 989,724 |
| Citadel, roof band (250 m) | 54 | 2,519,704 |
| 2300, roof band (250 m) | 64 | 2,708,964 |
| Wyrmrest, roof band (250 m) | 60 | 1,421,998 |

That is about twice what it was, on the owner's instruction to spend triangles on the city. The largest items, estimated from the layouts and doubled for the shadow pass wherever they cast: trees in 2020 and 2300 (a broadleaf crown is six lobes, 120 triangles, and 2300 has 3,364 of them), the citadel's Hue roofs, and the parks' flower beds in the citadel. The woods on the hills and the road markings cast nothing. **If the phone cannot hold 30 fps, cut in this order:** broadleaf crowns back to fewer lobes, flower beds to plain discs, then the street trees' spacing.

**After the detail passes of 20 Sep 2026**, seed 1, `?pause=1`, 1280x800. The triangle figures include the shadow pass, which draws the scene a second time:

| | draws | triangles |
|---|---|---|
| Modern, roof band (250 m) | 53 | 995,050 |
| Modern, above the shadow cutoff (910 m) | 38 | 327,260 |
| Citadel, roof band (250 m) | 47 | 1,446,634 |
| Citadel, over the halls (140 m) | 45 | 1,620,646 |
| 2300, roof band (250 m) | 55 | 1,017,782 |

Draw calls are the budgeted quantity and they are at a third of the limit, because everything repeats and everything is instanced. Triangles are not capped, and the largest single item is now the citadel's roofs at about 300k, which is where the owner asked for them to go. **The 30 fps Android target in the list below has not been checked since these passes**; the owner reports the iPhone is fast, and an A53 is a good deal weaker than that. If it has to come down, the first thing to try is a second, plainer roof geometry for the small houses, whose sweep does not read from the roof band anyway.

**Budget before the detail passes**, seed 1, measured with `vite-node`:

| | before (radius 1400 m) | after (radius 460 m) |
|---|---|---|
| Modern lots | 1373 over 6.16 km² | 1925 over 0.66 km², about 2900/km² |
| Modern triangles | 146,732 | 160,015 at 620 m |
| Citadel triangles | 285,110 | about 86,000 |
| Draw calls at 620 m | 32 | 32 |

Where the triangles used to go, and it was not buildings: **trees were 55 to 65 percent of the world**, and tree trunks alone a third of it, at twenty triangles each for something 40 cm wide. Trunks are three-sided now, and water tanks four.

- JavaScript bundle: at most 1.2 MB gzipped in total.
- All static assets (audio, data, fonts): at most 15 MB in total.
- Draw calls per frame: at most 150. Use `InstancedMesh` for anything that repeats (buildings, people, cars, trees, windows).
- Frame rate: 60 fps on a 2020 laptop with integrated graphics; at least 30 fps on a 2022 mid-range Android phone (for example a Samsung A53). Test on a real phone before closing a milestone.
- Time to first rendered frame: under 3 seconds on a 4G connection.
- Memory: under 300 MB in the browser task manager.
- Simulation: at most 4 ms of CPU per frame for agent updates. Use typed arrays and time-slicing (update far agents less often), never one JavaScript object per agent per frame.

### 3.1.1 Phone

- **Touch follows a map, not a model viewer.** One finger moves over the town, two fingers pinch to rise and fall and twist to turn. three's default is the other way round, with one finger rotating, which on a phone means you cannot go anywhere without spinning the world. The mouse keeps the usual arrangement: drag turns, right-drag moves.
- **Touch targets are sized on `pointer: coarse`, not on width.** A phone held sideways is 844 px across and still has a finger on it. The hour slider is the case that matters: its track is three pixels tall, so the padding grows the hit area without moving the line.
- **The bar wraps.** Five era stops, a slider and two buttons is about 500 px in a line and will not fit across a 375 px phone.
- **A tap is not a drag.** The slop that separates one from the other is 14 px for touch and 5 for a pointer, because a finger never holds as still as a mouse.
- **Pixel ratio is capped at 1.5 on a small screen.** A phone reports 3, and with the post-processing chain that is nine times the fragment work of drawing at 1. The difference between 1.5 and 2 is not visible at arm's length; the difference in frame rate is.
- **Still not checked on a real phone.** Everything above is measured in a headless browser at phone viewports with touch emulation, which proves the layout and the hit areas and proves nothing at all about how it feels or how fast it runs. That remains the one open acceptance item, as it has been since M1.

### 3.2 Browser support

Latest Chrome, Edge, Safari, Firefox on desktop; Chrome and Safari on phones. If WebGL2 is missing, show a one-line message (already handled in `src/main.ts`).

## 4. Architecture

### 4.1 Data flow

```
input (scroll, pinch, drag, clicks, keys)
   -> CameraRig (altitude in metres, target, follow mode)
   -> AltitudeState (band + smooth 0..1 blend factors per band edge)
   -> systems read altitude and time:
        BuildingSystem   (what geometry/lights to show)
        TrafficSystem    (dots vs cars, count, update rate)
        PeopleSystem     (hidden / dots / figures, update rate)
        ThoughtSystem    (only in street band; picks up to 6 nearby people)
        AudioSystem      (wind gain, murmur gain, era accents)
        EraSystem        (which generator built the world; cross-fade progress)
        SoulSystem       (follow target, life card, hand-over)
   -> renderer.render(scene, camera)
```

Altitude and time are the only global inputs. Systems never talk to each other directly; they read shared state (`src/state/`) and write to their own three.js objects.

### 4.2 Module map (target layout; create files as milestones need them)

```
src/
  main.ts                  bootstrap: renderer, rig, world, systems, loop
  core/
    renderer.ts            WebGPURenderer with WebGL2 fallback (done)
    camera.ts              OrbitControls-based rig; altitude(); follow(); flyTo() (partly done)
    loop.ts                rAF loop with clamped dt (done)
    post.ts                tilt shift, outlines, bloom (done)
    input.ts               key bindings, touch helpers, idle timer
  state/
    altitude.ts            bands, boundaries, smoothstep blends, detail fades, fog range (done)
    clock.ts               day clock (0..24 h), speed, pause (done)
    era.ts                 current era id, transition progress 0..1 (done)
    settings.ts            seed, reduced motion, debug overrides from the URL (done)
  world/
    seed.ts                deterministic PRNG (done)
    world.ts               assembles a World; applies sky and detail each frame (done for M1)
    terrain.ts             pure: ground disc, mountain ring, river or coast, isBuildable (done)
    ground.ts              three.js: land disc, water with shallows and foam, beaches, the hills and their woods (done)
    landscape.ts           pure: the hills and the range as one height field, sampling the mesh, where the woods stand (done)
    forest-mesh.ts         three.js: the woods on the hills, two instanced meshes (done)
    sky.ts                 pure: sun direction, sky/fog/light colours, night factor (done)
    plan.ts                pure: the town plan: edge, core, ring, main roads, and districts each with its own street pattern; hands over the road graph (done)
    parcels.ts             pure: lots along the streets, each turned to face its street (done)
    geometry2d.ts          pure: turned rectangles, segments, crossings, a grid index on the ground (done)
    frame.ts               pure: a lot's own frame, which turns what is laid out square round a lot to face its street (done)
    roads.ts               pure: road graph, runs of street between junctions, room a junction takes, bridges, nearestNode, A* (done)
    road-mesh.ts           three.js: pavement, carriageway, kerbs, and every marking in one mesh (done)
    markings.ts            pure: lane lines, crossings, stop bars, strips of light, wheel ruts (done)
    parks.ts               pure: lawn, paths, the piece in the middle, flower beds and benches (done)
    near-cut.ts            three.js: the cut-away round the camera, one mask node shared by the town (done)
    lots.ts                pure: what a lot is for, how tall and in what style; the lookups the walkers use (done)
    buildings.ts           three.js: InstancedMesh per style; TSL window lights (done)
    props.ts               pure and three.js: where the trees go, and the street lamps (done)
    tree-geometry.ts       three.js: the shape of each kind of tree, near and far, and a shrub (done)
    tree-mesh.ts           three.js: the trees drawn near and far, sorted by distance from the eye; the leaf material (done)
    structures.ts          three.js: walls, gates, roofs and paving an era places by hand (done)
    roofscape.ts           pure: what stands on a roof (done)
    streetscape.ts         pure: yard walls, parked vehicles, poles (done)
    interior.ts            pure: the inside of one opened building, and where people stand in it (done)
    facade.ts              pure: balconies, pilasters and shopfronts on a building's face (done)
    roof-geometry.ts       three.js: the shape of one Hue roof, shared by every roof in town (done)
    houses.ts              pure: what stands on a 2300 lot: pavilions, stacked, gabled and court houses, studios, halls, shrines (done)
    gardens.ts             pure: 2300's front gardens: walls or hedges, a gate, beds and stones (done)
    water-gardens.ts       pure: 2300's parks as gardens round ponds, the lakes' edges, and the great hall on the pond in the middle of town (done)
    waterside.ts           pure: jetties and lone trees along the coast or the river, for 2300 (done)
    interiors-mesh.ts      three.js: draws whichever buildings are open (done)
    instanced.ts           three.js: shared instancing helpers for the crowds (done)
    eras/
      index.ts             Era interface + registry (done)
      myth.ts              era 0: Wyrmrest, lanes round a market square inside a wall (done)
      fields.ts            era 1: rice fields, huts, dirt paths, ox carts (~1500)
      citadel.ts           era 2: walled town, temple, market (~1800) (done)
      colonial.ts          era 3: low ochre buildings, boulevards, bicycles, tram (~1930)
      modern.ts            era 4: towers downtown, districts of every grain round it, cars, scooters (~2020, default) (done)
      after.ts             era 5: a garden town round a great hall on a pond, lakes, calm misty air (~2300) (done)
  agents/
    pool.ts                pure: typed-array pools for people and vehicles, and walking (done)
    schedule.ts            pure: given clock hour + role -> where an agent wants to be (done)
    paths.ts               pure: A* route -> waypoints, corners smoothed, pavement baked in (done)
    people.ts              three.js: walking, arriving, instanced figures and points (done)
    traffic.ts             three.js: vehicles on the road graph, boxes and points (done)
    figure.ts              three.js: the geometry of one person, about 180 triangles (done)
    workplaces.ts          pure: how many desks a building has, and who gets them (done)
    hunt.ts                pure: what happens when a hero and a beast notice each other (done)
    monsters.ts            three.js: imps, beasts and heroes, and the hunt (done)
    monster-shapes.ts      three.js: the geometry of the three kinds of body (done)
  thoughts/
    content.ts             pure: thought texts by era, by place, by kind of person and by time of day; the pool one person draws from (done)
    human-content.ts       pure: the shared human core of thoughts that every era draws on (done)
    select.ts              pure: who is thinking out loud, and for how long (done)
    thoughts.ts            three.js + DOM: projects heads to screen, places the pills (done)
    place.ts               pure: where a pill goes and how it stays joined to a head (done)
  story/
    script.ts              pure: what a day is made of (scenes, lines, replies, flags) and a check that one is well formed (done)
    run.ts                 pure: plays a day: what is said, what can be replied, what comes next (done)
    cast.ts                pure: where a day's places are in this seed's town, cast by role (done)
    days/                  data: one ordinary day per era (done)
    day-mode.ts            three.js + DOM: the flights down and up, the day's clock, and the glue (done)
    actors.ts              three.js: the people of a day, the cat, the machine, the ring under whoever is waiting (done)
    guide.ts               three.js: the small gold light that goes ahead (done)
    ui.ts                  DOM: the words, the two replies, the menu (done)
  walk/
    body.ts                pure: a disc that walks and slides along whatever it cannot pass (done)
    town.ts                pure: what cannot be walked through in a town, and where the walkable ground ends (done)
    walker.ts              DOM + camera: keys and mouse, or two thumbs; the eyes (done)
  souls/
    souls.ts               SoulSystem: pick, follow, life card, hand-over animation
    lives.ts               life card templates by era (data only)
  audio/
    audio.ts               AudioSystem: context, gesture unlock, wind, murmur, accents
  ui/
    hud.ts                 debug overlay, H to toggle (done)
    bar.ts                 bottom bar: era dial, hour slider, x-ray, help; auto-hide (done; vantage buttons and mute are M4)
    lifecard.ts            the three-line card for a followed person
  content/                 (optional) shared palettes and names
public/
  audio/                   small looped sounds (added in M4)
scripts/
  smoke.mjs                headless render check (done)
docs/
  PLAN.md                  this file
  screenshots/             one screenshot per closed milestone
```

Rule: pure logic (schedules, pathfinding, band maths, generators' layout decisions) lives in functions that take plain data and return plain data, so Vitest can test them without a GPU. three.js objects are created in thin "system" files that call the pure functions.

### 4.3 Key data types (TypeScript sketches; refine as you implement)

```ts
// state/altitude.ts (exists)
type AltitudeBand = 'street' | 'roof' | 'mountain' | 'cloud' | 'satellite';

// world/eras/index.ts
interface Era {
  id: 'fields' | 'citadel' | 'colonial' | 'modern' | 'after';
  year: number;                    // shown on the dial, e.g. 1500
  palette: Palette;                // ground, road, 3..5 building colours, 4..6 clothing colours, sky at noon/dusk/night
  build(rng: Rng, terrain: Terrain): EraLayout; // pure: lots, roads, props, spawn counts
  thoughts: ThoughtSet;            // from thoughts/content.ts
  soundscape: SoundscapeSpec;      // which loops, base gains
}

interface EraLayout {
  roads: RoadGraph;                // nodes: {x,z}; edges: {a,b,width,kind}
  lots: Lot[];                     // {id, polygon or rect, use, height, style}
  props: PropInstance[];           // {kind, x, z, rotation, scale}
  population: { people: number; vehicles: number };
}

type LotUse = 'home' | 'work' | 'market' | 'temple' | 'park' | 'water';

// agents/pool.ts
// Structure-of-arrays. N = capacity (people 4000, vehicles 800 by default).
interface AgentPool {
  x: Float32Array; z: Float32Array; heading: Float32Array; speed: Float32Array;
  state: Uint8Array;               // 0 idle, 1 walking, 2 working, 3 resting, ...
  role: Uint8Array;                // index into schedule roles
  home: Uint16Array; work: Uint16Array; // lot ids
  target: Uint16Array;             // current destination lot id
  pathIdx: Uint16Array;            // progress along current path
  clothes: Uint8Array;             // palette index
  alive: Uint8Array;               // 1 if in use
}

// thoughts/content.ts
interface Thought { text: string; place: LotUse | 'street'; weight?: number }
type ThoughtSet = Record<Era['id'], Thought[]>;

// souls/lives.ts
interface LifeCard { name: string; age: number; worry: string }
```

### 4.4 Altitude policy (what each band shows)

| Band | Metres | Buildings | Vehicles | People | Thoughts | Sound |
|---|---|---|---|---|---|---|
| satellite | 3500+ | flat colour blocks, window lights at night only | none | none | none | wind only |
| cloud | 1200 to 3500 | instanced boxes, no windows | moving dots along roads (one `Points` or tiny instanced quads) | none | none | wind, faint murmur |
| mountain | 300 to 1200 | boxes with window rows | boxes, 2 colours | dots | none | wind fading, murmur rising |
| roof | 60 to 300 | same, plus roof props | boxes | instanced figures, walk animation by bobbing | none | murmur, occasional accents |
| street | 12 to 60 | same | boxes, lights at night | figures, activity poses | up to 6, nearest first, within 40 m of the target | murmur close, accents (bell, horn, birds) |

Transitions use `smoothstep` over a 20 percent window around each boundary so nothing pops. The thresholds live in one place (`state/altitude.ts`) and are tuned by feel, not hard-coded elsewhere.

At every height, anything nearer the camera than `NEAR_CUT` (38 percent of the altitude, at most 44 m) is cut away so it cannot fill the frame; see section 5.

### 4.5 Time model

- `clock.hour` runs from 0 to 24 and wraps. Default speed: **one day per 15 real minutes** (revised from 6 on 20 Sep 2026). Pause with the space key.
- Why 15 and not 6: people walk at a real 1.2 to 1.6 m/s (section 5), and at six minutes a day a schedule slot lasts 15 to 90 seconds while a walk of a few blocks takes two or three minutes. Every trip was overtaken by the next decision, so the whole population walked permanently and nobody ever arrived anywhere. Fifteen minutes lets the morning and evening commutes finish, which is what makes the waves readable. The other half of the same fix is that a person goes to the *nearest* market or park, not a random one.
- Sun direction, sky colour, fog colour, and window-light intensity are pure functions of `clock.hour` (in `world/sky.ts` or inside `terrain.ts`).
- Agent schedules read `clock.hour`: home at night, commute in the morning, work by day, market or park in the evening. Each role has a small offset so not everyone moves at once.
- Era time-lapse ("century in a minute") is separate: it steps through eras 1 to 5, spending 12 seconds on each, then stops on era 5. It does not change the day clock.

### 4.6 Era transition

A transition is a value from 0 to 1 over about 3 seconds. Old buildings scale their height toward 0 (sink), new ones scale from 0 to full. Roads cross-fade by colour. Agents are re-spawned for the new era during the middle of the transition (they are tiny, nobody notices). Sounds cross-fade. Only two eras are ever in memory at once.

The maths lives in `state/era.ts` and is pure, so it is unit tested. `world/world.ts` owns the meshes and the three.js side.

**The new era is built one step per frame, not all at once.** Laying out and meshing the citadel takes about 100 ms in total, which in a single frame is six dropped frames at 60 fps. So `Era.build` is a generator that yields between stages, and `world.ts` wraps it in a larger generator that also yields after each mesh. The bar lights the stop that is coming while the build runs, and `beginEraChange` only fires when the last step returns. Measured warm in node, the worst single step is 28 ms and the reseat at t = 0.5 is 14 ms, both inside a 30 fps frame (33 ms). See section 6, M5.

## 5. Art direction

- **Scale.** 1 unit = 1 m. A person is 1.7 m tall (a capsule or a 3-box figure: legs, body, head). A car is 4.5 m by 1.8 m. Streets are 7 to 10 m wide (modern), 4.5 m lanes (citadel). Blocks run from about 20 m across in an old quarter to more than 100 m long in a suburb, because each district is laid out on its own (below). **The settlement fills a disc of radius 460 m**, ringed by low mountains from 760 m to 1600 m. Owner's decision, 20 Sep 2026: one small settlement rather than a city, so that every building can be worth looking at, and so that what is drawn is what is on screen. The land itself runs far past that (12 km) and is ended by fog, not by an edge: a disc that stops where the viewer can still see it reads as a mistake.
- **Shapes.** Boxes, cylinders, cones, capsules only. Roofs may be a second thinner box or a cone. No imported models in M1 to M4. If a later milestone imports models, they must be under 2,000 triangles each and stored as `.glb` under 200 kB. The trees are the one exception, by the owner's call (25 Sep 2026): near the eye their crowns are leaf cards cut into leaves by noise in the material. Still no image textures anywhere.
- **Colours.** Flat `MeshLambertMaterial` or node equivalents, 4 to 6 building colours per era. **The target is painted daylight** (owner's decision, 20 Sep 2026; it was briefly an aerial photograph, and that set of values is in the git history). Two rules survive whichever way it goes, and they pull against each other:
  - Nothing sits below about `0x60`. A shaded side keeps roughly 45 percent of its value, so anything darker than that goes to mud, which is what the first version of every palette did.
  - Very little is saturated. A city from six hundred metres is grey, beige and dark green; colour appears in terracotta roofs, a painted wall and rust. Separation between uses is carried by value and by hue that is barely there.

  Night: dark blue-grey ground, warm yellow windows (emissive), and each era sets how many windows are lit and how brightly, because a town on oil lamps must not show the 2020 grid of white panes. The single accent colour is the soul light (pale gold). Store each era's palette in its era file.
- **Exposure.** The sky keyframes obey one rule: **at midday a flat surface facing the sky renders at about its own colour.** With a Lambert material a top face receives `ambI * ambLinear + sunI * sunLinear * dot(n, sun)` and shows `that / PI * albedo`, so the two intensities sum to about PI at noon. Before this rule they summed to 1.6 and every render came back at half the value of the palette. If you want the world brighter, paint the palette; do not push the lights past the rule. The split is about 55 percent sky and 45 percent sun: more sun and a shaded wall goes black, more sky and the roofs flatten. Tone mapping is Khronos PBR Neutral at 1.08 exposure, which rolls the top off without draining a bright roof the way ACES does.
- **Light.** One directional sun plus a hemisphere light. Shadows only for the sun, 2048 map over a 520 m square. They run to 800 m, not 300: below that a cast shadow is most of what gives a city its shape, and without them the buildings float.
- **Surface.** Three patterns do the work that geometry cannot:
  - **Cloud shadows** drift over the whole world (`world/atmosphere.ts`), four sine waves in the fragment stage. Note the conversion: a sine repeats every 2*PI, so `CLOUDS.spanM` is turned into a frequency rather than used as a divisor. Getting that wrong made every cloud ten kilometres wide, which is wider than any frame, so the feature looked broken.
  - **The land takes two colours**, the ground a town stands on and the country beyond it, and mixes between them by distance. What shows between buildings in a real city is yard, path and tarmac; painting the whole disc green was the single largest thing making this look like a model railway. The country half also carries a patchwork of fields.
  - **Windows are visible by day**, as panes slightly darker than their wall, varied per building. A blank wall is what makes a rendered building read as a block. It fades out by 520 m (`DETAIL.facade`): a floor is 3.6 m, so higher than that it is about one pixel and a hard pattern sampled at that rate turns into black moire.
- **Detail is a count, not a shape.** Everything is still boxes, prisms and quads; what makes a place look made rather than generated is how many of them there are and what they stand on. Three modules carry it, all pure, all drawn through `world/structures.ts`:
  - `roofscape.ts`, what is on a roof: the roof itself, a deck inside its own parapet, a stair housing, a water tank, a chimney at the ridge, a garden or a rack of panels, an off-centre plant room and sometimes a mast.
  - `streetscape.ts`, what is on the ground: the wall round a yard, usually with a gap for the gate; the vehicles left at the kerb; a pole beside a lane. The buildings were never why the place looked bare. It was the ground between them.
  - `road-mesh.ts`, the pavement: one quad wider than the carriageway, drawn under it, so junctions, bridges and the ring road all take care of themselves. From above that pale border is most of what makes a road read as a street rather than as a line on a map.
- **Roofs.** Nothing is a flat-topped box. `world/roofscape.ts` turns each lot into a ridged roof, or a deck set inside and below its own walls so the wall reads as a parapet, with a stair housing, a water tank and, on the tall ones, an off-centre plant room. Some low buildings grow a wing, so a footprint is not always one rectangle. A city seen from above is mostly roofs; without this it reads as a bar chart.
- **The town is planned, not cut from one grid** (`world/plan.ts`, `world/parcels.ts`, 23 Sep 2026). Owner's words: "the roads and the shape of the city is too round and organised", and then "more diversity urban planning". Every era used to be one grid clipped to a disc, so from above each one was a round pizza of equal squares. Now a town is put together the way one grows:
  - **An edge that wanders.** Slow waves round the town, and fingers reaching out along the main roads, because a town grows along its roads first. The widest direction is 1.2 to 1.4 times the narrowest.
  - **A core**, which is the era's own: 2020 and 2300 a tight grid of towers round a square with a ring boulevard; the citadel the square city inside its walls, laid out on the axis; Wyrmrest lanes radiating from the market square to its gates, crossed by two rings, with a few greens kept open between them, because a town of that shape has no blocks to leave empty and otherwise had no open ground at all.
  - **Main roads out of the core** at uneven angles, bending as they go and carrying on into the country. The citadel's leave its gates straight and only start to bend 60 m out (`calmM`). Between each two main roads, a collector street splits the wedge in half.
  - **A district in each half-wedge**, a different kind from its neighbour and lined up on its own main road, so two districts meet at an angle along every collector. 2020 and 2300 choose from an old quarter of narrow lanes and tube houses, a planned grid, estates of slabs on big blocks, and a suburb of long curving streets, closes and dead ends. Outside the citadel walls it is lanes, market streets and village. A smooth warp bends every district's streets, so no two blocks are the same size.
  - **The shore road and the ribbon.** A road follows the coast, and farmhouses string out along the country roads past the edge of town.
  - **Lots stand along the streets and face them.** Main roads take their frontage first. A plot that does not fit is tried shallower and then narrower; a gap in the row is only left where a building would have fitted, or the gap falls on a corner nothing could stand on and the plots beside it slide into the middle of the block. Everything that stands on a lot (roof, balconies, yard wall, rooms, the people inside) is laid out square round the lot as before and turned with it by `world/frame.ts`, one transform in one place.

  Things that went wrong on the way. A lane in through a gate runs beside the gate road for its last few metres, and was dropped as a parallel street; that cut the inside of the walls off from the rest, and the whole walled city was thrown away as not connected to anything. A street is now dropped only if it runs beside a main road, not past its end. Long streets were left out at random between cross streets 120 m apart, which left fields in the middle of the suburbs; they are only left out between cross streets 60 m apart or less. A turning circle at every dead end read in 1800 as a row of little round plazas; only a street 6 m wide or more gets one. 2020 comes out with 1234 lots against the old grid's 1925. Most of the difference is the gardens of the estates and the suburbs, and that change of grain from one district to the next is the point; if the town should be denser, the lever is the district pitches in `eras/modern.ts`, not the planner.
- **Fog.** Always on, and it is the aerial perspective as much as the edge of the world. Colour equals the sky horizon so the world dissolves instead of ending; near and far scale with altitude so the far part of any frame reads as distance.
- **Motion.** Figures bob 5 cm when walking and rotate to their heading. Cars do not turn wheels. Nothing needs skeletal animation.
- **A figure is a person, not a brick.** Four shapes, about sixty triangles: a tapered column for the legs, a narrower one for the body, a shoulder ring, and a rounded head. The silhouette is what carries at five to eight pixels, so the proportions matter far more than the count. The geometry carries its own `color` attribute, which the material multiplies by the person's clothing colour, so one instance still gets a warmer head and darker trousers without a second draw call.
- **Nothing draws people through walls.** There was a second pass doing that, added when a building could not be opened and everybody indoors was simply not drawn. It scattered figures over the face of every tower between the viewer and the people behind it, so somebody on the far pavement looked stuck to a wall. Opening a building is how you see inside one.
- **Where people are visible.** Home and work take a person indoors and they stop being drawn; markets, parks and temples keep them outside, standing or sitting. M2 task 5 said workers should stand in rows at their desks, which cannot be seen through a solid box, so that part was dropped. Clothing is deliberately light: a 1.7 m figure is five to eight pixels from the roof band and the streets are dark, so mid-tones vanish.
- **Citadel era (M5) reference.** `docs/reference/citadel-style.png` is the look to aim for. Owner's decision, 20 Sep 2026: **the place is Vietnamese, the style and palette are the reference's.** So the layout comes from the Imperial City in Hue (a square citadel on the river, a moat, gates on each side, a walled inner enclosure, long low halls on a central axis, dense housing outside the wall), and the way it is drawn comes from the picture: flat cel shading, no textures, saturated colour, heavy tree canopy between the walls.

  Palette read off the reference. The first four are sampled from the image; the rest are derived from them for shading and trim, so treat those as a starting point to tune by eye:

  | Role | Hex | Source |
  |---|---|---|
  | Roof tile, lit | `#f6b06a` | sampled |
  | Roof tile, in sun | `#e28f44` | sampled |
  | Wall, violet | `#7d65a3` | sampled |
  | Tree canopy | `#597c48` | sampled |
  | Tree canopy, shaded | `#506f3f` | sampled |
  | Roof tile, shaded | `#b96a2c` | derived |
  | Wall, shaded | `#5d4a7c` | derived |
  | Courtyard stone | `#cfc7b2` | derived |
  | Minor roofs, grey tile | `#8b8f99` | derived |
  | Timber and doors | `#8e3b2e` | derived |

  Since the owner then asked for a realistic look (20 Sep 2026), these sampled values have been pulled down in saturation: the tile runs `#d9985c` to `#a96c3c` with grey slate and dark thatch mixed in, the stone is `#c9c3ae`, and the violet is now `#8a7e9c`, muted towards a weathered stone that still reads as violet. The violet is still the thing that makes the picture read, so it has not been drifted to brick red; if the realism should win outright, that is the next value to change. Build it from the same boxes, cones and prisms as every other era: a hall is a box with a wide flattened pyramid on top, a wall is a long box, a gate tower is a box with two stacked roofs. The look comes from the roof colour against the violet wall, the central axis, and the density of trees, not from imported models.
- **The roofs of the citadel** (`world/roof-geometry.ts`), which are the reason to look at it. Every one used to be a flattened pyramid of ten triangles: a tent. Three things make a roof of this kind, and none of them are the tiles.

  The slope is **concave**: it leaves the ridge steeply and flattens as it falls, sagging below the straight line a plain gable draws. The corners **turn up**, the eave sitting lowest at the middle of each side and sweeping to a flick at each of the four corners. And the **ridge** is a heavy capped bar along the top, with barge ridges running down the two ends to meet the corners. The ridge bar is deliberately heavier than it looks like it should be, because from directly above it is the only part with a hard edge on it and it is what tells you which way a building faces.

  It is one geometry, shared by every roof in the town and scaled per building, which is the whole reason it can afford 198 triangles: that times fifteen hundred roofs is still one draw call, because they are all the same shape. Two things had to be tuned down from the first attempt. A sag of 1.62 with a corner lift of 0.3 made the halls read as scrolls, saddles rather than roofs; a real one of these is subtle, and the eye takes the flick from the silhouette rather than from how far it travels. It is 1.22 and 0.17 now.

  **The sweep belongs to one century.** It is its own structure kind rather than a better `gable`, because the same eave on a 2020 suburban house is fancy dress. 2020 and 2300 keep the plain gable.

  **Tiered roofs on the halls.** A second, smaller roof above the first with a band of wall between them. Not decoration: a hall of this kind is one tall room and the band is a clerestory, which is how it is lit and vented. Every temple gets one and about a third of the taller houses do, and it is what separates the halls on the axis from the houses around them, which are otherwise the same orange rectangles.

  A geometry test caught what looking could not: all four barge ridges were wound face down, so from overhead, the one angle they are ever seen from, they lit as if they were the underside of something. A downward-facing triangle still draws, so the render looked merely a bit flat rather than wrong. Anything hand-built out of triangles gets a test that checks the normals.

- **The face of a building** (`world/facade.ts`). The roofscape gave the city a skyline, but from anywhere below the roof band a wall was still one flat rectangle with a window pattern painted on it. Measured: a whole built 2020 came to 90k triangles, about fifty a building, twelve for the box it is and forty for what sits on top. That is why it read as a bar chart from above and as cardboard from the street.

  So a building has depth on its face. A home gets balconies, two to a floor a side with a gap between them, because one run across the whole wall reads as a car park deck rather than as separate homes. A tower gets pilasters, thin ribs fitted evenly to each wall, which is the cheapest way to stop it being an extruded rectangle: they catch the light down one side and leave the other in shade. Anything on a street gets a band round the bottom in another material and a canopy over the door, which is what separates a ground floor from the eight above it.

  Each era reads that kit differently, and the reading is the era. 2020 is concrete slabs with pale metal rails; a dark rail against a pale wall was tried first and does not read as a railing at all, it reads as a hole punched in the building. 1800 has no balconies and no plate glass, so a rib at that scale is a verandah post holding up a deep eave and starts at three metres rather than twelve, or the town of small houses gets nothing. 2300 puts the planting on the building, so its balcony is a deep planted terrace with a glass edge.

- **The pavement** (`world/streetscape.ts`). Benches, planters and bollards, spaced along a street edge rather than placed per lot, because that is how they occur: a run of planters and a bench outside one shop and then forty metres of nothing. Roughly a quarter of the slots are deliberately left empty; an unbroken parade of benches is worse than a bare pavement, because it reads as wallpaper.

- **Triangles go to the city, not to the people** (owner's call, 20 Sep 2026). A figure had briefly been given eight sides and arms. The right answer is the simple one: a crowd is read as a crowd, by its density and its movement, and a sixty-triangle silhouette carries that at any size, whereas a building is read one at a time and every edge on it counts. What stays on the figure is the per-part tinting, which costs nothing and is what stops a person being a coloured brick.

  Where it went instead, per era, structures before and after: 2020 6,025 -> 18,017, 1800 3,932 -> 14,376, 2300 4,722 -> 22,883. About a million triangles at the roof band in 53 draw calls, which is what instancing is for: every one of those pieces is a box, and boxes are one draw.

- **Opening a building.** Click one and it stands open: its solid mass and its roof are taken away and a shell is put there instead, with a floor per storey, furniture by what the building is for, and the people who live or work in it standing on the floors rather than all at ground level. Click again to shut it; `X` shuts them all.

  Two things were learned getting here. A whole-town transparency does not work: it makes a soup, and a transparent wall still writes depth and goes on hiding what is behind it anyway. And taking only the roof off is not enough, because from overhead each floor slab hides the one below, so an opened tower shows its top storey and nothing else. What a doll's house actually does is take the *front* wall away. Which walls are the front ones depends on where the viewer is standing, so the two facing the camera are left out and the interiors are rebuilt when the view swings a quarter turn.

  Only a handful are ever open, so nothing about interiors is budgeted. They are seeded from the lot id, so the same building always has the same rooms in it.

  **People are only drawn when you can see them** (20 Sep 2026). Somebody inside a sealed building is behind a wall and the depth test throws the figure away, so drawing it is work nobody sees. At street level in 2020 that was 4200 figures and 890k triangles hidden inside offices: skipping them took the frame from 1,262,490 triangles to 371,514 with a pixel-identical picture. The same rule decides who may think out loud, which is what makes opening a building feel like turning a sound on.

- **Whose thought is it.** A pill belongs to a person, and everything about how it is placed serves that (`thoughts/place.ts`, tested).

  Three faults had to be fixed before it read that way, and all three looked like one vague complaint: the thoughts are not attached to anybody.

  - A thought was offered for anybody within 40 m, indoors or out. In the citadel and in 2300 most of the crowd is at a desk at midday, so every pill hung over a sealed roof with nobody underneath. Now only people you can actually see are candidates.
  - A pill centred on somebody at the edge of the frame hung half outside it and its text was cut in two. It now slides in off the edge and the tail leans over to keep pointing at the head, the way a speech bubble's does.
  - Pills that collide lift clear of one another, and a lifted pill grows a thread back down to its own head. Past 120 px of thread the pair stops reading as one thing, so the pill is dropped instead. That limit has to stay under `nudgeLimit * gapPx` or it can never be reached and the rule is dead code, which is how it shipped the first time.

- **Where people stand inside a building** (`world/interior.ts spotInside`, `spotOutside`). Everybody used to be put on the exact centre point of their lot at ground level. `arrive()` scattered the ones who walked in, but most of the town starts the day already indoors and never walks anywhere during a short look, so the pile was what you actually saw: open a building and sixty-four people were standing inside one another in a column, which from above is a single speck.

- **Which building somebody works in** (`agents/workplaces.ts`, tested). People used to walk to the work lot nearest their own front door, which sounds reasonable and produces a town nobody would recognise. Homes sit in the outskirts (median 331 m out) and workplaces in the middle, so the nearest workplace to a home is always another outskirt one: 70 of the citadel's 164 workplaces were never chosen at all, the whole centre of town stood empty at midday, and one shed on the edge held 210 people. A workplace has a size now, its share of the town's desks being its share of the town's floor area, and people fill the nearest one with a desk left in it. All 164 are occupied, the worst pile-up is 68, and the building at the centre of the view holds 64.
- **After the world is drawn** (`core/post.ts`). The scene goes through a `PostProcessing` chain rather than straight to the screen, with a second render target carrying view-space normals, because an edge between two surfaces facing different ways is not an edge in depth: without normals the corner where two walls of one building meet has no line on it.
  - **Tilt shift.** Sharp in a band across the middle, blurred above and below. This is the one that matters most: a depth of field that shallow only happens to something a few centimetres across, so the eye reads the whole town as a physical model on a table. It fades out below about 150 m, because at street level a human eye would not see it and it reads as a smeared lens instead.
  - **Outlines.** A dark line where depth or surface direction breaks. Screen space, which is the only way it can work here: a line measured in metres that reads at 400 m is a heavy border at 12 m.
  - **Bloom.** Lit windows spill past their own edges after dark, and only after dark. Without it a night city is a grid of bright rectangles that stop dead at the wall.
- **The country round the town** (`world/landscape.ts`, `world/forest-mesh.ts`, 23 Sep 2026). Seventy-six seven-sided cones became one height field of 86,400 triangles, and the first version of that stood up as a wall: the range reached full height in the last 114 m before the ring, and the peak specs put 400 m peaks at the edge of the plain as often as anywhere, so from above the town sat in a crater with streaked sides. Three changes made it a valley. The range rises over 620 m instead. A peak keeps only 30 percent of its height near the plain and all of it from 1500 m out, so the nearest mountains are shoulders and the big ones stand behind them. And a band of smooth rolling foothills, 36 m at most, turns the valley floor up into the range through country rather than at a crease. On the hills stand about twelve thousand trees in stands with clearings between them, thinning towards a tree line at half the highest peak and never on a slope steeper than 0.9. They stand on the mesh itself, sampled triangle by triangle (`sampleGrid`), not on the function the mesh was sampled from: between samples the two differ by a metre on a ridge and a tree stood on the wrong one floats.
- **The shore** (`world/ground.ts`). Water was one flat colour up to a ruled edge, which is how a map draws a coast. The strip is built from the bank out and carries the distance from it, so the water knows where it is shallow: pale over the bottom for the first 60 m, a line of foam at the edge that comes in and goes back on a seven-second lap, slow wide swell further out, and a tight faint highlight broken into glitter by small moving ripples. A broad bright highlight was tried first and lit a third of the sea white whenever the camera faced the sun. Behind the water a strip of sand, or of mud along a river, wet and dark at the edge and fading into the land along a ragged line. The coastline itself is sampled every 19 m rather than every 77, because the foam drawn along it made every corner of the old polyline obvious.
- **The roads carry what is painted on them** (`world/markings.ts`). A dashed line down a two-lane street, a double line and edge lines down an avenue, zebra crossings and a stop bar on the side the traffic arrives, at every junction with lights and 42 percent of the others. 2300 draws the same plan as strips of light that burn after dark, with a band of light where people cross and no stop bars. 1800 and Wyrmrest have wheel ruts in broken runs, and Wyrmrest grass between them. A lane line is 15 cm wide, a quarter of a pixel from the opening view, and a line that thin crawls as the camera moves, so every mark is drawn at least a pixel wide and faint in proportion: each corner knows which way its mark's thin side runs and grows along it in the vertex stage. Close up nothing moves and the paint is solid; from high up the roads carry a steady trace of their markings, which is what an aerial photograph shows. Transparent layers are sorted by the centre of their bounds, and the paint's centre is not the tarmac's, so the markings are drawn after every road layer by `renderOrder` or the carriageway covers them from some angles.
- **Parks are laid out** (`world/parks.ts`). A park was a bare block of town ground with trees on a loose grid, which from the roof band reads as a lot nobody has built on yet. Grass alone fixes most of that. Then paths, a cross or corner to corner by the lot's own jitter, a loop round the edge of a big one, a round plaza in the middle, flower beds between the paths and benches facing in. The piece in the middle is the era's: a fountain in 2020, a square lotus pond in 1800, the well with its little roof in Wyrmrest, a long still pool in 2300. The plan comes from the lot alone, never from a random stream, so `props.ts` asks for the same plan and keeps its trees off the paths.
- **The ground is not one flat tint** (`GROUND_GRAIN`). Two sizes of noise, 24 m and 7 m, both far larger than a pixel from anywhere the town is seen, so neither needs a fade. And the fields are turned 21 degrees against the town and bent by up to 34 m, because square, aligned and all one size they read from the cloud band as a chessboard laid under the town.
- **Whatever comes between the camera and the ground is cut away** (`state/altitude.ts NEAR_CUT`, `world/near-cut.ts`). In 2300 a tower is three times taller than the camera can be low, and coming down beside one filled the frame with one flat wall. Anything nearer the camera than 38 percent of its altitude, or 44 m, is discarded, with a five-metre dithered edge; the look-at point is never touched. A dither rather than transparency keeps it in the opaque pass and writing depth. Spread over twenty metres the dither turned a whole tower top into a screen door, so the band is narrow on purpose.
- **Text.** Thought bubbles are DOM elements, 13 px system font, light on a semi-transparent dark pill, positioned by projecting the person's head to screen space each frame. Font size does not scale with zoom; opacity does. They wrap rather than run off the frame, and they carry a tail pointing at the head they belong to. The lift above the head is part metres and part pixels: a lift in metres alone shrinks with altitude, so over an opened building the stack came to rest on the very crowd it belonged to.
- **A person is about sixty triangles, or a hundred and eighty.** The figure was sized for somebody five pixels tall, which is what they are from the roof band, but the camera comes down to 12 m and there a person fills a good part of the frame: six facets read as a hexagonal nut and no arms reads as a skittle. Eight sides and separate arms now, and the cost is paid back several times over by not drawing the people nobody can see. Above 300 m they are dots, because a person is roughly 1450/altitude pixels tall and three metres above that line a figure is three pixels.
- **A day on foot** (`story/`, `walk/`, 24 Sep 2026). The same toy world, seen from 1.62 m.
  - **The eye.** The field of view is held at about 75 degrees across (50 to 80 up and down), because the narrow view from above is a slot on a phone held upright. The near plane is 0.25 m, so a wall at arm's length is not cut open, and on the way down and up it follows the camera's height, or the street is cut open under the eye at the bottom of the flight. Tilt shift and the near cut are off at eye level.
  - **The ground layers are a few centimetres apart** (`LAYER_Y`). With the pavement half a metre up, everybody on it stood in it to the knee. Everything underfoot counts: a person of the day stands on a square, a lawn or a bridge, not sunk in it. The water carries a small depth bias toward the camera, because from the top of the range the far sea is kilometres off and the land a few centimetres under it showed through in green specks.
  - **The body** is a disc 0.35 m across that slides along what it cannot pass: the buildings, and whatever an era lists as `barriers` (the walls, the moat, the keep, a garden wall). Gate houses can be walked through. Water stops you except on a bridge, and so does the country 30 m past where the plan stops.
  - **The places of a day are cast by role** (home, work, market, park, temple, landmark, shore) from the seed's own town, by a seeded score that relaxes step by step until something fits. A test walks every day in every era from each place to the next, on three seeds.
  - **The day owns the clock.** It runs on to each part of the day's hour in 3.2 s and at about a quarter of an hour a minute in between. The crowd's thoughts go quiet while you talk.
  - **The people of a day** are the crowd's figure in their own clothes, a grey cat with one white paw in every era, and in 2300 a helper machine that floats. A faint gold ring on the ground marks whoever is waiting for you.
  - **The words.** A pill over whoever is speaking, placed like a thought's; your own words and thoughts along the foot of the glass; the line before a choice stays up with the two replies (1 and 2). A voice on the telephone sits along the foot with the caller's name. The crowd still thinks out loud on foot, three at a time rather than six, and only people you can see from where you stand: a pill over a wall with its person behind it reads as the wall thinking.
  - **Direction** is the gold light alone: it keeps about 9 m ahead and waits if you fall 16 m behind. When it is out of view, a small echo of it sits on the edge of the glass on the side to turn to. No arrow, no map, no marker text.
  - **Hands.** W A S D or the arrows, the mouse held by a click (Esc lets it go and opens the menu), Shift to hurry. On a phone the left 45 percent of the glass is a thumb stick, the rest looks, and a tap talks.
  - **Measured at eye level**, seed 1, headless, 25 Sep 2026, at the start of the fourth scene of each day (in 2300 also the fifth, in the old park): 63 to 71 draw calls; 1.6 million triangles in Wyrmrest, 1.8 in 2020, 1.8 to 2.0 in 2300 and 3.0 in 1800. The last figures, 1.0, 1.2, 1.9 and 2.4, were taken before the trees near the eye were drawn in full, and not at the same places. The story adds about 20 kB to the gzipped bundle.
- **2300, a garden town** (`world/eras/after.ts`, 24 to 25 Sep 2026). Owner's call, from photographs of modern Japanese gardens: "Low garden city". Then: put the landscape first, make a variety of buildings, be creative and keep it elegant; put lakes inside the town; and give it a heart "massive but elegant and beautiful that blends well with the style".
  - **Houses, not towers** (`world/houses.ts`). Low houses of a few kinds in two or three materials, pale plaster, dark boards, warm timber and dark glass: a pavilion under one deep roof, a house whose upper floor reaches out over its garden, a long gabled house, a house round a court. Workshops under folded roofs, the market under open timber halls, shrines on stone plinths. An eave never reaches past half the gap to its neighbour.
  - **Gardens** (`world/gardens.ts`, `world/water-gardens.ts`). A wall or a hedge in front of each house with a gate, beds and stones. Every park is a garden round a chain of pools, with stepping stones, an island and, in the bigger ones, a tea house half over the water.
  - **Lakes in the town** (`world/plan.ts`). Three, each in the middle of a district, the lanes stopping at the water, with a pier, a pavilion on stilts and trees at their edges; outside town, jetties and lone trees along the shore (`world/waterside.ts`).
  - **Calm air** (`EraAir`). More mist in the haze, a softer sun, fuller sky light, still water, the woods thinned to a tree here and there. Mist lies only over water: the sea's sheets, and two thin sheets just off each lake, below the eye of somebody on the bank, in wisps finer than a lake is wide, thinning from 40 m up and gone by 220 m. The first version was one sheet 4 m up at the sea's scale of noise, which sat over every lake as one even film: milk by day and pink at dusk from the air, and from the bank above the eye, facing away from it, so it could not be seen at all.
  - **Still water mirrors the far bank** (`world/ground.ts BANK_MIRROR`). Worked out against a ring of trees round each lake's own circle: from the bank a reflected ray rises as steeply as the eye looks down, and over most of the water it meets the trees across it before it clears them. So a lake is dark with a rolling tree line upside down in it, and only near the eye is it sky. Mirroring only the sky, it was a pale blue floor.
  - **The heart is a great hall on a pond** (`world/water-gardens.ts buildHeart`). The pond fills most of the square, wider than deep. The hall stands in its back on a stone base, under a lower roof all round and the great roof over it with its ends turned up; open galleries run out over the water to a tower on each side, on forward from the towers, and back to the shore behind, which is the way in. From the air it is a bird with its wings open. Cypress-bark roofs, dark timber posts, paper walls whose windows light at night. Straight across the water, a timber platform half over it, where the day's lunch is (`story/days/after.ts`). An island with one old tree and a lantern, reached by a zig-zag of planks; a heap of rocks with a red maple; lilies; reeds by the bridge; a gravel path round the pond that wanders nearer and further; a dark wood behind the hall with two gold ginkgos in it; open grass in front. It replaced a white ring of roof 120 m across round a round pond, which was massive and read from the air as a stadium: the one bright, hard-edged thing in a town of dark roofs, timber and moss. Two things were wrong on the way: a charcoal tile roof was a black lid on the water from above, and a path at one distance all the way round the pond was a running track round a pool.
- **Trees, near and far** (`world/tree-geometry.ts`, `world/tree-mesh.ts`, 25 Sep 2026). Owner's words: "Increase the details of trees to make they look realistic". A tree was a pole under six twenty-sided balls, flat shaded. What makes one read as a tree is not how many leaves it has:
  - **The crown is lit as one soft shape.** Every leaf's normal leans out from the middle of the whole crown as well as from its own clump, so the sun side is bright and the far side falls away, the way a canopy does. The normals are the surface's own worked out in tree space, and never leaned outward there: an instance stretches a conifer to twice as tall as it is wide, which stretches every normal toward the horizontal, and the first conifers, leaned outward on top of that, were lit from above as if their tiers were walls.
  - **It is dark inside and underneath**, a shade baked into each vertex, and **it has wood in it**: a trunk that forks into limbs with twigs off them, or the thin stems of a garden tree.
  - **Leaves, not balls.** Near the eye a clump is a shell of leaf cards round a smaller dark core. Each card is a square laid on a face of a polyhedron round the clump, a little outside it and a little bigger than the face, so the cards overlap and stand out past the core, and the material cuts each one into a cluster of leaves with noise in its own square, thinning toward the corners. A solid clump seen close is a ball, and a flattened one a plate: from under a tree the first version was a stack of cut paper. The light on the leaves is three sizes of noise in the world (clusters, sprays, single leaves), with the green drifting yellower and bluer across a crown. A conifer is tiers that rise to the trunk and droop at a ragged rim of branch tips.
  - **Near and far.** Each kind is two instanced meshes. Nearer the eye than 110 m a tree is drawn in full, about 1,250 triangles for a broadleaf, 650 for a garden tree and 600 for a conifer; past 140 m it is 150, 164 and 100, about what it was before; in between both are drawn, and the screen-space dither of the near cut shares the pixels between them. That is measured from the eye, not from whichever camera is drawing, or in the shadow pass, where the camera is the sun, a tree near the eye would cast no shadow at all. The CPU sorts the trees whenever the eye has moved 6 m (`TREE_DETAIL`). From the roof band up no tree is that near, so the view from above costs what it did.
  - **They move a little**: a slow sway with the square of the height, so the trunk stands and the crown moves, and a quicker flutter in the leaves, on the weather clock, which stands still for anybody who asked for less motion.
  - A shrub is three lumps of twenty faces each. At eighty faces a lump, the citadel's fifteen hundred shrubs cost more than all its trees.

## 6. Milestones

Each milestone is one or more pull requests. A milestone is closed when: `npm run typecheck`, `npm test`, `npm run build`, and `npm run smoke` pass; the manual checklist below is done on desktop and on a phone; a screenshot is saved in `docs/screenshots/<milestone>.png`; and this file's status line is updated.

### M0. Skeleton (done, 19 Sep 2026)

Vite + TypeScript + three.js WebGPURenderer with WebGL2 fallback, orbit camera clamped to look down, altitude bands, seeded PRNG, placeholder grid of 1,600 instanced boxes, debug HUD (key H), GitHub Pages workflow, Vitest and Playwright smoke test.

To do once on GitHub: create the repo `zenith`, push to `main`, then in the repo settings under Pages set Source to "GitHub Actions". The workflow deploys on the next push.

### M1. The city (modern era only) (done, 20 Sep 2026)

Goal: a believable low-poly modern city seen from any altitude, with day and night.

Closed with 14 draw calls at 900 m (27 with shadows on below 300 m, 10 from satellite height), 258 kB gzipped, 54 unit tests. Screenshots in `docs/screenshots/`: `m1.png` (opening view), `m1-night.png`, `m1-satellite.png`, `m1-seed7.png` (a river city from a different seed). Not yet checked on a real phone; that is the one open acceptance item.

What changed while building it, beyond the task list:

- **Fog and the land.** Fog near/far scale with altitude, because three's fog measures distance from the camera and from 5 km up the ground below is 5 km away. The land disc runs to 12 km so the fog ends the world instead of a visible rim.
- **Camera clip planes.** Near and far now grow with altitude. A fixed 1 m near plane leaves metres of depth error at 6 km, which made the roads fight with the ground they are painted on.
- **Window lights** are computed from world position, not local position, so they line up across the city and the pattern stays in the fragment stage. Instance attributes are wrapped in `varying()`; without that the whole pattern is evaluated per vertex and smears across each face.
- **Hemisphere light** rather than a flat ambient, so the vertical faces of a tower catch sky light. With a flat ambient a city at noon reads as a black mass.
- **Shadows** are in, on below 300 m only, with 40 m of hysteresis because crossing that line rebuilds shaders.
- **Trees in the countryside** as well as in parks and along boulevards, in clumps, so the plain between the ring road and the mountains is not bare.
- **Debug URL params** `?hour=` and `?alt=` alongside `?seed=`, so a fixed moment can be screenshotted. See section 8.

Tasks:
1. `world/terrain.ts`: ground disc r = 1500 m, mountain ring (a ring of cones/hills 1500 to 2200 m, heights 100 to 400 m), a river or coastline cutting the disc (rng-chosen), fog matched to sky.
2. `world/roads.ts`: grid road graph with a few diagonals and a ring road; pure `buildRoadGraph(rng, terrain)`; helper `nearestNode(x,z)` and `shortestPath(a,b)` (A* on the graph; test it).
3. `world/lots.ts`: split blocks into 2 to 6 lots each; assign `LotUse` with weights that vary by distance from centre (more work downtown, more homes outside, parks and a temple sprinkled in). Pure and tested.
4. `world/buildings.ts`: one `InstancedMesh` per building style (3 styles: slab, tower, low). Heights from lot use and distance to centre. Window lights: an emissive node/material whose intensity is a function of `clock.hour`, plus per-instance random "some windows are dark" via an instance attribute.
5. `world/sky.ts` + `state/clock.ts`: sun direction, sky/fog colour ramp (noon, dusk, night, dawn), day speed, pause key.
6. `world/props.ts`: trees (cone + cylinder) in parks and along boulevards, street lamps that light at night (emissive only, no point lights).
7. Altitude policy for buildings: above 3500 m swap to the flat colour version (a second cheap material or just remove window emissive) and hide props.

Acceptance:
- From 5000 m the city reads as a real city shape with a river/coast and a mountain ring, not a uniform grid.
- Night looks like a city at night: window lights and lamps, dark ground, no bright sky.
- Draw calls under 60. 60 fps desktop, over 30 fps on a mid-range phone at 900 m.
- Regenerating with a different seed (add `?seed=123` URL param) gives a different but equally good city. Same seed gives the same city.

### M2. People and traffic (done, 20 Sep 2026)

Goal: the city is inhabited. Tiny figures walk between home, work, market, park; vehicles drive on roads. Both disappear at the right altitudes.

Closed with 4000 people and 800 vehicles, 17 draw calls, 0.5 to 0.6 ms of agent update per frame against a 4 ms budget, 266 kB gzipped, 93 unit tests. Screenshots in `docs/screenshots/`: `m2.png` (morning, 650 m), `m2-evening.png` (380 m). Not yet checked on a real phone, same open item as M1.

A simulated day, counted in node rather than by eye: everyone indoors at 05:00; 1000 walking by 07:00; a settled midday with about 450 standing in markets; a second wave from 18:00; indoors again by 01:00.

What changed beyond the task list:

- **The day is now 15 real minutes** and destinations are the nearest of their kind. See section 4.5 for why; without both, nobody ever arrived anywhere.
- **Vehicles wander** rather than route. From above, a car taking a random turn at each junction is indistinguishable from one with somewhere to be, and it costs no pathfinding. How many are on the road varies with the hour.
- **Pavement offsets are baked into the waypoints** when a route is built, using the mean direction either side of a junction, so a walker cuts the corner instead of stepping sideways across the street.
- **Two thirds of vehicles are scooters** (task 6, taken up rather than left optional).

Tasks:
1. `agents/pool.ts`: structure-of-arrays pool with capacity 4000 people and 800 vehicles. No per-agent objects.
2. `agents/schedule.ts` (pure, tested): `desiredLotUse(role, hour, rng)`; roles: office worker, shopkeeper, student, retired, night worker. Include small random offsets so movement is staggered.
3. `agents/people.ts`: spawn people into homes; each frame (time-sliced: agents within 400 m of the camera target update every frame, others every 8th frame) move along their path at 1.2 to 1.6 m/s; on arrival switch to a pose state (working, resting) for a scheduled duration; then pick the next destination. Render with one `InstancedMesh` of a 3-box figure; colour per instance from the era's clothing palette; hide entirely above 300 m; render as flat dots (a `Points` object sharing the same position arrays) between 300 and 1200 m.
4. `agents/traffic.ts`: vehicles follow road edges lane-offset, stop briefly at nodes (fake intersections), speed 8 to 14 m/s. Render as instanced boxes below 1200 m and as moving dots between 1200 and 3500 m. Above 3500 m, hidden.
5. Activity poses in the street band: at a work lot, figures stand still in rows (desks); at a market, they cluster; at a park, they sit (scale y by 0.6). Simple, readable from 30 m.
6. Optional scooters for the modern era (a smaller vehicle class, more of them, this is Vietnam).

Acceptance:
- At 800 m you see traffic flowing; at 200 m you see people; at 40 m you can watch one person walk to a door and "go inside" (disappear for a while).
- Morning and evening show visible commute waves.
- Simulation CPU under 4 ms per frame with 4000 people + 800 vehicles (measure with `performance.now()` around the update and print in the HUD).

### M3. Thoughts (done, 20 Sep 2026)

Goal: below 60 m, short thoughts appear above nearby people and vanish as you rise.

Closed with 73 thoughts, 117 unit tests, 268 kB gzipped. Screenshots in `docs/screenshots/`: `m3.png` (someone sitting in a park), `m3-market.png` (two pills nudged apart at a market). Not yet checked on a real phone, the same open item as M1 and M2.

The acceptance thresholds are asserted in `src/state/altitude.test.ts` rather than judged from a screenshot: gone at 70 m and at 66, under a quarter opacity at 60, full at 44. Measured on a render, the text contributes nothing above the background at 72 m, about three pixels at 62 m, and reads clearly at 52 m.

What changed beyond the task list:

- **People start the day where their schedule puts them.** Everyone used to spawn at home, so opening the world at noon meant minutes of the city walking itself into position before it looked like anything.
- **Pills are not depth tested.** They are DOM, so a thought shows even when its person is behind a building. Occluding them would mean a depth read per label per frame, and from the street band it is rarely noticeable. Left as it is.
- **A thought is chosen by a steady hash of person and place**, not at random, so the same person keeps the same worry rather than flickering between them.

Tasks:
1. `thoughts/content.ts`: at least 60 thoughts for the modern era, grouped by place (`home`, `work`, `market`, `temple`, `park`, `street`). Plain, present-tense, first-person, under 60 characters. Relatable and gentle (deadlines, money, love, health, small errands, career, food). No mocking, no politics, no brand names.
2. `thoughts/thoughts.ts`: each frame in the street band, find up to 6 people nearest to the camera target within 40 m (reuse the time-sliced "near" list). Give each a thought chosen by their current place. Keep a thought attached to the same person for at least 8 s. Project head position to screen; position a DOM pill; opacity = `smoothstep(60, 40, altitude)` times a per-thought fade-in.
3. Tests for the selection logic (pure): stable choice, no duplicates, respects the 6 cap, keeps thoughts for 8 s.

Acceptance:
- Scrolling down from 100 m to 30 m, thoughts fade in after the people are clearly visible, never before.
- Zooming out, the text is unreadable by 60 m and gone by 70 m.
- No layout jank: pills do not overlap each other more than briefly (simple vertical nudge if two are within 24 px).

### M4. Sound and the quiet UI

Goal: the world sounds like a place, and the controls exist but stay out of the way.

Tasks:
1. `audio/audio.ts`: AudioContext unlocked on first pointer/key event. Wind = filtered pink noise, gain rises with altitude (0.1 at street, 0.6 at satellite). City murmur = a looped file `public/audio/murmur-modern.ogg` (under 200 kB, under 20 s, seamless), gain = `1 - smoothstep(300, 2500, altitude)`. Accents = short one-shots (horn, bell, birds) triggered rarely in roof/street bands. Mute button and a `?mute=1` param. Respect `prefers-reduced-motion` by not auto-playing time-lapse.
2. `ui/bar.ts`: bottom bar with era dial (disabled until M5, show only "Modern 2020"), four vantage buttons, mute, help. Auto-hide after 4 s idle; show on pointer move or touch. Keyboard: 1 to 5 eras, R/M/C/S vantage, space pause, H HUD, ? help.
3. `core/camera.ts`: `flyTo(preset)` tween over 2.5 s with ease-in-out; presets: roof (150 m, inside city, tilted 35 degrees), mountain (900 m, at the ring, tilted 45 degrees), cloud (2500 m, tilted 15 degrees), satellite (5500 m, straight down).
4. Load screen: fade from black over 1.5 s once the first frame is ready.

Acceptance:
- Sound cross-fades smoothly through the whole zoom range; no clicks or gaps in the loop.
- On a phone, pinch zoom and one-finger orbit work; the bar is tappable; nothing is under the notch.
- Site loads and shows the first frame under 3 s on throttled "Fast 4G" in Chrome devtools.

### M5. Eras (part closed, 20 Sep 2026)

Goal: the same land through five eras, with a time dial and a "century in a minute" time-lapse.

Closed in this pass: the `Era` interface and registry, the modern city refactored into `eras/modern.ts`, the citadel built properly, the sink-and-rise transition, and the era dial in the bottom bar. Left for later: the fields, colonial and after eras, the "century in a minute" button, and the audio cross-fade (which waits on M4).

Numbers: 13 draw calls and 269k triangles for the citadel at 1500 m, 22 draw calls and 407k triangles during a transition with both eras in memory, 274 kB gzipped, 131 unit tests. Screenshots in `docs/screenshots/`: `m5-citadel.png` (1500 m, morning), `m5-citadel-low.png` (520 m, where the compounds and the halls read), `m5-citadel-night.png`, `m5-transition.png` (the modern towers rising through the sinking citadel). Not yet checked on a real phone, the same open item as M1 to M3.

What changed beyond the task list:

- **The era build runs one step per frame.** See section 4.6. Doing it in one call cost 174 ms, which is six dropped frames. Split into steps, the worst is 28 ms.
- **Road nodes are found through a grid** (`roads.ts buildNodeIndex`). `nearestNode` scans the whole graph, which is fine once but not once per lot: 5176 lots against 1091 nodes cost 26 ms of a single frame, now 7.
- **The nearest-lot search had a real bug.** Both grid searches stopped one ring after the first hit. From outside the city the first hit can be fifteen rings out and the true nearest several rings further, so a person at the edge of town could be sent to the wrong market. The stop test is now the ring's inner edge against the best distance so far, which is exact. Both searches have a test against a full scan.
- **Trees are placed per compound, not only in parks.** The reference picture is half tree cover, and the citadel needs about 4400 trees to read that way. `PropPalette` gained `courtyardChance` and `canopyScale`; the modern city sets them near zero and 1.
- **Props no longer copy their placements.** A trunk and its canopy now read one shared list through three size functions. Copying 4400 trees twice cost 37 ms; writing the matrices directly costs 9.
- **Each era sets its own window lighting.** A town on oil lamps showed the modern grid of white panes at night. `windowsLit` and `windowGlow` moved into the palette: 0.42 and 0.85 for 2020, 0.08 and 0.3 for 1800.
- **The people pool is allocated for the largest era.** It used to be sized for the era the page opened in, so entering 2020 from 1800 gave a city of 4000 only 2600 people.

Tasks:
1. `world/eras/index.ts`: the `Era` interface and registry. Refactor the modern city from M1 into `eras/modern.ts` so it becomes one generator among five. The terrain (disc, river, mountains) is shared across eras; only the layout changes. **(done)**
2. Generators: `fields.ts` (paddies as flat coloured quads with dyke lines, scattered huts, dirt paths, ox carts as vehicles, people in conical hats = a cone on the head), `citadel.ts` **(done)**, `colonial.ts` (low 2 to 3 storey ochre/yellow buildings, tree-lined boulevards, a tram line as a vehicle route, bicycles as vehicles), `after.ts` (modern layout but buildings partly sunk and green, trees everywhere, few people, birds as a `Points` flock, no cars).
3. `state/era.ts` + transition (see 4.6): height scaling for sink/rise, road colour cross-fade, agent respawn at t = 0.5, audio cross-fade. Each era gets its own thought set (at least 40 per era) and murmur loop. **(done apart from the audio, which waits on M4; 73 modern and 50 citadel thoughts)**
4. Era dial in the bar: a horizontal slider with five stops and the year label; keys 1 to 5; "century in a minute" button that steps through eras 1 to 5, 12 s each, then stops. **(dial, year labels and keys done; unbuilt eras are shown dimmed and do nothing; the time-lapse button is not built)**

How the citadel is drawn (task 2, for whoever builds the other three):

- The plan is Hue's. A square wall 940 m across with a gate in the middle of each side, a moat outside it, a smaller enclosure inside opening south only, and four halls down the central axis with paved courtyards between them. `cutAtWalls` drops every lane that crosses a wall away from a gate, then keeps the largest connected piece, so the walkers can still reach everywhere.
- The town is made of small compounds, about 8 m across, not city blocks. That one number is most of what makes it read as 1800 rather than a low-rise 2020.
- Nothing is a tower, so every building draws in the low mesh, and each one gets a four-sided roof from `structures.ts` that overhangs its walls by a quarter.
- The palette comes from `docs/reference/citadel-style.png`: orange-gold tile, violet walls, pale stone paving. It is deliberately not drifted towards brick red for realism.

Acceptance:
- Switching eras never drops below 30 fps on a phone (measure the transition frame). **Measured in node, not on a phone: the worst build step is 28 ms and the reseat is 14 ms, both inside a 33 ms frame. The phone check is still open.**
- From satellite height each era is recognisable at a glance by its shape and colour. **Holds for the two built eras: the citadel is an orange grain inside a violet square, the modern city is grey with a dense centre.**
- People's thoughts change with the era but stay the same kind of worry (a farmer worries about rain, a clerk about the report). **Done, and a few worries deliberately recur in both sets, which is the point of the piece.**

### M5b. Wyrmrest, the mythic age (done, 20 Sep 2026)

Goal: one world that is not history, in place of the two eras that were planned and never built.

On the owner's call, 1500 Fields and 1930 Colonial are given up and their two slots become one: a western high-fantasy age before all the others, leftmost on the dial and labelled by a word rather than a year, because it does not have one and pretending otherwise would be the only false note on the dial. Four finished places beat five with two dark stops, which is the same call that made the settlements smaller and more detailed.

**The rule it is built to is the same as every other era's: the magic is in the nouns.** Nobody in Wyrmrest is awed by their own world. A dragon asleep under the hill is a fact of the local geography, the way a river is, and the people walking to market are thinking about the rent, the child, and the knee that hurts in the cold. Several of its thoughts are word for word the ones from 1800 and 2020, which is the whole point of the piece. Nobody narrates the magic, nobody explains its rules, and nobody says anything a person would not say about a wolf.

What makes it read as this and not as the citadel:

- **The wall is not straight.** A closed curve with a slow wobble in it at three and five lobes, with drum towers at intervals and three gates. A square wall is an imperial one; this is a wall built by people who put it where the digging was easiest. Two wavenumbers rather than one, or it reads as an egg.
- **The roofs are steep.** `RoofStyle.pitch` is 0.78 against the tropical 0.34, which is most of what separates a northern town from a southern one: the same house plan under the two roofs reads as two climates. The pitch used to be a module constant; it is the era's business now.
- **The keep stands apart and looks down**, square, on a motte, with four turrets and their caps.
- **Half-timbering**, which the facade kit already knew how to draw: dark ribs one storey tall on lime-washed daub is what the citadel's verandah posts are, in another century.
- **Only the three tracks out of the gates** survive outside the wall. The road builder covers the whole disc, and a chequerboard of lanes through empty fields is a thing no age before surveying ever had.

**The dragon** (`wyrmStructures`) is landscape, not an agent: geometry laid once, costing nothing per frame. From the roof band it is a long low ridge with a bend in it that anyone would take for a hill. From satellite height the bend resolves into coils, the ridge into a spine of plates, the rounded end into a head, and the two banks at the shoulders into folded wings. That order is the whole point. A monster you are told about is set dressing; one you work out for yourself, from a shape you had stopped looking at, is what the place is named after. So there is no glow and no marker, and the town ignores it, because you do not point at the hill you grew up beside. Folded wings rather than spread ones, because a spread wing is a creature in flight and this one has not moved in a very long time.

**What lives there** (`agents/monsters.ts`), split by where it is rather than by what it is, because from four hundred metres that is the only part a viewer can read:

- **Imps** on the lanes in town, walking the road graph node to node, so they never cross a wall or stand in anybody's parlour.
- **Beasts** on the open ground outside, which is why the wall is there.
- **Heroes** out on the same ground looking for them.

A hero who gets within sight of a beast closes on it, fights it for a few seconds, and the beast breaks off and runs. The rules are in `agents/hunt.ts`: four states, one timer, pure and tested. There is deliberately no health, no damage and no winner, because the piece is not a game and a fight it could lose would change what the whole thing is about. What a viewer sees from above is two shapes closing, striking at each other three times, and one of them going home, and that reads as a fight. Anything more would only exist in numbers nobody is shown.

The first attempt had 46 beasts and 26 heroes over a ring of more than a square kilometre, which is one creature every hundred metres: the ground looked empty and the hunt never happened in shot. They are cheap next to twelve thousand people, so there are enough of them now to meet, in a band just outside the wall where framing the town puts them in view.

### M6. Souls

Goal: follow one small light from one life to the next.

Tasks:
1. Picking: in the street band, a click/tap raycasts the people `InstancedMesh` (`instanceId`) and selects that person. Highlight with a faint gold ring on the ground under them.
2. `core/camera.ts` follow mode: the orbit target tracks the person with damping; the viewer can still orbit and zoom; zooming above 60 m releases the follow.
3. `ui/lifecard.ts` + `souls/lives.ts`: a three-line card (name from an era-appropriate list, age, one worry drawn from the person's current thought set). Fades in at the corner of the screen, not over the person.
4. Hand-over: after 20 s of following (or on release), a small gold light (a sprite or a small emissive sphere with a soft glow) rises from the person to about 80 m, drifts, and descends onto another person. With probability 0.5 the destination is in another era: trigger the era transition while the light is at its highest point so the land changes under it. The card updates to the new life. The chain continues until the viewer zooms out.
5. Reduced motion: if `prefers-reduced-motion`, the hand-over is a cross-fade instead of a flight.

Acceptance:
- A full soul chain across three eras works without a hitch and without the camera clipping through buildings (raise the camera minimum during flight).
- Following someone for two minutes shows them do at least two different things (walk, work, rest).

### M7. Polish and performance

Tasks: profile on a real phone; tune band thresholds by feel; adjust palettes so all five eras look like one family; make sure nothing pops; adaptive quality (drop pixel ratio to 1 and shadows off when frame time exceeds 20 ms for 2 s); `?seed=` sharing; a tiny "about" line in the help popup (one sentence, no lecture).

Acceptance: all budgets in 3.1 met on the reference phone; a 5-minute unattended session shows no memory growth.

## 7. Content guidelines (thoughts and life cards)

- First person, present tense, plain words, under 60 characters. Example: "I should call my mother." "The rent is due Friday." "Did I lock the door?" "One more year, then I rest." "He did not text back."
- Mix of work, money, love, health, food, small errands, hopes, and small kindnesses. About one in ten should be light and funny. About one in ten should be tender ("I hope she gets in.").
- Era flavour comes from nouns, not from old-fashioned grammar. Fields: rain, buffalo, harvest, tax collector, the temple fair. Citadel: the mandarin's exam, the market price of silk, the drum at dawn. Colonial: the tram fare, French lessons, a letter from Hue. Modern: the report, the promotion, the scooter loan, the grant deadline. After: the birds, the flood line, the old tower.
- Never: mocking, politics, religion as a joke, brand names, real people, cruelty.
- **What a person thinks depends on where, who and when** (23 Sep 2026). A line can belong to a place, to a kind of person (office, shop, student, retired, night worker), or to a part of the day (dawn, morning, afternoon, evening, night), and a person draws from all three at once, so a student and a grandmother at the same stall no longer draw from the same forty lines and noon no longer sounds like midnight. Under every era is a shared human core of 254 lines (`thoughts/human-content.ts`), which makes the piece's idea structural: a clerk in 1800 and a clerk in 2300 pick from one list, with different nouns on top. 977 lines in all. Tests hold the shape: every pool at least 60 lines, the core free of anachronisms by whole word, no core line repeated in an era set, and over half the lines spoken as I, me or my, because a line with nobody in it reads as a caption.
- Life cards: `name` from an era list (Vietnamese names throughout; the land is the same land), `age` 6 to 85, `worry` one thought.

## 8. Testing and verification

- `npm run typecheck`: strict TypeScript, no errors.
- `npm test`: Vitest unit tests for everything pure (PRNG, bands, road graph, pathfinding, lots, schedules, thought selection, era transition maths). Aim for every pure module to have a test file next to it. Each day on foot is played down every path of replies: every part of the day is reached, every ending can be reached, the clock only goes forward, and every line fits its pill.
- `npm run build`: production build; check the reported gzipped size against the budget.
- `npm run smoke`: headless Chromium render; writes `docs/screenshots/smoke.png`; fails on page errors. Agents without a display must run this and read the screenshot.
- Manual checklist per milestone (desktop and phone): zoom from 6000 m to 12 m and back; check each band boundary for popping; night and day; era switch; a soul chain; mute; bar auto-hide; rotate the phone.
- Measuring a level-of-detail pop: hold the camera **exactly** still and change only the detail. Two renders 10 m apart in altitude differ by 76% of pixels on their own, because a city is mostly thin vertical edges and they all move. That number was twice mistaken for a pop; a control pair with the detail unchanged gives the same number. Freeze the clock with `?pause=1` too, or a drifting sun moves every shadow between the two shots.
- Performance HUD: extend `ui/hud.ts` to show draw calls (`renderer.info.render.calls`), triangles, agent update ms, and current era. Note that three resets those counters inside its own animation loop, which runs before ours, so they are read after `render()` and `renderer.info.autoReset` is off.
- URL params, all optional: `?seed=123` picks the city (shareable); `?hour=21` starts the day clock there; `?pause=1` freezes it; `?alt=5200` opens at that altitude; `?at=-33,54` looks at that point on the ground instead of the centre; `?era=citadel` opens in that era; `?day=1` starts a day on foot at once, without the flight down, and `?scene=3` starts it at that part of the day, a few steps from the place. The last four exist so a reviewer or a headless render can set up a particular moment; checking anything at street level is impractical without `?at=`. The last two exist only so a reviewer or a headless render can capture a fixed moment; they are not part of the experience.

## 8.1 What a full read of the code turned up (20 Sep 2026)

An audit of every module, after the owner asked for one. The findings worth recording, because each is a class of fault rather than a one-off:

- **Four palette fields did nothing.** `canopyRound`, `roundShare`, `bush` and `bushesPerTree` were declared, set by all three eras, carried into `PropPalette` and never drawn: `createProps` built the geometry for the second crown and the shrubs and then never passed either to `instanced`, and never read `placements.bushes` at all. So every tree in every era was the same cone and there was not one shrub in the world, which is exactly the plantation the code's own comment says the second shape exists to prevent. Written, configured, wired, never called.
- **Choosing the era already on screen, during a build, wedged the world.** `showEra` let it through, `beginEraChange` then refused the no-op, and the cross-fade never started, so the recovery that restores the new city's height and removes the old group never ran. The old city stayed in the scene forever, a flat copy of it painted over the roads, and clicks landed on an invisible squashed duplicate so buildings stopped opening. Pressing two stops in quick succession was enough. The guard now asks what the world will be showing once everything in flight has settled.
- **A missing lot use would have hung the tab.** `nearest` stops searching when the best distance so far beats the next ring's inner edge, and with nothing to find that distance stays infinite: all 193 rings ran, 9.6 million iterations and 148,000 string keys, per call. `populate` calls it once per person. It was unreachable only because every era happens to have every use. Both grid searches now know the cells their data occupies.
- **Nothing was ever disposed.** Every era change orphaned a whole city's meshes, materials and instance buffers against a 300 MB budget.
- **A shadowed variable made mountains grow with distance.** `buildMountains` bound `r` to the settlement radius and then shadowed it with the peak's own distance from the centre, so the outer ring came out five times the volume of the inner one. The unused-variable warning was the only sign.
- **`reducedMotion` was read from the OS and passed to nothing.**
- **Comments that had outlived their code**, including three written the same day, promising an altitude threshold that had been measured away.

## 9. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-09-19 | three.js over PixiJS or Godot | true 3D zoom from sky to street; instancing; small bundle; static hosting |
| 2026-09-19 | WebGPURenderer with automatic WebGL2 fallback | future-proof, one code path |
| 2026-09-19 | No free-text "put yourself in it" feature | owner decision |
| 2026-09-19 | No UI framework | UI is a bar and a card; DOM is enough |
| 2026-09-19 | Procedural everything, seeded | no asset pipeline, tiny download, infinite variety |
| 2026-09-19 | Five eras on one shared terrain | carries the reincarnation idea with one world, not five |
| 2026-09-20 | Fog range and camera clip planes scale with altitude | a fixed range either buries the world from above or leaves a visible rim; a fixed near plane makes roads z-fight with the ground at 6 km |
| 2026-09-20 | The land runs to 12 km and is ended by fog | "fog beyond" only works if the rim is out of sight |
| 2026-09-20 | Hemisphere light, not ambient | tower sides need sky light or downtown reads as a black mass |
| 2026-09-20 | Window lights keyed to world position, with instance attributes wrapped in `varying()` | keeps the pattern in the fragment stage and lines floors up across the city |
| 2026-09-20 | Shadows below 300 m only, with 40 m hysteresis | the toggle rebuilds shaders, so it must not trip twice a second |
| 2026-09-20 | People spawn where the opening hour puts them | starting everyone at home meant minutes of settling before the city looked inhabited |
| 2026-09-20 | Thought pills are not occluded by buildings | they are DOM; a depth read per label per frame is not worth it at this scale |
| 2026-09-20 | A day lasts 15 real minutes, not 6 | at 6 a schedule slot was shorter than the walk it started, so nobody ever arrived anywhere |
| 2026-09-20 | People go to the nearest market, park or temple, and work near home | same reason: an errand has to fit inside the slot of the day that sent them out |
| 2026-09-20 | Vehicles take a random turn at junctions instead of routing | indistinguishable from above, and it costs no pathfinding |
| 2026-09-20 | Home and work take people indoors and out of sight | a figure at a desk inside a solid box cannot be seen; markets and parks keep people outdoors instead |
| 2026-09-20 | Citadel era: Hue's layout, the reference image's style and palette | owner's call. Vietnamese place, so a square citadel with a moat and gates; but the flat cel shading, the orange-gold roofs against violet walls, and the heavy canopy come from `docs/reference/citadel-style.png` |
| 2026-09-20 | An era is built one step per frame, not in one call | building the citadel in one call costs 174 ms, which is six dropped frames; the frame rate is a hard budget (3.1) |
| 2026-09-20 | The transition starts when the build finishes, not when the stop is pressed | the alternative is a stall at the moment the viewer acts, which is the worst place for one; the bar lights the coming stop meanwhile |
| 2026-09-20 | Nearest-lot and nearest-node searches stop at the ring's inner edge | stopping one ring after the first hit is wrong from outside the city, where the first hit can be fifteen rings out |
| 2026-09-20 | Tree cover, window lighting and canopy size belong to the era palette | a town on oil lamps was showing the 2020 grid of lit windows, and the citadel needs about 4400 trees to look like the reference |
| 2026-09-20 | The people pool is allocated for the largest era, not the opening one | entering 2020 from 1800 otherwise gives a city built for 4000 only 2600 people |
| 2026-09-20 | Look: an aerial photograph, not a painting | owner's call, after first asking for an animated-film look and then for a realistic one. The structural half of that work (roofs, rooftop plant, cast shadows, haze, cloud shadows, daytime windows) serves both; only the palettes changed between the two |
| 2026-09-20 | Lights are set so a lit flat surface shows its own colour at noon | the previous intensities rendered everything at half the value of the palette, which is why every early screenshot came back muddy whatever the palette said |
| 2026-09-20 | The land is two colours, town ground and country | ground between buildings in a real city is yard, path and tarmac; one green disc was the largest single thing making this read as a model railway |
| 2026-09-20 | Every building gets a roof from `world/roofscape.ts` | a city seen from above is mostly roofs, and flat-topped boxes read as a bar chart. Owner's words: "boring boxes without personality" |
| 2026-09-20 | Shadows run to 800 m, not 300 | below that a cast shadow is most of what gives a city its shape |
| 2026-09-20 | The daytime window pattern fades out by 520 m | a 3.6 m floor is about one pixel from there and a hard pattern sampled that finely turns into black moire |
| 2026-09-20 | One small settlement, radius 460 m, not a city | owner's call. Nothing is culled, so the radius multiplies the cost of every frame; and at this size the detail budget per hectare is five times what it was |
| 2026-09-20 | Everybody is drawn, indoors and out | the crowd was invisible while its thoughts floated over the roofs. Indoors people are placed inside their own building, a second pass shows whoever is hidden, and the aerial dots are not depth-tested |
| 2026-09-20 | Rim light rather than an outline | a warm edge on faces turning away from the camera gives the silhouette an illustrated edge and costs no pass. A world-space outline cannot work here: one thick enough to read at 400 m is a border at 12 m, and the zoom range is the point. A real outline needs a screen-space pass |
| 2026-09-20 | The hour is a slider on the bar, not only a URL parameter | the light is half of what the place looks like, and waiting fifteen real minutes to see dusk is not a way to look at it |
| 2026-09-20 | 2300 is a future, not a ruin | owner's call, replacing the green-ruin version. The road grid is still 2020's, because that is what ties the eras to one piece of ground |
| 2026-09-20 | A lit window's colour belongs to the era | it was fixed at one warm tone, so every century's night looked like the same century. An oil flame is orange, a filament is warm white, 2300 is cool |
| 2026-09-20 | Nothing is drawn through a wall | owner's call. Seeing the far pavement's crowd stuck to the near tower is worse than not seeing them |
| 2026-09-20 | The frame goes through a post-processing chain | tilt shift, outlines and bloom all need the finished picture, and the first two cannot be done any other way at this zoom range |
| 2026-09-20 | Twelve thousand people, not four | four thousand over nineteen hundred buildings is two each over nine floors, so an opened building was genuinely empty |
| 2026-09-20 | Buildings open one at a time on a click, rather than the whole town going transparent | owner's call: the transparency made a soup. A building with no front wall is a section drawing; a transparent one is a ghost |
| 2026-09-20 | The two walls facing the viewer are the ones left out | from overhead every floor slab hides the one below, so taking only the roof off shows the top storey and nothing else |
| ~~2026-09-20~~ | ~~Figures are drawn 2.4x life size under the x-ray~~ (reverted with the x-ray) | at true size the see-through view shows an empty shell, which defeats the only reason the mode exists |
| 2026-09-20 | Look: painted daylight (owner's third and current call) | the palettes have now been photographic once and painted twice. The structural work (roofs, density, crowd, shadows, haze, windows) is the same either way; only the palette tables and the sky keyframes change, and the photographic set is in the history if it is wanted back |
| 2026-09-20 | Only people you can see are drawn, and only they think out loud | somebody behind a wall is depth-tested away, so drawing them is work nobody sees: 4200 figures and 890k triangles hidden inside offices at street level. It also makes opening a building turn a sound on |
| 2026-09-20 | A workplace has a size | everyone walking to the workplace nearest their own home emptied the centre of town and put 210 people in one shed, because homes are all in the outskirts |
| 2026-09-20 | A thought pill carries a tail, and a thread when it is lifted | the owner's complaint was that thoughts do not follow people. A pill floating near a crowd belongs to nobody in particular unless something points at the one person it came from |
| 2026-09-20 | A person is about 180 triangles, not 60 | owner's call, on the strength of the phone being fast. The old figure was sized for the roof band; the camera comes down to 12 m |
| 2026-09-20 | Reverted: a person is about 60 triangles after all; the triangles go to the city | owner's correction. A crowd reads as a crowd from its density; a building is looked at one at a time |
| 2026-09-20 | A building has depth on its face: balconies, pilasters, a shopfront band | the whole built city was 90k triangles, fifty a building. It read as a bar chart from above and as cardboard from the street |
| 2026-09-20 | The fine detail is never switched off by altitude | the saving is 144k triangles and two draw calls, which is not worth a band to pop across. The pop itself measured 1.97%, which is nothing |
| 2026-09-20 | The citadel's roofs get the triangles | owner's call: they are what the place is for. 198 triangles a roof, 300k in the town, and still one draw call because every roof is the same geometry scaled |
| 2026-09-20 | The Hue eave is its own structure kind, not a better gable | the same sweep on a 2020 suburban house is fancy dress. 2020 and 2300 keep the plain gable |
| 2026-09-20 | Hand-built geometry gets a test that checks its normals | all four barge ridges shipped wound face down and the render only looked slightly flat. A downward triangle still draws |
| 2026-09-20 | The day opens at the viewer's own clock | the piece is about watching a town live out a day. Starting that day at the hour it actually is where the viewer sits is what ties the two together |
| 2026-09-20 | Every era has the same population | 12,000 in 2020 against 8,000 in 1800 emptied the streets on a change of era, which reads as the simulation faltering rather than as a different century |
| 2026-09-20 | Thoughts are picked from around the camera, not around its look-at point | the camera looks down at a slant, so a ring drawn around the target reaches past the people in front of the viewer and picks up the ones behind them |
| 2026-09-20 | 1500 Fields and 1930 Colonial are given up for one fantasy world | owner's call. Four finished places beat five with two dark stops, which is the same call that made the settlements smaller and more detailed |
| 2026-09-20 | Wyrmrest is western high fantasy, and sits before all the others | owner's call on all four questions: the flavour, the placement, all three kinds of monster with heroes fighting them, and one world rather than two |
| 2026-09-20 | The magic is in the nouns, the same rule every era follows | nobody is awed by the world they grew up in. A dragon under the hill is local geography, and the people are still thinking about the rent |
| 2026-09-20 | The dragon is landscape, not an agent, and is never pointed at | a monster you are told about is set dressing; one you work out for yourself from a ridge you had stopped looking at is what the place is named after |
| 2026-09-20 | A fight has no health, no damage and no winner | the piece is not a game. Two shapes closing, striking, and one going home reads as a fight; anything more exists only in numbers nobody is shown |
| 2026-09-23 | Thoughts are chosen by place, kind of person and time of day, over a shared human core | owner asked for a much larger bag of thoughts. Keying by place alone gave a student and a grandmother the same forty lines |
| 2026-09-23 | The mountain ring became a valley: near peaks are shoulders, foothills between, woods on the hills | the range stood up as a wall round the town. Height is saved for the peaks behind; the owner asked for the city to be truly beautiful and this was the largest thing in the frame from above |
| 2026-09-23 | Roads carry markings, and a mark thinner than a pixel is drawn a pixel wide and faint | a 15 cm line at 520 m crawls as the camera moves; widened and faded it holds still and still reads |
| 2026-09-23 | Parks are laid out, and the plan comes from the lot rather than a random stream | a bare block with trees on it reads as a lot waiting for a building; the trees have to be able to ask where the paths are |
| 2026-09-23 | Anything nearer the camera than 38 percent of its altitude is cut away | in 2300 the camera could come down inside or against a tower and see one flat wall. The look-at point is never cut |
| 2026-09-23 | A town is planned district by district, not cut from one grid | owner's call: "too round and organised", "more diversity urban planning". One plan module serves every era; an era says what its core, its main roads and its kinds of district are |
| 2026-09-23 | Lots stand along the streets and are turned to face them | a lot cut from a square block only works while every block is a square on one grid; the new streets run at every angle and curve |
| 2026-09-23 | The grid builders are removed | nothing draws them any more. The tests that walked people round the grid now walk them round a planned town |
| 2026-09-23 | The hills cast no shadow | the shadow map covers 520 m round the look-at point and the hills are almost never in it; nothing is culled, so casting cost 86k triangles a frame for nothing |
| 2026-09-24 | A day on foot: one ordinary day per era, walked at eye level, with two-reply choices | owner's call: a first-person mode with "a very interesting story rather than just walking around". Soft aims only, no fail state, score, timer or typing, and it ends by rising back into the sky, so altitude still carries the meaning |
| 2026-09-24 | The flat layers are a few centimetres apart, not half a metre | at eye level a pavement 0.5 m up stood people in it to the knee. The camera stops at 2.6 km and the near plane grows with altitude, so 4 to 8 cm is enough from above |
| 2026-09-24 | The places of a day are cast by role from the seed's town | a day written against coordinates breaks with every seed and with every change to the planner |
| 2026-09-24 | The way is shown by the gold light alone, and its echo on the edge of the glass | it is the soul's light (step 7). A light that goes ahead and waits gives a direction without an arrow or a map |
| 2026-09-24 | 2300 is a low garden town, not a town of slender towers | owner's call from photographs of modern Japanese gardens: "Low garden city". Then: the landscape first, a variety of buildings, creative, and elegant |
| 2026-09-24 | Lakes in the town, the lanes stopping at the water | owner asked "why don't we have lakes inside the city?" |
| 2026-09-24 | Mist lies only over water, in low wisps that thin from the air | a sheet over the whole town was a halo round the camera; one sheet over a lake 4 m up was milk from above, pink at dusk, and from the bank above the eye and invisible |
| 2026-09-24 | A day's park is met at its road edge, and nobody in the crowd stands in a pond | the middle of a 2300 park is water now; a spot taken from the middle put people in it |
| 2026-09-25 | The heart of 2300 is a great hall on a pond, not a ring | owner asked for something "massive but elegant and beautiful that blends well with the style". The white ring was massive and read from the air as a stadium, the one bright hard-edged thing in a town of dark roofs, timber and moss |
| 2026-09-25 | Still water mirrors the far bank as well as the sky | mirroring the sky alone made a still lake a pale floor; from its bank most of a lake shows the trees across it upside down |
| 2026-09-25 | Trees are drawn in full near the eye and plainly past it, their crowns leaf cards round dark cores | owner asked for realistic trees. The split keeps the view from above at about its old cost; a dither shares the band between the two |

## 10. Open questions (decide before the milestone that needs them)

- M1: river or coast, or let the seed choose? **Settled: the seed chooses, roughly half and half.** A river gets up to three bridges; a coast takes a bite out of one side.
- M4: procedural murmur (cheaper, no files) versus recorded loops (richer)? Start procedural; add files only if it sounds thin.
- M5: should the era dial be continuous (cross-fade any two neighbours at any ratio) or five discrete stops? Plan says discrete stops with a 3 s transition; continuous is a possible later upgrade.
- M6: should a soul ever land on a vehicle driver? (No, for now.)
- **Open bug, low severity.** three warns `BufferGeometry.computeBoundingSphere(): Computed radius is NaN` on some frames, intermittently, at altitudes around 1400 m. Nothing renders wrong. Ruled out so far: every static geometry (ground, water ribbon, structures including the new gable and tank, buildings, roads, props) checked position by position for a non-finite value, and both crowd point clouds driven through 900 frames at four altitudes. Next place to look is a geometry three builds for itself, or a mesh whose instance count reaches zero in a frame.

## 11. Glossary

- **Altitude**: camera height above ground in metres; the main input to everything.
- **Band**: one of five altitude ranges (street, roof, mountain, cloud, satellite).
- **Era**: one of five layouts of the same land.
- **Lot**: a plot of land inside a block with one use (home, work, market, temple, park, water).
- **Agent**: a person or vehicle in the typed-array pool.
- **Soul**: the small light that moves between lives when the viewer follows someone.
- **Vantage**: a preset camera position (roof, mountain, cloud, satellite).
