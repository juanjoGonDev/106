import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHumanCheckLayout,
  HUMAN_CHECK_RASTER,
  renderHumanCheckRaster,
} from '../supabase/functions/_shared/human-check-raster.js';

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
  const balls = createHumanCheckLayout(sequence([
    0.05, 0.10,
    0.95, 0.10,
    0.05, 0.90,
    0.95, 0.90,
  ]));
  assert.equal(balls.length, 4);
  assert.deepEqual(balls.map((ball) => ball.order), [1, 2, 3, 4]);
  assert.ok(balls.every((ball) => ball.radius === 8));
  assertSeparated(balls);
  assert.throws(() => balls.push({}), TypeError);
  assert.throws(() => { balls[0].x = 50; }, TypeError);
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
  const balls = createHumanCheckLayout(sequence([
    0.05, 0.10,
    0.95, 0.10,
    0.05, 0.90,
    0.95, 0.90,
  ]));
  const first = await renderHumanCheckRaster(balls);
  const second = await renderHumanCheckRaster(balls);

  assert.equal(first.mediaType, 'image/png');
  assert.equal(first.width, 480);
  assert.equal(first.height, 300);
  assert.deepEqual([...first.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(first.dataUrl, /^data:image\/png;base64,/);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.bytes, second.bytes);

  const minimum = await renderHumanCheckRaster(balls, { width: 1, height: 1 });
  assert.equal(minimum.width, 320);
  assert.equal(minimum.height, 200);

  const maximum = await renderHumanCheckRaster(balls, { width: 9999, height: 9999 });
  assert.equal(maximum.width, 640);
  assert.equal(maximum.height, 480);
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
