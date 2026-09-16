import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PLAYWRIGHT_VERSION = '1.60.0';
const PLAYWRIGHT_PACKAGE = `@playwright/test@${PLAYWRIGHT_VERSION}`;
const GIF_MUXER_PATTERN = /^\s*[D ]?E\s+gif\b/im;
const packageManager = String(JSON.parse(readFileSync('package.json', 'utf8')).packageManager ?? '');
if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) {
  throw new Error('package.json must pin an exact pnpm packageManager version.');
}
const playwrightArguments = process.argv.slice(2);
const prepareOnly = process.env.PLAYWRIGHT_PREPARE_ONLY === '1';
const runtimePrepared = process.env.PLAYWRIGHT_RUNTIME_PREPARED === '1';
const videoDisabled = process.env.PLAYWRIGHT_DISABLE_VIDEO === '1';
const runsRankedLiveSuite = playwrightArguments.some((argument) => argument.includes('@live-ranked-anti-cheat'));
if (!runsRankedLiveSuite && process.env.SUPABASE_RANKED_ANTICHEAT_LIVE !== '1') {
  playwrightArguments.push('--grep-invert=@live-ranked-anti-cheat');
}

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

let pnpmInvocation = null;

function resolvePnpmInvocation() {
  if (pnpmInvocation) return pnpmInvocation;
  const direct = spawnSync('pnpm', ['--version'], { stdio: 'ignore' });
  pnpmInvocation = direct.error
    ? Object.freeze({ command: 'npx', prefix: ['--yes', packageManager] })
    : Object.freeze({ command: 'pnpm', prefix: [] });
  return pnpmInvocation;
}

function runPnpm(arguments_, options = {}) {
  const invocation = resolvePnpmInvocation();
  return runCommand(invocation.command, [...invocation.prefix, ...arguments_], options);
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
  return GIF_MUXER_PATTERN.test(formats)
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

if (!runtimePrepared) runPnpm(['dlx', PLAYWRIGHT_PACKAGE, '--version']);
const packageJsonPath = cacheRoots().map(findPackageJson).find(Boolean);
if (!packageJsonPath) throw new Error(`Unable to locate ${PLAYWRIGHT_PACKAGE} in the pnpm dlx cache.`);

if (!runtimePrepared && !videoDisabled) {
  runPnpm(['dlx', PLAYWRIGHT_PACKAGE, 'install', 'ffmpeg']);
}
if (prepareOnly) process.exit(0);

runPnpm(['dlx', PLAYWRIGHT_PACKAGE, 'test', ...playwrightArguments], {
  env: {
    ...process.env,
    PLAYWRIGHT_TEST_PATH: dirname(packageJsonPath),
  },
});

if (process.env.PR_VISUAL_CAPTURE === '1' && process.env.PLATFORM_EVIDENCE_FRAGMENT !== '1') {
  ensureGifCapableFfmpeg();
  runNodeScript('scripts/create-preview-gif.mjs');
  runNodeScript('scripts/package-platform-evidence.mjs');
}
