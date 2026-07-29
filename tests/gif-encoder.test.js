import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRgb332Palette,
  encodeRgbFrameLzw,
  rgb332Index,
  writeGifFrame,
  writeGifHeader,
} from '../scripts/create-preview-gif.mjs';

const temporaryDirectories = [];

function readNineBitCodes(data) {
  const codes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  for (const byte of data) {
    bitBuffer |= byte << bitCount;
    bitCount += 8;
    while (bitCount >= 9) {
      codes.push(bitBuffer & 0x1ff);
      bitBuffer >>>= 9;
      bitCount -= 9;
    }
  }
  return codes;
}

function decodeFixedNineBitLzw(data) {
  const clearCode = 256;
  const endCode = 257;
  let dictionary = [];
  let nextCode = 258;
  let previous = null;
  const output = [];

  const reset = () => {
    dictionary = Array.from({ length: 256 }, (_, index) => [index]);
    nextCode = 258;
    previous = null;
  };

  reset();
  for (const code of readNineBitCodes(data)) {
    if (code === clearCode) {
      reset();
      continue;
    }
    if (code === endCode) break;

    const entry = dictionary[code]
      ?? (code === nextCode && previous ? [...previous, previous[0]] : null);
    if (!entry) throw new Error(`Invalid test LZW code ${code}.`);
    output.push(...entry);

    if (previous && nextCode < 511) {
      dictionary[nextCode] = [...previous, entry[0]];
      nextCode += 1;
    }
    previous = entry;
  }
  return output;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('dependency-free GIF evidence encoder', () => {
  it('round-trips RGB332 symbols through the bounded LZW stream', () => {
    const frame = Buffer.from([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255,
      255, 0, 0,
      255, 0, 0,
    ]);

    const decoded = decodeFixedNineBitLzw(encodeRgbFrameLzw(frame));
    const expected = [];
    for (let offset = 0; offset < frame.length; offset += 3) {
      expected.push(rgb332Index(frame[offset], frame[offset + 1], frame[offset + 2]));
    }
    expect(decoded).toEqual(expected);
  });

  it('writes a looping GIF89a document with a complete frame', () => {
    const directory = mkdtempSync(join(tmpdir(), 'minuto106-gif-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'evidence.gif');
    const fileDescriptor = openSync(path, 'w');
    const frame = Buffer.from([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255,
    ]);

    writeGifHeader(fileDescriptor, 2, 2);
    writeGifFrame(fileDescriptor, frame, 2, 2, 8);
    writeSync(fileDescriptor, Buffer.from([0x3b]));
    closeSync(fileDescriptor);

    const gif = readFileSync(path);
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gif.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
    expect(gif.includes(Buffer.from([0x2c]))).toBe(true);
    expect(gif.at(-1)).toBe(0x3b);
    expect(createRgb332Palette()).toHaveLength(768);
  });

  it('rejects incomplete RGB pixels', () => {
    expect(() => encodeRgbFrameLzw(Buffer.from([1, 2]))).toThrow(/divisible by three/u);
  });
});
