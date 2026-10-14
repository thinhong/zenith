// Serves dist/ the way GitHub Pages will: the chooser at the base and each app
// in its own folder under it. Run `npm run build` first.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('preview: dist/ is empty. Run `npm run build` first.');
  process.exit(1);
}

const server = await preview({
  root,
  configFile: false,
  base: process.env.ZENITH_BASE ?? '/zenith/',
  // Several pages, no single-page fallback: an address that does not exist is
  // a 404, as it is on the real site, not a quiet copy of the chooser.
  appType: 'mpa',
  build: { outDir: 'dist' },
  preview: { port: 4173, strictPort: true, open: false },
});
server.printUrls();
