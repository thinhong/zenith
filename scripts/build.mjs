// Builds the chooser and every app, then lays them out in dist/ the way the
// site serves them: the chooser at the base, and each app in a folder named
// after its own folder under apps/. The deploy workflow uploads dist/ as it is.
// ZENITH_BASE (default /zenith/) reaches every build through the environment.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (...parts) => join(root, ...parts);

const base = process.env.ZENITH_BASE ?? '/zenith/';
// Each app appends its own folder name to the base, so a base without its
// slashes would give /zenithabove/.
if (!base.startsWith('/') || !base.endsWith('/')) fail(`ZENITH_BASE must start and end with "/", not "${base}"`);

const apps = readdirSync(at('apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(at('apps', entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

build('home');
for (const slug of apps) build(join('apps', slug));

rmSync(at('dist'), { recursive: true, force: true });
cpSync(at('home', 'dist'), at('dist'), { recursive: true });
for (const slug of apps) {
  // An app with the same name as one of the chooser's own folders would be
  // written over it.
  if (existsSync(at('dist', slug))) fail(`apps/${slug} has the same name as dist/${slug} from the chooser`);
  cpSync(at('apps', slug, 'dist'), at('dist', slug), { recursive: true });
}

// Every app on the chooser must be there, or its card leads nowhere.
const listed = JSON.parse(readFileSync(at('home', 'apps.json'), 'utf8'));
for (const app of listed) {
  if (!existsSync(at('dist', app.slug, 'index.html'))) {
    fail(`home/apps.json lists "${app.slug}", but there is no apps/${app.slug} that built`);
  }
  if (!existsSync(at('dist', 'stills', app.still))) {
    fail(`home/apps.json wants the still "${app.still}", which is not in home/public/stills/`);
  }
}

const unlisted = apps.filter((slug) => !listed.some((app) => app.slug === slug));
console.log(
  `\ndist/ holds the chooser at ${base} and ${apps.length} app(s): ${apps.join(', ')}.` +
    (unlisted.length > 0 ? ` Built but not on the chooser yet: ${unlisted.join(', ')}.` : ''),
);

function build(dir) {
  const { name } = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf8'));
  console.log(`\n--- ${name} (${dir})`);
  execSync(`npm run build -w ${name}`, { cwd: root, stdio: 'inherit' });
}

function fail(message) {
  console.error(`\nbuild: ${message}`);
  process.exit(1);
}
