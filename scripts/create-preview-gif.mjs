import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';

const outputDirectory = resolve('.tmp/pr-previews');
const FRAME_RATE = 12;
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

function recordingFiles() {
  if (!existsSync(outputDirectory)) throw new Error(`Missing PR preview directory: ${outputDirectory}`);
  return readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.webm')
    .map((entry) => join(outputDirectory, entry.name))
    .sort();
}

function outputWidth(name) {
  return name.endsWith('-mobile') ? MOBILE_WIDTH : DESKTOP_WIDTH;
}

function generateGif(ffmpeg, recording) {
  const name = basename(recording, extname(recording));
  const output = join(outputDirectory, `${name}.gif`);
  const width = outputWidth(name);
  const filter = [
    `fps=${FRAME_RATE}`,
    `scale=${width}:-2:flags=lanczos`,
    'split[base][paletteSource]',
    '[paletteSource]palettegen=max_colors=256:stats_mode=full[palette]',
    '[base][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
  ].join(';');
  const result = spawnSync(ffmpeg, [
    '-y',
    '-i', recording,
    '-vf', filter,
    '-loop', '0',
    output,
  ], { cwd: process.cwd(), stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(`Generated ${output} from the complete viewport recording ${recording}.\n`);
}

mkdirSync(outputDirectory, { recursive: true });
const recordings = recordingFiles();
if (!recordings.length) throw new Error(`No WebM viewport recordings found in ${outputDirectory}.`);
const ffmpeg = cacheRoots().map(findFfmpeg).find(Boolean);
if (!ffmpeg) throw new Error('Playwright FFmpeg was not found. Run the responsive browser capture after Playwright has installed FFmpeg.');
if (!statSync(ffmpeg).isFile()) throw new Error(`Invalid FFmpeg path: ${ffmpeg}`);
for (const recording of recordings) generateGif(ffmpeg, recording);
