import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PLAYWRIGHT_VERSION = '1.60.0';
const PLAYWRIGHT_PACKAGE = `@playwright/test@${PLAYWRIGHT_VERSION}`;

function runCommand(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  return result;
}

function runPnpm(arguments_, options = {}) {
  return runCommand('pnpm', arguments_, options);
}

function runNodeScript(path) {
  runCommand(process.execPath, [path]);
}

function commandOutput(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return '';
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function hasGifCapableFfmpeg() {
  const formats = commandOutput('ffmpeg', ['-hide_banner', '-formats']);
  const filters = commandOutput('ffmpeg', ['-hide_banner', '-filters']);
  return /\bE\s+gif\b/i.test(formats)
    && /\bpalettegen\b/i.test(filters)
    && /\bpaletteuse\b/i.test(filters);
}

function ensureGifCapableFfmpeg() {
  if (hasGifCapableFfmpeg()) return;
  const hostedLinux = process.platform === 'linux'
    && (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true');
  if (!hostedLinux) {
    throw new Error('Install a full FFmpeg build with GIF muxing and palettegen/paletteuse before running visual evidence capture.');
  }

  const environment = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  runCommand('sudo', ['apt-get', 'update', '-qq'], { env: environment });
  runCommand('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', 'ffmpeg'], { env: environment });
  if (!hasGifCapableFfmpeg()) {
    throw new Error('The CI FFmpeg installation does not provide GIF muxing and palettegen/paletteuse filters.');
  }
}

function cacheRoots() {
  const roots = [
    process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'pnpm', 'dlx') : '',
    join(homedir(), '.cache', 'pnpm', 'dlx'),
  ].filter(Boolean);
  return [...new Set(roots)].filter(existsSync);
}

function findPackageJson(root) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || entry.name !== 'package.json' || !path.includes(`${join('node_modules', '@playwright', 'test')}`)) continue;
      try {
        const packageJson = JSON.parse(readFileSync(path, 'utf8'));
        if (packageJson.name === '@playwright/test' && packageJson.version === PLAYWRIGHT_VERSION) return path;
      } catch {
        // Ignore unrelated or incomplete cache entries.
      }
    }
  }
  return null;
}

runPnpm(['dlx', PLAYWRIGHT_PACKAGE, '--version']);
const packageJsonPath = cacheRoots().map(findPackageJson).find(Boolean);
if (!packageJsonPath) throw new Error(`Unable to locate ${PLAYWRIGHT_PACKAGE} in the pnpm dlx cache.`);

runPnpm(['dlx', PLAYWRIGHT_PACKAGE, 'install', 'ffmpeg']);
runPnpm(['dlx', PLAYWRIGHT_PACKAGE, 'test'], {
  env: {
    ...process.env,
    PLAYWRIGHT_TEST_PATH: dirname(packageJsonPath),
  },
});

if (process.env.PR_VISUAL_CAPTURE === '1') {
  ensureGifCapableFfmpeg();
  runNodeScript('scripts/create-preview-gif.mjs');
}
