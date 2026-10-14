// Headless render smoke test. Builds are verified by screenshots, not by eye.
// Usage: npm run build && npm run smoke   (first time: npx playwright install chromium)
// Opens the film at one held moment, writes docs/screenshots/smoke.png, and
// prints the debug line and any console errors. Fails (exit 1) on a page error
// or if the film never gets ready.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4174;
// The app is served under the collection's base, in a folder named after its own.
const SLUG = basename(fileURLToPath(new URL('..', import.meta.url)));
const BASE = `${process.env.ZENITH_BASE ?? '/zenith/'}${SLUG}/`;
const MOMENT = process.env.MOMENT ?? '20';
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
await sleep(2500);

let exitCode = 0;
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`[error] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${PORT}${BASE}?t=${MOMENT}&pause=1&debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready !== undefined, null, { timeout: 120000 });
  await sleep(4000);
  const ready = await page.evaluate(() => document.body.dataset.ready);
  const hud = (await page.textContent('#hud')) ?? '';
  await page.screenshot({ path: 'docs/screenshots/smoke.png', timeout: 120000 });
  console.log(`ready: ${ready}\n${hud}`);
  console.log(logs.join('\n'));
  if (ready !== '1' || logs.some((l) => l.startsWith('[pageerror]'))) exitCode = 1;
  await browser.close();
} finally {
  preview.kill();
}
process.exit(exitCode);
