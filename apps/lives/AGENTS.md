# Instructions for coding agents: Lives

You are working on Lives, the second app of Zenith: one person's life from beginning to end, watched like the life montage of an animated film, in one room. It is a first test (25 September 2026), built to find out whether a browser can show a character moving, ageing and changing like this. Read the repo root's `AGENTS.md` for how the collection fits together, then `docs/PLAN.md` here. Every path below is relative to `apps/lives/`.

## Working rules

1. **The film is data.** Shots, ages, hours, seasons, where she walks and what she looks at live in `src/film/script.ts`. Change the film there, not in the director.
2. **Pure logic first.** `src/film/` (timeline, stage, ease, script), `src/life/` (age, sky, lives), `src/character/poses.ts`, `src/soul/path.ts` and `src/state/settings.ts` take plain numbers and return plain numbers, and each has a Vitest test beside it. three.js lives in thin files that call them: `character/actor.ts`, `character/ik.ts`, `room/`, `soul/light.ts`, `film/director.ts`, `core/`.
3. **The order inside a frame matters** (`film/director.ts`): pose the body, place the hands, turn the head, and only then call the model's update, which copies the pose to the skin. Anything done to the bones after that shows a frame late, or not at all.
4. **Units and directions.** Metres, seconds, radians. At yaw 0 the person faces +Z; in her own frame her left is +X. The window is in the back wall at -Z.
5. **Assets need a licence that allows a public site and a public repository**, and a row in `docs/CREDITS.md`. Nothing else is loaded from anywhere.
6. **No new dependencies without a reason in the PR.** Lives adds `@pixiv/three-vrm` to the collection's tools, for the VRM model.
7. **Show, do not tell.** No captions, no dates on screen, no words about death or rebirth. The film carries it.

## Commands

Run these inside `apps/lives/`, or from the repo root with `-w @zenith/lives` (and `npm run dev:lives`).

```
npm run dev          # http://localhost:5174/zenith/lives/
npm run typecheck
npm test
npm run build        # also type-checks; prints gzipped size
npm run smoke        # headless render of one held moment -> docs/screenshots/smoke.png
                     # MOMENT=66 npm run smoke to pick another second of the film
```

Address settings, for looking at one moment (`src/state/settings.ts`): `?t=31&pause=1` holds second 31; `?debug=1` shows the shot and the time; `?life=2` starts on the third life; `?view=x,y,z,lx,ly,lz,fov` puts the camera anywhere; `?capture=12` renders one frame per call of `window.lives.frame()` for recording, and `window.lives.seek(t)` jumps.

## Notes that cost time to find

- `vrm.update()` copies the normalised pose to the skinned bones. The head turn was first applied after it and never showed; only the eyes moved.
- In capture mode, render one step per animation frame. WebGPURenderer refreshes some state once per frame, so six renders in one task all showed the first one's lighting.
- Reset the hair's spring bones at every cut. The body jumps at a cut, and the hair flies for a second if it is not reset.
- `MToonNodeMaterial` takes `colorNode` and `shadeColorNode`; that is how the hair turns silver and changes colour between lives without touching the file.
- The glasses hang from the skinned head bone, placed once in the rest pose from the eye bones. Hung from the normalised head they did not show.
- In `@types/three`, `materialReference()` and the depth-of-field node have none of the swizzle methods. `uniform(material.shadeColorFactor).rgb` and a cast on `dof()` get round it.
- A standing person cannot reach a desk from a chair half a metre away: the hands go on the desk by two-bone reach (`character/ik.ts`), and the chair had to be pulled in.
- The cloud workspace this was built in could not reach opengameart.org, itch.io or quaternius.com. The model came from the three-vrm repository instead, and the motions are written by hand in `character/poses.ts`.
