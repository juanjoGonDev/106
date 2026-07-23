import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const frameDirectory = resolve('.tmp/pr-previews/frames/player-tabs-desktop');
const output = resolve('.tmp/pr-previews/player-tabs-desktop.gif');

function cacheRoots() {
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'ms-playwright') : '',
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter((value, index, values) => value && values.indexOf(value) === index && existsSync(value));
}

function findFfmpeg(root) {
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
      if (!entry.isFile() || !/^ffmpeg(?:-|\.exe$|$)/i.test(entry.name)) continue;
      return path;
    }
  }
  return null;
}

if (!existsSync(frameDirectory)) throw new Error(`Missing GIF frame directory: ${frameDirectory}`);
const frames = readdirSync(frameDirectory).filter((name) => name.endsWith('.png')).sort();
if (frames.length < 2) throw new Error(`At least two PNG frames are required; found ${frames.length}.`);
const ffmpeg = cacheRoots().map(findFfmpeg).find(Boolean);
if (!ffmpeg) throw new Error('Playwright FFmpeg was not found. Run pnpm preview:pr:gif after pnpm test:e2e has installed it.');
if (!statSync(ffmpeg).isFile()) throw new Error(`Invalid FFmpeg path: ${ffmpeg}`);

mkdirSync(dirname(output), { recursive: true });
const result = spawnSync(ffmpeg, [
  '-y',
  '-framerate', '2',
  '-pattern_type', 'glob',
  '-i', join(frameDirectory, '*.png'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
  '-loop', '0',
  output,
], { cwd: process.cwd(), stdio: 'inherit' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(`Generated ${output} from ${frames.length} frames.\n`);
