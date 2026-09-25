# Lives: plan

Status: v1, 25 September 2026. A first test, built to answer one question: can a browser show a character moving, ageing and changing through a life, the way an anime or an animated film does? Not on the chooser yet. Owner: Thinh. Every path in this file is relative to `apps/lives/`.

## 1. What Lives is

Lives watches one person's life from beginning to end in about eighty seconds, in one room, like the life montage of an animated film. A child stands at a window in spring. She grows up, sits at her desk, and looks up at the window. Days and seasons race past it while her hair turns silver. The same close-up, fifty years on. She crosses to the armchair in the evening light, and her eyes close. A small light rises from her, crosses the room, and leaves by the window. Morning comes to the empty room, and the next life begins there.

The point is the owner's: a life is not something to take too seriously, and it is not the only one. Above shows this in space, by height: from far enough up, the worries are too small to read. Lives shows it in time, by speed: fast enough, a life is a short arc and the next one begins. The small gold light is the same one that leads the way in Above.

### 1.1 Principles

1. **Show, do not tell.** No captions, no dates, no words about death or rebirth.
2. **Tender, not contemptuous.** A life passing quickly is not a life that did not matter. Small moments get their screen time.
3. **The grammar of the life montage.** The same room across the years, the same framing used twice so the cut between them is the passing of time, the window as a calendar.
4. **Limited animation.** A held pose, a blink, a turn of the head and a change of light carry most of the feeling, the way TV anime does it. This keeps the number of motions small.
5. **Static.** Like every app in Zenith: no backend, nothing loaded from elsewhere.

## 2. The test, shot by shot

The film is data in `src/film/script.ts`; the director only plays it.

| # | Shot | Seconds | Age | What happens |
|---|---|---|---|---|
| 1 | child | 8 | 7 | Spring morning. Hands on the sill, she watches the blossom, then turns round and smiles. |
| 2 | grown | 8 | 19 | Cut. She crosses the room and sits down at her desk. |
| 3 | young | 6 | 19 | Close, lit by the window: she looks up from her work and smiles. |
| 4 | years | 16 | 20 to 71 | Time-lapse: ten days and five years; the sun's patch sweeps the floor, the lamp comes on each night, the tree grows and turns, her hair goes silver. |
| 5 | old | 6 | 72 | The same close-up as 3: glasses, silver hair, the same look up. |
| 6 | across | 10 | 72 | Golden hour. She stands, slowly, and crosses to the armchair. |
| 7 | rest | 9 | 72 | Sunset on her face; the window's shadow on the wall; her eyes close. |
| 8 | light | 4.5 | | A small light rises from her. |
| 9 | leave | 7 | | It crosses the room and leaves by the window. Fade. |
| 10 | dawn | 7 | | The empty room at dawn, blossom again. Then the next life, in new colours. |

How age shows (`src/life/age.ts`): a child is the model at 0.62 of its size with a larger head; hair greys from 48 to 74; glasses from 55; the back and neck bend from 62; the walk and the blink slow from 58. How time shows (`src/life/sky.ts`): the sun crosses behind the window from left to right, and the tree outside blossoms, greens, turns and goes bare. Each loop of the film is a new life: the same model with other hair and clothes (`src/life/lives.ts`).

## 3. How it is built

| Part | Choice |
|---|---|
| Renderer | three.js `WebGPURenderer`, falling back to WebGL2 by itself, as in Above. |
| The person | One anime model in the VRM format (`docs/CREDITS.md`), loaded with `@pixiv/three-vrm`, drawn with its toon material `MToonNodeMaterial`. Expressions (smile, relaxed, blink), eyes that follow a target, and spring-bone hair come with the format. |
| Motion | Written by hand as rotations of the model's normalised bones (`character/poses.ts`: stand, walk, sit), blended, plus two-bone reach for hands that must land somewhere (`character/ik.ts`: the sill, the desk, the lap). |
| The room | Built from boxes in code (`room/`): floorboards, a window with curtains, a desk, a chair, an armchair, a shelf, a clock, a plant. Outside: a sky dome, a tree, far hills, and petals, leaves or snow falling. |
| Light | A sun through the window with shadows, so its patch moves across the room; a sky fill; a desk lamp at night; a faint sunbeam with dust in it. |
| The picture | Depth of field (close-ups blur what is behind her), bloom, a grade warm at sunset and cool at night, vignette, grain, and fades through black (`core/post.ts`). A 2:1 frame. |

### 3.1 Module map

```
src/
  main.ts                bootstrap, loop, keys, capture mode
  core/renderer.ts       WebGPURenderer, shadows, tone mapping
  core/post.ts           depth of field, bloom, grade, vignette, grain, fade
  film/ease.ts           pure: small maths, seeded random
  film/timeline.ts       pure: which shot, how far in, which life, how dark
  film/stage.ts          pure: the room's places and seats; where she is (stand, walk, turn, sit down, stand up); face and gaze keys
  film/script.ts         data: the ten shots
  film/director.ts       plays the film: camera, body, hands, gaze, light, picture
  life/age.ts            pure: how she looks at an age
  life/sky.ts            pure: the light of the hour, the colour of the season
  life/lives.ts          pure: each life's hair and clothes
  character/poses.ts     pure: stand, walk and sit, written as bone rotations
  character/ik.ts        three.js: two-bone reach for the hands
  character/actor.ts     three.js: the VRM model; pose, gaze, face, age, hair colour, glasses, wind
  room/                  three.js: the room, the furniture, what is outside
  soul/path.ts           pure: the light's path from her chest out of the window
  soul/light.ts          three.js: how the light looks
  state/settings.ts      pure: settings from the address
```

## 4. What the test showed

- **It works in a browser.** An anime character with toon shading, expressions and moving hair, in a lit room, in a film grammar, loads in a few seconds from static files. The JavaScript is about 330 kB gzipped; the model is 10.8 MB and the largest thing by far.
- **The emotional beats read.** The match cut between shots 3 and 5, the window as a calendar, the sunset and the light leaving did not need a single word.
- **One model cannot play a whole life well.** A scaled adult is not a child, and grey hair and glasses are only the start of old age: the face does not change.
- **Hand-written motion is stiff.** The walk and the sitting down read, but next to motion capture they are wooden. It is enough for limited animation and not for more.
- **Not tried yet:** two people together (a hug, carrying a baby), speech, sound, a phone.

Four stills of the test are in `docs/screenshots/`: the child at the window, the time-lapse at night, the old close-up, and the light leaving.

## 5. Decisions for the owner

1. **The cast.** Make a few people in VRoid Studio, each at three or four ages (child, young, middle, old), rather than one model aged by tricks. Keep VRoid's condition in mind: characters you make are yours to use, but an app may not generate new models by combining or reshaping VRoid parts without a separate agreement, so the variety should come from a cast of finished models.
2. **Motion.** Mixamo's free library (an Adobe account is needed to download) retargets onto VRM with three-vrm's own example, and would replace most of `poses.ts`. Contact between two people still needs work in Blender.
3. **Sound.** A life montage leans on its music. None yet; Above's sound milestone (M4) is still open too.
4. **Above's souls (M6).** Above plans the same idea at a small scale: follow a light from one life to the next. Decide which app owns it.
5. **Beyond one room.** Other places and Above's four eras as the settings of other lives.
6. **The phone.** Not checked. Two or three characters in a small set should hold 30 fps on a mid-range phone; depth of field is the first thing to drop if not.

## 6. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-09-25 | Lives is 3D with anime characters, not 2D | Owner's call: "I want to see the character in an environment with all the motions and changes like in anime and movies" |
| 2026-09-25 | three.js and VRM, in the Zenith repo, rather than a game engine or video | keeps the web, the phone, the coding agents' workflow and the reuse of Above; a video would show the same life every time |
| 2026-09-25 | One room, ten shots, about eighty seconds, as a first test | the life montage of animated film is the grammar the idea needs, and one room is enough to test it |
| 2026-09-25 | Motion written by hand for the test | the asset sites for free motion were out of reach from the build environment; Mixamo is the next step (section 5) |
| 2026-09-25 | Each loop is the next life, told by colour | one model in the test; a cast is decision 1 |
