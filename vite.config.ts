import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves a project site at https://<user>.github.io/<repo>/
// so every asset URL must start with /<repo>/. The deploy workflow sets
// ZENITH_BASE from the repository name; set it to '/' for a custom domain.
const base = process.env.ZENITH_BASE ?? '/zenith/';

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
