// Headless render smoke test. Builds are verified by screenshots, not by eye.
// Usage: npm run build && npm run smoke   (needs: npm i -D playwright && npx playwright install chromium)
// Writes docs/screenshots/smoke.png and prints the HUD text + console messages.
// Fails (exit 1) on any page error or if the HUD never reports a backend.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4173;
const BASE = process.env.ZENITH_BASE ?? '/zenith/';
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await sleep(2500);

let exitCode = 0;
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' });
  await sleep(3000);
  await page.keyboard.press('h');
  await sleep(500);
  const hud = (await page.textContent('#hud')) ?? '';
  await page.screenshot({ path: 'docs/screenshots/smoke.png' });
  console.log(hud);
  console.log(logs.join('\n'));
  if (!/backend: (webgpu|webgl2)/.test(hud) || logs.some((l) => l.startsWith('[pageerror]'))) exitCode = 1;
  await browser.close();
} finally {
  preview.kill();
}
process.exit(exitCode);
