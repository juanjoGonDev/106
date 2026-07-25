import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

const frameRoot = resolve('.tmp/pr-previews/frames');
const outputDirectory = resolve('.tmp/pr-previews');
const FRAME_RATE = 6;
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 720;

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

function frameDirectories() {
  if (!existsSync(frameRoot)) throw new Error(`Missing GIF frame root: ${frameRoot}`);
  return readdirSync(frameRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(frameRoot, entry.name))
    .sort();
}

function frameNames(directory) {
  return readdirSync(directory).filter((name) => name.endsWith('.png')).sort();
}

function outputWidth(name) {
  return name.endsWith('-mobile') ? MOBILE_WIDTH : DESKTOP_WIDTH;
}

function generateGif(ffmpeg, directory) {
  const name = basename(directory);
  const frames = frameNames(directory);
  if (frames.length < 2) throw new Error(`${name}: at least two PNG frames are required; found ${frames.length}.`);
  const output = join(outputDirectory, `${name}.gif`);
  const width = outputWidth(name);
  const filter = [
    `scale=${width}:-2:flags=lanczos`,
    'split[base][paletteSource]',
    '[paletteSource]palettegen=max_colors=256:stats_mode=full[palette]',
    '[base][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
  ].join(';');
  const result = spawnSync(ffmpeg, [
    '-y',
    '-framerate', String(FRAME_RATE),
    '-pattern_type', 'glob',
    '-i', join(directory, '*.png'),
    '-vf', filter,
    '-loop', '0',
    output,
  ], { cwd: process.cwd(), stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(`Generated ${output} from ${frames.length} complete viewport frames.\n`);
}

const directories = frameDirectories();
if (!directories.length) throw new Error(`No GIF frame directories found in ${frameRoot}.`);
const ffmpeg = cacheRoots().map(findFfmpeg).find(Boolean);
if (!ffmpeg) throw new Error('Playwright FFmpeg was not found. Run the responsive browser capture after Playwright has installed FFmpeg.');
if (!statSync(ffmpeg).isFile()) throw new Error(`Invalid FFmpeg path: ${ffmpeg}`);
mkdirSync(dirname(join(outputDirectory, 'placeholder')), { recursive: true });
for (const directory of directories) generateGif(ffmpeg, directory);
