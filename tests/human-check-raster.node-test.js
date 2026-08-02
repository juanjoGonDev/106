import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  createHumanCheckLayout,
  HUMAN_CHECK_RASTER,
  renderHumanCheckRaster,
} from '../supabase/functions/_shared/human-check-raster.js';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function assertSeparated(balls) {
  for (let left = 0; left < balls.length; left += 1) {
    for (let right = left + 1; right < balls.length; right += 1) {
      assert.ok(
        Math.hypot(balls[left].x - balls[right].x, balls[left].y - balls[right].y)
          >= HUMAN_CHECK_RASTER.minimumDistancePercent,
      );
    }
  }
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  ) >>> 0;
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function decodeRgbaPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE);
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressedParts = [];
  const textDecoder = new TextDecoder();

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = textDecoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    } else if (type === 'IDAT') {
      compressedParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  assert.ok(width > 0 && height > 0);
  assert.ok(compressedParts.length > 0);
  const scanlines = inflateSync(concatBytes(compressedParts));
  const rowLength = width * 4;
  const pixels = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowLength + 1);
    assert.equal(scanlines[scanlineOffset], 0, 'renderer must use unfiltered RGBA scanlines');
    pixels.set(
      scanlines.subarray(scanlineOffset + 1, scanlineOffset + 1 + rowLength),
      y * rowLength,
    );
  }
  return { width, height, pixels };
}

function assertVisibleNumberContrast(raster, balls) {
  const decoded = decodeRgbaPng(raster.bytes);
  assert.equal(decoded.width, raster.width);
  assert.equal(decoded.height, raster.height);

  for (const ball of balls) {
    const centerX = decoded.width * Number(ball.x) / 100;
    const centerY = decoded.height * Number(ball.y) / 100;
    const radius = Math.max(24, Math.min(36, decoded.width * Number(ball.radius) / 100));
    const halfWidth = radius * 0.45;
    const halfHeight = radius * 0.55;
    let lightPixels = 0;
    let darkPixels = 0;

    for (let y = Math.floor(centerY - halfHeight); y <= Math.ceil(centerY + halfHeight); y += 1) {
      for (let x = Math.floor(centerX - halfWidth); x <= Math.ceil(centerX + halfWidth); x += 1) {
        if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) continue;
        const pixelOffset = (y * decoded.width + x) * 4;
        const red = decoded.pixels[pixelOffset];
        const green = decoded.pixels[pixelOffset + 1];
        const blue = decoded.pixels[pixelOffset + 2];
        const alpha = decoded.pixels[pixelOffset + 3];
        if (alpha === 255 && red >= 245 && green >= 245 && blue >= 245) lightPixels += 1;
        if (alpha === 255 && red <= 32 && green <= 32 && blue <= 40) darkPixels += 1;
      }
    }

    assert.ok(lightPixels >= 40, `ball ${ball.order} must contain a visible light digit`);
    assert.ok(darkPixels >= 80, `ball ${ball.order} must contain a contrasting dark badge`);
  }
}

function fixedLayout() {
  return createHumanCheckLayout(sequence([
    0.05, 0.10,
    0.95, 0.10,
    0.05, 0.90,
    0.95, 0.90,
  ]));
}

test('publishes stable raster geometry constants', () => {
  assert.deepEqual(HUMAN_CHECK_RASTER, {
    width: 480,
    height: 300,
    ballCount: 4,
    radiusPercent: 8,
    minimumDistancePercent: 26,
  });
});

test('creates immutable separated layouts from bounded random values', () => {
  const balls = fixedLayout();
  assert.equal(balls.length, 4);
  assert.deepEqual(balls.map((ball) => ball.order), [1, 2, 3, 4]);
  assert.ok(balls.every((ball) => ball.radius === 8));
  assertSeparated(balls);
  assert.throws(() => balls.push({}), TypeError);
  assert.throws(() => { balls[0].x = 50; }, TypeError);
});

test('uses cryptographically secure layout randomness by default', () => {
  const balls = createHumanCheckLayout();
  assert.deepEqual(balls.map((ball) => ball.order), [1, 2, 3, 4]);
  assert.ok(balls.every((ball) => ball.x >= 14 && ball.x <= 86));
  assert.ok(balls.every((ball) => ball.y >= 18 && ball.y <= 82));
  assertSeparated(balls);
});

test('normalizes invalid random values and falls back when candidates overlap', () => {
  assert.throws(() => createHumanCheckLayout(null), /random/);

  const fallback = createHumanCheckLayout(() => Number.NaN);
  assert.equal(fallback.length, 4);
  assert.ok(fallback.every((ball) => Number.isFinite(ball.x) && Number.isFinite(ball.y)));

  const clamped = createHumanCheckLayout(sequence([
    -100, 100,
    100, -100,
    -100, -100,
    100, 100,
  ]));
  assert.equal(clamped.length, 4);
  assert.ok(clamped.every((ball) => ball.x >= 14 && ball.x <= 86));
  assert.ok(clamped.every((ball) => ball.y >= 18 && ball.y <= 82));
});

test('renders deterministic PNG data with bounded dimensions', async () => {
  const balls = fixedLayout();
  const first = await renderHumanCheckRaster(balls);
  const second = await renderHumanCheckRaster(balls);

  assert.equal(first.mediaType, 'image/png');
  assert.equal(first.width, 480);
  assert.equal(first.height, 300);
  assert.deepEqual([...first.bytes.subarray(0, 8)], PNG_SIGNATURE);
  assert.match(first.dataUrl, /^data:image\/png;base64,/);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.bytes, second.bytes);
  assertVisibleNumberContrast(first, balls);

  const minimum = await renderHumanCheckRaster(balls, { width: 1, height: 1 });
  assert.equal(minimum.width, 320);
  assert.equal(minimum.height, 200);
  assertVisibleNumberContrast(minimum, balls);

  const maximum = await renderHumanCheckRaster(balls, { width: 9999, height: 9999 });
  assert.equal(maximum.width, 640);
  assert.equal(maximum.height, 480);
  assertVisibleNumberContrast(maximum, balls);
});

test('handles edge geometry and rejects malformed raster contracts', async () => {
  await assert.rejects(() => renderHumanCheckRaster(null), /exactly 4 balls/);
  await assert.rejects(() => renderHumanCheckRaster([]), /exactly 4 balls/);

  const edgeBalls = [
    { order: 1, x: 0, y: 0, radius: 8 },
    { order: 2, x: 100, y: 0, radius: 8 },
    { order: 3, x: 0, y: 100, radius: 8 },
    { order: 4, x: 100, y: 100, radius: 8 },
  ];
  const edge = await renderHumanCheckRaster(edgeBalls, { width: 320, height: 200 });
  assert.ok(edge.bytes.length > 100);

  await assert.rejects(
    () => renderHumanCheckRaster([
      { order: 5, x: 20, y: 20, radius: 8 },
      ...edgeBalls.slice(1),
    ]),
    /Unsupported digit/,
  );
});
