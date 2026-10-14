# Zenith

A small collection of quiet web apps for looking at life from outside it. There is nothing to win in any of them.

| App | What it is | Address |
|---|---|---|
| [Above](apps/above/) | A small town seen from far above, in four eras. Come down low enough and you can read their thoughts. | `/zenith/above/` |

The chooser at `https://<user>.github.io/zenith/` shows every finished app. Everything is TypeScript and Vite, hosted on GitHub Pages, with no backend.

## Run it

```
npm install            # once, at the root: installs every app
npm run dev:above      # Above in dev: http://localhost:5173/zenith/above/
npm run dev:lives      # Lives in dev: http://localhost:5174/zenith/lives/
npm run dev:home       # the chooser in dev: http://localhost:5172/zenith/
npm run build          # the chooser and every app, into dist/
npm run preview        # dist/ as the site serves it: http://localhost:4173/zenith/
npm test               # every app's tests
npm run typecheck      # every app
```

In dev, each app runs on its own server, so the chooser's cards lead nowhere. To click through the whole site, run `npm run build` and then `npm run preview`.

## Layout

```
home/              the chooser, served at the site root (/zenith/)
  apps.json        the apps it lists: folder name, name, one line, still
  public/stills/   one picture per app
apps/
  above/           the view from above, served at /zenith/above/
                   with its own plan (docs/PLAN.md) and rules (AGENTS.md)
  lives/           a life watched from beginning to end, served at /zenith/lives/
                   a first test, not on the chooser yet
scripts/
  build.mjs        builds everything and lays it out in dist/
  preview.mjs      serves dist/ locally
```

Each folder under `apps/` is its own Vite project and npm workspace, with its own tests and budgets. Apps do not import from each other.

## Adding an app

1. Make `apps/<name>/` with a `package.json` named `@zenith/<name>`, an `index.html`, a `vite.config.ts` and a `tsconfig.json`. Above's `vite.config.ts` works as it is, because the base path comes from the folder name.
2. Run `npm install` at the root, and add a `dev:<name>` script to the root `package.json`.
3. When the app is finished, add it to `home/apps.json`, with a still in `home/public/stills/`. Until then it is deployed at its own address but has no card.

## Deploy

Pushing to `main` builds everything and deploys `dist/` through `.github/workflows/deploy.yml`. One-time setup on GitHub: repository Settings, Pages, set Source to "GitHub Actions".

## Plan and rules

- `AGENTS.md`: how the collection fits together, for coding agents (also loaded by Claude Code via `CLAUDE.md`).
- `apps/<name>/docs/PLAN.md` and `apps/<name>/AGENTS.md`: each app's own plan and rules.
