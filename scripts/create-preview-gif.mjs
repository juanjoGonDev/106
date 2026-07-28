import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const outputDirectory = resolve('.tmp/pr-previews');
const FRAME_RATE = 12;
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 720;
const GIF_CLEAR_CODE = 256;
const GIF_END_CODE = 257;
const GIF_DICTIONARY_RESET_CODE = 511;
const GIF_CODE_SIZE = 9;

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
      if (entry.isFile() && /^ffmpeg(?:-|\.exe$|$)/i.test(entry.name)) return path;
    }
  }
  return null;
}

function commandOutput(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) return '';
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function resolveFfmpeg() {
  const candidates = [
    ...cacheRoots().map(findFfmpeg).filter(Boolean),
    'ffmpeg',
  ];
  const ffmpeg = candidates.find((candidate) => /ffmpeg version/i.test(commandOutput(candidate, ['-version'])));
  if (!ffmpeg) {
    throw new Error('Playwright FFmpeg is missing. Run the browser installation before generating GIF evidence.');
  }
  return ffmpeg;
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

function sourceDimensions(ffmpeg, recording) {
  const output = commandOutput(ffmpeg, ['-hide_banner', '-i', recording]);
  const match = output.match(/Stream[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  if (!match) throw new Error(`Unable to read video dimensions from ${recording}.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function targetDimensions(ffmpeg, recording, name) {
  const source = sourceDimensions(ffmpeg, recording);
  const width = outputWidth(name);
  const scaledHeight = Math.max(2, Math.round(source.height * width / source.width));
  const height = scaledHeight % 2 === 0 ? scaledHeight : scaledHeight + 1;
  return { width, height };
}

function littleEndian16(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff]);
}

export function createRgb332Palette() {
  const palette = Buffer.alloc(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    palette[index * 3] = Math.round(((index >>> 5) & 0x07) * 255 / 7);
    palette[index * 3 + 1] = Math.round(((index >>> 2) & 0x07) * 255 / 7);
    palette[index * 3 + 2] = (index & 0x03) * 85;
  }
  return palette;
}

export function rgb332Index(red, green, blue) {
  return (red & 0xe0) | ((green & 0xe0) >>> 3) | (blue >>> 6);
}

export function encodeRgbFrameLzw(frame) {
  if (frame.length % 3 !== 0) throw new Error('RGB frame length must be divisible by three.');

  let dictionary = new Map();
  let nextCode = GIF_END_CODE + 1;
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes = [];

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += GIF_CODE_SIZE;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  const resetDictionary = () => {
    dictionary = new Map();
    nextCode = GIF_END_CODE + 1;
  };
  const symbolAt = (pixelIndex) => {
    const offset = pixelIndex * 3;
    return rgb332Index(frame[offset], frame[offset + 1], frame[offset + 2]);
  };

  emit(GIF_CLEAR_CODE);
  const pixelCount = frame.length / 3;
  if (pixelCount > 0) {
    let prefix = symbolAt(0);
    for (let pixelIndex = 1; pixelIndex < pixelCount; pixelIndex += 1) {
      const symbol = symbolAt(pixelIndex);
      const key = prefix * 256 + symbol;
      const existing = dictionary.get(key);
      if (existing !== undefined) {
        prefix = existing;
        continue;
      }

      emit(prefix);
      if (nextCode < GIF_DICTIONARY_RESET_CODE) {
        dictionary.set(key, nextCode);
        nextCode += 1;
      } else {
        emit(GIF_CLEAR_CODE);
        resetDictionary();
      }
      prefix = symbol;
    }
    emit(prefix);
  }
  emit(GIF_END_CODE);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return Buffer.from(bytes);
}

function writeBuffer(fileDescriptor, buffer) {
  writeSync(fileDescriptor, buffer);
}

function writeSubBlocks(fileDescriptor, data) {
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.subarray(offset, offset + 255);
    writeBuffer(fileDescriptor, Buffer.from([block.length]));
    writeBuffer(fileDescriptor, block);
  }
  writeBuffer(fileDescriptor, Buffer.from([0]));
}

export function writeGifHeader(fileDescriptor, width, height) {
  writeBuffer(fileDescriptor, Buffer.from('GIF89a'));
  writeBuffer(fileDescriptor, littleEndian16(width));
  writeBuffer(fileDescriptor, littleEndian16(height));
  writeBuffer(fileDescriptor, Buffer.from([0xf7, 0x00, 0x00]));
  writeBuffer(fileDescriptor, createRgb332Palette());
  writeBuffer(fileDescriptor, Buffer.from([0x21, 0xff, 0x0b]));
  writeBuffer(fileDescriptor, Buffer.from('NETSCAPE2.0'));
  writeBuffer(fileDescriptor, Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));
}

export function writeGifFrame(fileDescriptor, frame, width, height, delayCentiseconds) {
  writeBuffer(fileDescriptor, Buffer.from([
    0x21, 0xf9, 0x04, 0x00,
    delayCentiseconds & 0xff,
    (delayCentiseconds >>> 8) & 0xff,
    0x00, 0x00,
  ]));
  writeBuffer(fileDescriptor, Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00]));
  writeBuffer(fileDescriptor, littleEndian16(width));
  writeBuffer(fileDescriptor, littleEndian16(height));
  writeBuffer(fileDescriptor, Buffer.from([0x00, 0x08]));
  writeSubBlocks(fileDescriptor, encodeRgbFrameLzw(frame));
}

function writeGifTrailer(fileDescriptor) {
  writeBuffer(fileDescriptor, Buffer.from([0x3b]));
}

function decodeFrames(ffmpeg, recording, dimensions, onFrame) {
  const frameSize = dimensions.width * dimensions.height * 3;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpeg, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', recording,
      '-vf', `fps=${FRAME_RATE},scale=${dimensions.width}:${dimensions.height}:flags=lanczos`,
      '-an',
      '-pix_fmt', 'rgb24',
      '-f', 'rawvideo',
      'pipe:1',
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let chunks = [];
    let bufferedBytes = 0;
    let frameCount = 0;

    child.stdout.on('data', (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        const required = frameSize - bufferedBytes;
        const length = Math.min(required, chunk.length - offset);
        chunks.push(chunk.subarray(offset, offset + length));
        bufferedBytes += length;
        offset += length;

        if (bufferedBytes === frameSize) {
          onFrame(Buffer.concat(chunks, frameSize), frameCount);
          frameCount += 1;
          chunks = [];
          bufferedBytes = 0;
        }
      }
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`FFmpeg failed to decode ${recording} with exit code ${code ?? 1}.`));
        return;
      }
      if (bufferedBytes !== 0) {
        rejectPromise(new Error(`FFmpeg returned an incomplete RGB frame for ${recording}.`));
        return;
      }
      if (frameCount === 0) {
        rejectPromise(new Error(`FFmpeg returned no frames for ${recording}.`));
        return;
      }
      resolvePromise(frameCount);
    });
  });
}

async function generateGif(ffmpeg, recording) {
  const name = basename(recording, extname(recording));
  const output = join(outputDirectory, `${name}.gif`);
  const dimensions = targetDimensions(ffmpeg, recording, name);
  const delay = Math.max(1, Math.round(100 / FRAME_RATE));
  const fileDescriptor = openSync(output, 'w');

  try {
    writeGifHeader(fileDescriptor, dimensions.width, dimensions.height);
    const frameCount = await decodeFrames(ffmpeg, recording, dimensions, (frame) => {
      writeGifFrame(fileDescriptor, frame, dimensions.width, dimensions.height, delay);
    });
    writeGifTrailer(fileDescriptor);
    process.stdout.write(`Generated ${output} with ${frameCount} frame(s) using the bundled decoder and deterministic Node GIF encoder.\n`);
  } finally {
    closeSync(fileDescriptor);
  }
}

export async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  const recordings = recordingFiles();
  if (!recordings.length) throw new Error(`No WebM viewport recordings found in ${outputDirectory}.`);
  const ffmpeg = resolveFfmpeg();
  for (const recording of recordings) await generateGif(ffmpeg, recording);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
