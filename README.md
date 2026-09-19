# Zenith

A small browser world you look down on from a high place. Scroll to descend from satellite height to the street. From above there are only patterns; close up there are tiny people with tiny worries. The same land can be seen in five eras. No goals, no score.

Built with three.js (WebGPU with WebGL2 fallback), TypeScript, and Vite. Hosted on GitHub Pages.

## Run it

```
npm install
npm run dev        # open http://localhost:5173/zenith/
```

Press **H** for the debug overlay. Scroll or pinch to change altitude; drag to orbit.

## Build and deploy

Pushing to `main` builds and deploys the site through `.github/workflows/deploy.yml`. One-time setup on GitHub: repository Settings, Pages, set Source to "GitHub Actions". The site appears at `https://<user>.github.io/zenith/`.

## Plan and rules

- `docs/PLAN.md`: vision, architecture, milestones, budgets, content rules.
- `AGENTS.md`: working rules for coding agents (also loaded by Claude Code via `CLAUDE.md`).
