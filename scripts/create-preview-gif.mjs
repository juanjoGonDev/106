import { createRequire } from 'node:module';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const outputDirectory = resolve('.tmp/pr-previews');
const FRAME_RATE = 8;
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 720;
const GIF_CLEAR_CODE = 256;
const GIF_END_CODE = 257;
const GIF_DICTIONARY_RESET_CODE = 511;
const GIF_CODE_SIZE = 9;
const EVIDENCE_ORIGIN = 'https://evidence.local';

function playwrightCacheRoots() {
  return [
    process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, 'pnpm', 'dlx') : '',
    join(homedir(), '.cache', 'pnpm', 'dlx'),
  ].filter((value, index, values) => value && values.indexOf(value) === index && existsSync(value));
}

function findPlaywrightPackageJson(root) {
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
      if (!entry.isFile() || entry.name !== 'package.json' || !path.includes(join('node_modules', '@playwright', 'test'))) {
        continue;
      }
      try {
        const packageJson = JSON.parse(readFileSync(path, 'utf8'));
        if (packageJson.name === '@playwright/test' && packageJson.version === '1.60.0') return path;
      } catch {
        // Ignore incomplete or unrelated package metadata in the dlx cache.
      }
    }
  }
  return null;
}

function resolvePlaywrightRuntimePath() {
  const packageJsonPath = playwrightCacheRoots().map(findPlaywrightPackageJson).find(Boolean);
  if (!packageJsonPath) {
    throw new Error('Unable to locate @playwright/test@1.60.0 in the pnpm dlx cache. Run the browser journey before GIF generation.');
  }
  return dirname(packageJsonPath);
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

function targetDimensions(sourceWidth, sourceHeight, name) {
  const width = outputWidth(name);
  const scaledHeight = Math.max(2, Math.round(sourceHeight * width / sourceWidth));
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

function writeEncodedGifFrame(fileDescriptor, encodedFrame, width, height, delayCentiseconds) {
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
  writeSubBlocks(fileDescriptor, encodedFrame);
}

export function writeGifFrame(fileDescriptor, frame, width, height, delayCentiseconds) {
  writeEncodedGifFrame(
    fileDescriptor,
    encodeRgbFrameLzw(frame),
    width,
    height,
    delayCentiseconds,
  );
}

function writeGifTrailer(fileDescriptor) {
  writeBuffer(fileDescriptor, Buffer.from([0x3b]));
}

async function openVideo(page, recording) {
  await page.route(`${EVIDENCE_ORIGIN}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/video.webm') {
      await route.fulfill({
        status: 200,
        contentType: 'video/webm',
        headers: { 'cache-control': 'no-store' },
        path: recording,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><video id="source" muted playsinline></video><canvas id="frame"></canvas></body></html>',
    });
  });
  await page.goto(`${EVIDENCE_ORIGIN}/player`, { waitUntil: 'domcontentloaded' });

  return await page.evaluate(async () => {
    const response = await globalThis.fetch('/video.webm', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load recording: HTTP ${response.status}`);
    const blob = await response.blob();
    const video = globalThis.document.querySelector('#source');
    video.src = globalThis.URL.createObjectURL(blob);
    await new Promise((resolvePromise, rejectPromise) => {
      video.addEventListener('loadeddata', resolvePromise, { once: true });
      video.addEventListener('error', () => rejectPromise(new Error('Chrome could not decode the WebM recording.')), { once: true });
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error(`Invalid recording duration: ${video.duration}`);
    }
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  });
}

async function encodeVideoFrames(page, dimensions, duration, delayCentiseconds) {
  return await page.evaluate(async ({ width, height, frameRate, durationSeconds, delay }) => {
    const clearCode = 256;
    const endCode = 257;
    const dictionaryResetCode = 511;
    const codeSize = 9;
    const video = globalThis.document.querySelector('#source');
    const canvas = globalThis.document.querySelector('#frame');
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    canvas.width = width;
    canvas.height = height;

    function encodeRgbaFrame(frame) {
      let dictionary = new Map();
      let nextCode = endCode + 1;
      let bitBuffer = 0;
      let bitCount = 0;
      const bytes = [];

      const emit = (code) => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
          bytes.push(bitBuffer & 0xff);
          bitBuffer >>>= 8;
          bitCount -= 8;
        }
      };
      const resetDictionary = () => {
        dictionary = new Map();
        nextCode = endCode + 1;
      };
      const symbolAt = (pixelIndex) => {
        const offset = pixelIndex * 4;
        return (frame[offset] & 0xe0)
          | ((frame[offset + 1] & 0xe0) >>> 3)
          | (frame[offset + 2] >>> 6);
      };

      emit(clearCode);
      const pixelCount = frame.length / 4;
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
        if (nextCode < dictionaryResetCode) {
          dictionary.set(key, nextCode);
          nextCode += 1;
        } else {
          emit(clearCode);
          resetDictionary();
        }
        prefix = symbol;
      }
      emit(prefix);
      emit(endCode);
      if (bitCount > 0) bytes.push(bitBuffer & 0xff);
      return new Uint8Array(bytes);
    }

    function base64(bytes) {
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return globalThis.btoa(binary);
    }

    async function seek(time) {
      if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return;
      await new Promise((resolvePromise, rejectPromise) => {
        const timeout = globalThis.setTimeout(
          () => rejectPromise(new Error(`Timed out seeking to ${time.toFixed(3)}s.`)),
          5_000,
        );
        video.addEventListener('seeked', () => {
          globalThis.clearTimeout(timeout);
          resolvePromise();
        }, { once: true });
        video.addEventListener('error', () => {
          globalThis.clearTimeout(timeout);
          rejectPromise(new Error(`Video decode failed while seeking to ${time.toFixed(3)}s.`));
        }, { once: true });
        video.currentTime = time;
      });
    }

    const frameCount = Math.max(1, Math.ceil(durationSeconds * frameRate));
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(index / frameRate, Math.max(0, durationSeconds - 0.001));
      await seek(time);
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      await globalThis.emitGifFrame(base64(encodeRgbaFrame(pixels)), delay);
    }
    return frameCount;
  }, {
    width: dimensions.width,
    height: dimensions.height,
    frameRate: FRAME_RATE,
    durationSeconds: duration,
    delay: delayCentiseconds,
  });
}

async function generateGif(browser, recording) {
  const name = basename(recording, extname(recording));
  const output = join(outputDirectory, `${name}.gif`);
  const context = await browser.newContext();
  const page = await context.newPage();
  let fileDescriptor = null;

  try {
    const metadata = await openVideo(page, recording);
    const dimensions = targetDimensions(metadata.width, metadata.height, name);
    const delay = Math.max(1, Math.round(100 / FRAME_RATE));
    fileDescriptor = openSync(output, 'w');
    writeGifHeader(fileDescriptor, dimensions.width, dimensions.height);
    await page.exposeFunction('emitGifFrame', async (encodedBase64, frameDelay) => {
      writeEncodedGifFrame(
        fileDescriptor,
        Buffer.from(encodedBase64, 'base64'),
        dimensions.width,
        dimensions.height,
        frameDelay,
      );
    });
    const frameCount = await encodeVideoFrames(page, dimensions, metadata.duration, delay);
    writeGifTrailer(fileDescriptor);
    process.stdout.write(`Generated ${output} with ${frameCount} frame(s) using Chrome WebM decoding and deterministic GIF encoding.\n`);
  } catch (error) {
    if (existsSync(output)) unlinkSync(output);
    throw error;
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    await context.close();
  }
}

export async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  const recordings = recordingFiles();
  if (!recordings.length) throw new Error(`No WebM viewport recordings found in ${outputDirectory}.`);

  const runtimePath = resolvePlaywrightRuntimePath();
  const require = createRequire(import.meta.url);
  const { chromium } = require(runtimePath);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const recording of recordings) await generateGif(browser, recording);
  } finally {
    await browser.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
