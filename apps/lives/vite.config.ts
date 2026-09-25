import { defineConfig } from 'vite';
import { basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Served at <base>lives/ inside the Zenith site, like every app in apps/: the
// base is the collection's base plus this folder's name (scripts/build.mjs at
// the repo root lays the apps out). The deploy workflow sets ZENITH_BASE.
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
    chunkSizeWarningLimit: 1500,
  },
  // Above has 5173 and the chooser 5172, so all three can run side by side.
  server: { port: 5174, open: false },
});
