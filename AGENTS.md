# Instructions for coding agents

Zenith is a collection of small, quiet web apps in one repo, deployed together as one GitHub Pages site. Each app lives in its own folder under `apps/` and is its own Vite project and npm workspace. You will almost always be working inside one app.

## Before you change anything

1. Find the app the task is about: `apps/<name>/`.
2. Read that app's `AGENTS.md` and `docs/PLAN.md` in full. They are the source of truth for that app: its idea, its rules and its budgets. Paths in them are relative to the app's folder.
3. Change files inside that app only, unless the task is about the collection itself (the chooser, the build, the deploy).

## Where things are

- `home/`: the chooser, served at the site root. It lists the apps in `home/apps.json`, with one still each in `home/public/stills/`.
- `apps/<name>/`: one app, served at `<base><name>/`.
- `scripts/build.mjs`: builds the chooser and every app and lays them out in `dist/` as the site serves them. It stops if an app on the chooser did not build or has no still.
- `scripts/preview.mjs`: serves `dist/` locally.
- `.github/workflows/deploy.yml`: builds and deploys on every push to `main`.

## Rules for the whole collection

1. **Static only.** No backend, accounts, analytics, or network calls at run time except the site's own files. GitHub Pages is the only host.
2. **One set of tools.** TypeScript (strict), Vite, Vitest and Playwright are declared once in the root `package.json`, so every app uses the same versions. An app adds its own runtime dependencies (Above uses three) in its own `package.json`, with the reason written in the PR.
3. **Apps do not import from each other.** If two apps need the same code, move it into `packages/<name>/` as its own workspace first. Nothing is shared yet.
4. **Never hard-code the base path.** An app is served at `ZENITH_BASE` plus its folder name. Use `import.meta.env.BASE_URL` in code; `vite.config.ts` works the base out.
5. **The chooser lists finished apps only.** An unfinished app is built and deployed at its own address, but it gets no card in `home/apps.json` until it works on a phone and on a desktop.
6. **The chooser stays quiet.** A still, a name and one plain line per app. No text about calm, no tips, no counters, no "new" badges.
7. **Pure logic first**, in every app: a decision that is plain data in and plain data out lives in a function with no DOM or three.js imports, with a Vitest test beside it.

## Commands (from the repo root)

```
npm install          # once; installs every workspace
npm run dev:above    # one app in dev: http://localhost:5173/zenith/above/
npm run dev:home     # the chooser in dev: http://localhost:5172/zenith/ (its links need a build)
npm run typecheck    # every workspace
npm test             # every workspace
npm run build        # everything into dist/; prints each app's gzipped sizes
npm run preview      # dist/ as the site serves it: http://localhost:4173/zenith/
npm run smoke        # every app's headless render check
```

Inside `apps/<name>/`, the app's own `npm run dev`, `npm test`, `npm run build` and `npm run smoke` work as before. One app's scripts also run from the root with `-w @zenith/<name>`.

## Changes to the collection itself

Use a branch named `collection/<short-task>` and commit as `feat(collection): ...` or `fix(collection): ...`. Before you claim done, run `npm run typecheck`, `npm test` and `npm run build` from the root, then click through the result with `npm run preview`.
