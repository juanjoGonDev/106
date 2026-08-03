import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createHumanCheckLayout, HUMAN_CHECK_RASTER, renderHumanCheckRaster } from '../supabase/functions/_shared/human-check-raster.js';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const NEUTRAL_FILL = [247, 248, 251, 255];
const COMPLETED_FILL = [84, 209, 139, 255];
const DARK = [17, 21, 29, 255];

function sequence(values) { let index = 0; return () => values[index++ % values.length]; }
function fixedLayout() {
  return createHumanCheckLayout(sequence([0.05, 0.10, 0.95, 0.10, 0.05, 0.90, 0.95, 0.90]));
}
function assertSeparated(balls) {
  for (let left = 0; left < balls.length; left += 1) {
    for (let right = left + 1; right < balls.length; right += 1) {
      assert.ok(Math.hypot(balls[left].x - balls[right].x, balls[left].y - balls[right].y) >= HUMAN_CHECK_RASTER.minimumDistancePercent);
    }
  }
}
function readUint32(bytes, offset) { return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0; }
function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function decodeRgbaPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE);
  let offset = 8; let width = 0; let height = 0; const compressed = []; const decoder = new TextDecoder();
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = readUint32(data, 0); height = readUint32(data, 4); assert.equal(data[8], 8); assert.equal(data[9], 6); }
    else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0 && compressed.length > 0);
  const scanlines = inflateSync(concatBytes(compressed));
  const rowLength = width * 4; const pixels = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowLength + 1); assert.equal(scanlines[scanlineOffset], 0);
    pixels.set(scanlines.subarray(scanlineOffset + 1, scanlineOffset + 1 + rowLength), y * rowLength);
  }
  return { width, height, pixels };
}
function pixelAt(decoded, x, y) {
  const px = Math.max(0, Math.min(decoded.width - 1, Math.round(x))); const py = Math.max(0, Math.min(decoded.height - 1, Math.round(y)));
  return [...decoded.pixels.subarray((py * decoded.width + px) * 4, (py * decoded.width + px) * 4 + 4)];
}
function geometry(decoded, ball) { return { x: decoded.width * ball.x / 100, y: decoded.height * ball.y / 100, radius: Math.max(25, Math.min(38, decoded.width * ball.radius / 100)) }; }
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function crop(decoded, ball, margin = 28) {
  const g = geometry(decoded, ball); const bytes = [];
  for (let y = Math.floor(g.y - g.radius - margin); y <= Math.ceil(g.y + g.radius + margin); y += 1) {
    for (let x = Math.floor(g.x - g.radius - margin); x <= Math.ceil(g.x + g.radius + margin); x += 1) bytes.push(...pixelAt(decoded, x, y));
  }
  return bytes;
}
function assertBall(decoded, ball, completed) {
  const g = geometry(decoded, ball); const expectedFill = completed ? COMPLETED_FILL : NEUTRAL_FILL;
  assert.ok(distance(pixelAt(decoded, g.x + g.radius * 0.7, g.y), expectedFill) <= 5);
  const outline = pixelAt(decoded, g.x + g.radius - 1.5, g.y);
  assert.ok(distance(outline, DARK) <= 25, `${completed ? 'completed' : 'neutral'} outline for ${ball.order}`);
  let light = 0; let dark = 0; let blended = 0; const colors = new Set();
  for (let y = Math.floor(g.y - g.radius - 3); y <= Math.ceil(g.y + g.radius + 3); y += 1) {
    for (let x = Math.floor(g.x - g.radius - 3); x <= Math.ceil(g.x + g.radius + 3); x += 1) {
      const p = pixelAt(decoded, x, y); colors.add(p.slice(0, 3).join(',')); const d = Math.hypot(x - g.x, y - g.y);
      if (d >= g.radius - 2 && d <= g.radius + 2 && distance(p, expectedFill) > 8 && distance(p, DARK) > 8) blended += 1;
      if (Math.abs(x - g.x) <= g.radius * 0.28 && Math.abs(y - g.y) <= g.radius * 0.36) {
        if (p[0] >= 238 && p[1] >= 238 && p[2] >= 238) light += 1;
        if (p[0] <= 38 && p[1] <= 38 && p[2] <= 46) dark += 1;
      }
    }
  }
  assert.ok(light >= 18, `clear number ${ball.order}`); assert.ok(dark >= 50, `pentagon ${ball.order}`); assert.ok(blended >= 8); assert.ok(colors.size >= 30);
  const near = pixelAt(decoded, g.x + g.radius + 5, g.y + 2); const far = pixelAt(decoded, g.x + g.radius + 28, g.y + 2);
  assert.ok(near[0] < far[0] || near[1] < far[1] || near[2] < far[2], 'dark shadow');
}
function assertPitch(decoded) {
  const a = pixelAt(decoded, 2, 2); const b = pixelAt(decoded, decoded.width - 3, decoded.height - 3);
  assert.ok(a[0] > a[2] * 2); assert.ok(b[2] > b[0] * 2);
  const line = pixelAt(decoded, 18, 18); assert.ok(line[0] > a[0] || line[1] > a[1] || line[2] > a[2]);
}

test('publishes the historical football contract without a next-target cue', () => {
  assert.deepEqual(HUMAN_CHECK_RASTER, {
    width: 560, height: 360, ballCount: 4, radiusPercent: 8, minimumDistancePercent: 26,
    antialiasWidth: 1, shadowBlur: 12,
    style: {
      pitchStart: [98, 0, 25, 255], pitchMiddle: [16, 18, 26, 255], pitchEnd: [18, 48, 95, 255], fieldLine: [255, 255, 255, 34],
      neutralFill: [247, 248, 251, 255], completedFill: [84, 209, 139, 255], outline: [17, 21, 29, 255],
      neutralNumber: [255, 255, 255, 255], completedNumber: [255, 255, 255, 255],
    },
  });
});

test('creates immutable separated layouts with secure and bounded randomness', () => {
  const balls = fixedLayout(); assert.deepEqual(balls.map(({ order }) => order), [1, 2, 3, 4]); assert.ok(balls.every(({ radius }) => radius === 8)); assertSeparated(balls);
  assert.throws(() => balls.push({}), TypeError); assert.throws(() => { balls[0].x = 50; }, TypeError);
  const secure = createHumanCheckLayout(); assert.ok(secure.every(({ x, y }) => x >= 14 && x <= 86 && y >= 18 && y <= 82)); assertSeparated(secure);
  assert.throws(() => createHumanCheckLayout(null), /random/);
  const fallback = createHumanCheckLayout(() => Number.NaN); assert.equal(fallback.length, 4);
  const clamped = createHumanCheckLayout(sequence([-100, 100, 100, -100, -100, -100, 100, 100])); assert.equal(clamped.length, 4); assertSeparated(clamped);
});

test('renders deterministic white pending and green confirmed states without revealing the next ball', async () => {
  const balls = fixedLayout(); const states = [];
  for (let selectedCount = 0; selectedCount <= 4; selectedCount += 1) {
    const raster = await renderHumanCheckRaster(balls, { selectedCount }); const repeated = await renderHumanCheckRaster(balls, { selectedCount });
    assert.equal(raster.digest, repeated.digest); assert.deepEqual(raster.bytes, repeated.bytes); assert.match(raster.dataUrl, /^data:image\/png;base64,/);
    const decoded = decodeRgbaPng(raster.bytes); assertPitch(decoded);
    balls.forEach((ball, index) => assertBall(decoded, ball, index < selectedCount));
    states.push({ raster, decoded });
  }
  assert.equal(new Set(states.map(({ raster }) => raster.digest)).size, 5);
  for (let progress = 1; progress <= 4; progress += 1) {
    const previous = states[progress - 1].decoded; const current = states[progress].decoded;
    assert.notDeepEqual(crop(previous, balls[progress - 1]), crop(current, balls[progress - 1]));
    for (let unchanged = progress; unchanged < balls.length; unchanged += 1) {
      assert.deepEqual(crop(previous, balls[unchanged]), crop(current, balls[unchanged]), `progress ${progress} must not change pending ball ${unchanged + 1}`);
    }
  }
});

test('renders all bounded sizes and rejects malformed contracts', async () => {
  const balls = fixedLayout();
  for (const options of [{ width: 1, height: 1, selectedCount: 2 }, { selectedCount: 2 }, { width: 9999, height: 9999, selectedCount: 2 }]) {
    const raster = await renderHumanCheckRaster(balls, options); assert.equal(raster.mediaType, 'image/png'); assert.match(raster.digest, /^[a-f0-9]{64}$/);
    const decoded = decodeRgbaPng(raster.bytes); assertPitch(decoded); balls.forEach((ball, index) => assertBall(decoded, ball, index < 2));
  }
  await assert.rejects(() => renderHumanCheckRaster(null), /exactly 4 balls/); await assert.rejects(() => renderHumanCheckRaster([]), /exactly 4 balls/);
  for (const selectedCount of [-1, 5, 1.5, 'invalid']) await assert.rejects(() => renderHumanCheckRaster(balls, { selectedCount }), /selectedCount/);
  const edges = [{ order: 1, x: 0, y: 0, radius: 8 }, { order: 2, x: 100, y: 0, radius: 8 }, { order: 3, x: 0, y: 100, radius: 8 }, { order: 4, x: 100, y: 100, radius: 8 }];
  const edge = decodeRgbaPng((await renderHumanCheckRaster(edges, { width: 320, height: 200, selectedCount: 4 })).bytes); assert.equal(edge.width, 320); assert.equal(edge.height, 220);
  await assert.rejects(() => renderHumanCheckRaster([{ order: 5, x: 20, y: 20, radius: 8 }, ...edges.slice(1)]), /Unsupported digit/);
});
