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
const ACTIVE_OUTLINE = [244, 201, 93, 255];

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
    radius: Math.max(24, Math.min(38, decoded.width * Number(ball.radius) / 100)),
  };
}

function assertLegacyFootball(decoded, ball, completed, active) {
  const { centerX, centerY, radius } = ballGeometry(decoded, ball);
  assert.deepEqual(
    pixelAt(decoded, centerX + radius * 0.7, centerY),
    completed ? COMPLETED_FILL : NEUTRAL_FILL,
    `ball ${ball.order} must use the ${completed ? 'completed green' : 'neutral white'} fill`,
  );

  let lightDigitPixels = 0;
  let darkPentagonPixels = 0;
  for (let y = Math.floor(centerY - radius * 0.45); y <= Math.ceil(centerY + radius * 0.45); y += 1) {
    for (let x = Math.floor(centerX - radius * 0.45); x <= Math.ceil(centerX + radius * 0.45); x += 1) {
      const [red, green, blue, alpha] = pixelAt(decoded, x, y);
      if (alpha === 255 && red >= 245 && green >= 245 && blue >= 245) lightDigitPixels += 1;
      if (alpha === 255 && red <= 32 && green <= 32 && blue <= 40) darkPentagonPixels += 1;
    }
  }
  assert.ok(lightDigitPixels >= 30, `ball ${ball.order} must contain a readable light number`);
  assert.ok(darkPentagonPixels >= 90, `ball ${ball.order} must contain the legacy dark pentagon`);

  const outline = pixelAt(decoded, centerX + radius - 1, centerY);
  if (active) assert.deepEqual(outline, ACTIVE_OUTLINE, `ball ${ball.order} must expose the active gold outline`);
  else assert.ok(outline[0] <= 32 && outline[1] <= 32 && outline[2] <= 40, `ball ${ball.order} must keep a dark outline`);

  const effect = active
    ? pixelAt(decoded, centerX + radius + 7, centerY)
    : pixelAt(decoded, centerX + radius + 3, centerY + 6);
  if (active) {
    const background = pixelAt(decoded, centerX + radius + 14, centerY);
    assert.ok(
      effect[0] >= background[0] + 20 && effect[1] >= background[1] + 15,
      `ball ${ball.order} must keep a gold active glow`,
    );
  } else {
    assert.ok(Math.max(effect[0], effect[1], effect[2]) <= 80, `ball ${ball.order} must keep a dark drop shadow`);
  }
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
  for (let y = Math.floor(centerY - radius - 14); y <= Math.ceil(centerY + radius + 14); y += 1) {
    for (let x = Math.floor(centerX - radius - 14); x <= Math.ceil(centerX + radius + 14); x += 1) {
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

test('renders deterministic legacy neutral, active and completed states for progress zero through four', async () => {
  const balls = fixedLayout();
  const rasters = [];
  for (let selectedCount = 0; selectedCount <= 4; selectedCount += 1) {
    const raster = await renderHumanCheckRaster(balls, { selectedCount });
    const repeated = await renderHumanCheckRaster(balls, { selectedCount });
    assert.equal(raster.digest, repeated.digest);
    assert.deepEqual(raster.bytes, repeated.bytes);
    const decoded = decodeRgbaPng(raster.bytes);
    assertLegacyPitch(decoded);
    balls.forEach((ball, index) => assertLegacyFootball(
      decoded,
      ball,
      index < selectedCount,
      index === selectedCount,
    ));
    rasters.push({ raster, decoded });
  }

  assert.equal(new Set(rasters.map(({ raster }) => raster.digest)).size, 5);
  for (let progress = 1; progress <= 4; progress += 1) {
    const previous = rasters[progress - 1].decoded;
    const current = rasters[progress].decoded;
    assert.notDeepEqual(cropBall(previous, balls[progress - 1]), cropBall(current, balls[progress - 1]));
    if (progress < balls.length) {
      assert.notDeepEqual(cropBall(previous, balls[progress]), cropBall(current, balls[progress]));
    }
    for (let unchanged = progress + 1; unchanged < balls.length; unchanged += 1) {
      assert.deepEqual(
        cropBall(previous, balls[unchanged]),
        cropBall(current, balls[unchanged]),
        `progress ${progress} must not change future ball ${unchanged + 1}`,
      );
    }
  }
});

test('renders readable progress at minimum, default and maximum dimensions', async () => {
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
    balls.forEach((ball, index) => assertLegacyFootball(decoded, ball, index < 2, index === 2));
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
  assert.ok(edge.bytes.length > 100);

  await assert.rejects(
    () => renderHumanCheckRaster([
      { order: 5, x: 20, y: 20, radius: 8 },
      ...edgeBalls.slice(1),
    ]),
    /Unsupported digit/,
  );
});
