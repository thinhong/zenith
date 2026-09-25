import { defineConfig } from 'vite';

// The chooser is served at the base of the site itself,
// https://<user>.github.io/<repo>/, with each app in a folder under it
// (scripts/build.mjs at the repo root lays them out). The deploy workflow sets
// ZENITH_BASE from the repository name; set it to '/' for a custom domain.
export default defineConfig({
  base: process.env.ZENITH_BASE ?? '/zenith/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  // Above's dev server has 5173, so the two can run side by side.
  server: { port: 5172, open: false },
});
