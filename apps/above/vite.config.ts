import { defineConfig } from 'vite';
import { basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Zenith is one GitHub Pages site holding several apps. The chooser sits at
// the base, https://<user>.github.io/<repo>/, and each app in a folder under
// it named after its own folder in apps/, so this one is served at
// <base>above/ (scripts/build.mjs at the repo root lays them out). The deploy
// workflow sets ZENITH_BASE from the repository name; set it to '/' for a
// custom domain.
const slug = basename(fileURLToPath(new URL('.', import.meta.url)));
const base = `${process.env.ZENITH_BASE ?? '/zenith/'}${slug}/`;

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500, // three.js is large; one big vendor chunk is fine here
  },
  server: { port: 5173, open: false },
});
