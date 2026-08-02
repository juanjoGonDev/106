import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  createHumanCheckLayout,
  HUMAN_CHECK_RASTER,
  renderHumanCheckRaster,
} from '../supabase/functions/_shared/human-check-raster.js';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const NEUTRAL_FILL = [247, 248, 251, 255];
const COMPLETED_FILL = [84, 209, 139, 255];

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

function pixelAt(decoded, x, y) {
  const px = Math.max(0, Math.min(decoded.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(decoded.height - 1, Math.round(y)));
  const offset = (py * decoded.width + px) * 4;
  return [...decoded.pixels.subarray(offset, offset + 4)];
}

function ballGeometry(decoded, ball) {
  return {
    centerX: decoded.width * Number(ball.x) / 100,
    centerY: decoded.height * Number(ball.y) / 100,
    radius: Math.max(25, Math.min(38, decoded.width * Number(ball.radius) / 100)),
  };
}

function colorDistance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function assertLegacyFootball(decoded, ball, completed) {
  const { centerX, centerY, radius } = ballGeometry(decoded, ball);
  const expectedFill = completed ? COMPLETED_FILL : NEUTRAL_FILL;
  assert.ok(
    colorDistance(pixelAt(decoded, centerX + radius * 0.7, centerY), expectedFill) <= 4,
    `ball ${ball.order} must use the exact ${completed ? 'completed green' : 'neutral white'} fill`,
  );

  const outline = pixelAt(decoded, centerX + radius - 1.5, centerY);
  assert.ok(outline[0] <= 40 && outline[1] <= 40 && outline[2] <= 48, `ball ${ball.order} must keep the dark legacy outline`);

  let lightNumberPixels = 0;
  let completedNumberPixels = 0;
  let darkPentagonPixels = 0;
  let blendedEdgePixels = 0;
  const colors = new Set();
  for (let y = Math.floor(centerY - radius - 3); y <= Math.ceil(centerY + radius + 3); y += 1) {
    for (let x = Math.floor(centerX - radius - 3); x <= Math.ceil(centerX + radius + 3); x += 1) {
      const pixel = pixelAt(decoded, x, y);
      colors.add(pixel.slice(0, 3).join(','));
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance >= radius - 2 && distance <= radius + 2) {
        const fillDistance = colorDistance(pixel, expectedFill);
        const outlineDistance = colorDistance(pixel, [17, 21, 29, 255]);
        if (fillDistance > 8 && outlineDistance > 8) blendedEdgePixels += 1;
      }
      if (Math.abs(x - centerX) <= radius * 0.25 && Math.abs(y - centerY) <= radius * 0.35) {
        const [red, green, blue] = pixel;
        if (red >= 238 && green >= 238 && blue >= 238) lightNumberPixels += 1;
        if (red <= 12 && green <= 24 && blue <= 18) completedNumberPixels += 1;
        if (red <= 38 && green <= 38 && blue <= 46) darkPentagonPixels += 1;
      }
    }
  }
  assert.ok(darkPentagonPixels >= 60, `ball ${ball.order} must retain the central dark pentagon`);
  if (completed) {
    assert.ok(completedNumberPixels >= 8, `completed ball ${ball.order} must use the legacy dark number`);
  } else {
    assert.ok(lightNumberPixels >= 12, `neutral ball ${ball.order} must contain a smooth readable white number`);
  }
  assert.ok(blendedEdgePixels >= 12, `ball ${ball.order} must have anti-aliased circular edges`);
  assert.ok(colors.size >= 35, `ball ${ball.order} must not regress to a flat pixel-art sprite`);

  const shadow = pixelAt(decoded, centerX + radius + 5, centerY + 2);
  const background = pixelAt(decoded, centerX + radius + 16, centerY + 2);
  assert.ok(
    shadow[0] < background[0] || shadow[1] < background[1] || shadow[2] < background[2],
    `ball ${ball.order} must retain the diffuse canvas-style shadow`,
  );
}

function assertLegacyPitch(decoded) {
  const topLeft = pixelAt(decoded, 2, 2);
  const middle = pixelAt(decoded, decoded.width / 2 + 20, decoded.height / 2 + 20);
  const bottomRight = pixelAt(decoded, decoded.width - 3, decoded.height - 3);
  assert.ok(topLeft[0] > topLeft[2] * 2, 'pitch must begin with the legacy burgundy tone');
  assert.ok(middle[0] < 45 && middle[1] < 45 && middle[2] < 55, 'pitch middle must retain the dark stadium tone');
  assert.ok(bottomRight[2] > bottomRight[0] * 2, 'pitch must end with the legacy blue tone');
  const line = pixelAt(decoded, 18, 18);
  assert.ok(line[0] > topLeft[0] || line[1] > topLeft[1] || line[2] > topLeft[2], 'pitch boundary must remain visible');
}

function cropBall(decoded, ball) {
  const { centerX, centerY, radius } = ballGeometry(decoded, ball);
  const bytes = [];
  for (let y = Math.floor(centerY - radius - 16); y <= Math.ceil(centerY + radius + 16); y += 1) {
    for (let x = Math.floor(centerX - radius - 16); x <= Math.ceil(centerX + radius + 16); x += 1) {
      bytes.push(...pixelAt(decoded, x, y));
    }
  }
  return bytes;
}

function fixedLayout() {
  return createHumanCheckLayout(sequence([
    0.05, 0.10,
    0.95, 0.10,
    0.05, 0.90,
    0.95, 0.90,
  ]));
}

test('publishes the exact legacy visual contract', () => {
  assert.deepEqual(HUMAN_CHECK_RASTER, {
    width: 560,
    height: 360,
    ballCount: 4,
    radiusPercent: 8,
    minimumDistancePercent: 26,
    supersample: 3,
    style: {
      pitchStart: [98, 0, 25, 255],
      pitchMiddle: [16, 18, 26, 255],
      pitchEnd: [18, 48, 95, 255],
      fieldLine: [255, 255, 255, 34],
      neutralFill: [247, 248, 251, 255],
      completedFill: [84, 209, 139, 255],
      outline: [17, 21, 29, 255],
      neutralNumber: [255, 255, 255, 255],
      completedNumber: [7, 17, 11, 255],
    },
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

test('renders deterministic neutral and server-confirmed completed states without a next-target hint', async () => {
  const balls = fixedLayout();
  const rasters = [];
  for (let selectedCount = 0; selectedCount <= 4; selectedCount += 1) {
    const raster = await renderHumanCheckRaster(balls, { selectedCount });
    const repeated = await renderHumanCheckRaster(balls, { selectedCount });
    assert.equal(raster.digest, repeated.digest);
    assert.deepEqual(raster.bytes, repeated.bytes);
    const decoded = decodeRgbaPng(raster.bytes);
    assertLegacyPitch(decoded);
    balls.forEach((ball, index) => assertLegacyFootball(decoded, ball, index < selectedCount));
    rasters.push({ raster, decoded });
  }

  assert.equal(new Set(rasters.map(({ raster }) => raster.digest)).size, 5);
  for (let progress = 1; progress <= 4; progress += 1) {
    const previous = rasters[progress - 1].decoded;
    const current = rasters[progress].decoded;
    assert.notDeepEqual(cropBall(previous, balls[progress - 1]), cropBall(current, balls[progress - 1]));
    for (let unchanged = progress; unchanged < balls.length; unchanged += 1) {
      assert.deepEqual(
        cropBall(previous, balls[unchanged]),
        cropBall(current, balls[unchanged]),
        `progress ${progress} must not reveal or visually change future ball ${unchanged + 1}`,
      );
    }
  }
});

test('renders smooth readable footballs at minimum, default and maximum dimensions', async () => {
  const balls = fixedLayout();
  for (const options of [
    { width: 1, height: 1, selectedCount: 2 },
    { selectedCount: 2 },
    { width: 9999, height: 9999, selectedCount: 2 },
  ]) {
    const raster = await renderHumanCheckRaster(balls, options);
    assert.equal(raster.mediaType, 'image/png');
    assert.match(raster.dataUrl, /^data:image\/png;base64,/);
    assert.match(raster.digest, /^[a-f0-9]{64}$/);
    const decoded = decodeRgbaPng(raster.bytes);
    assertLegacyPitch(decoded);
    balls.forEach((ball, index) => assertLegacyFootball(decoded, ball, index < 2));
  }
});

test('handles edge geometry and rejects malformed raster contracts', async () => {
  await assert.rejects(() => renderHumanCheckRaster(null), /exactly 4 balls/);
  await assert.rejects(() => renderHumanCheckRaster([]), /exactly 4 balls/);
  for (const selectedCount of [-1, 5, 1.5, 'invalid']) {
    await assert.rejects(() => renderHumanCheckRaster(fixedLayout(), { selectedCount }), /selectedCount/);
  }

  const edgeBalls = [
    { order: 1, x: 0, y: 0, radius: 8 },
    { order: 2, x: 100, y: 0, radius: 8 },
    { order: 3, x: 0, y: 100, radius: 8 },
    { order: 4, x: 100, y: 100, radius: 8 },
  ];
  const edge = await renderHumanCheckRaster(edgeBalls, { width: 320, height: 200, selectedCount: 4 });
  const decoded = decodeRgbaPng(edge.bytes);
  assert.equal(decoded.width, 320);
  assert.equal(decoded.height, 220);

  await assert.rejects(
    () => renderHumanCheckRaster([
      { order: 5, x: 20, y: 20, radius: 8 },
      ...edgeBalls.slice(1),
    ]),
    /Unsupported digit/,
  );
});
