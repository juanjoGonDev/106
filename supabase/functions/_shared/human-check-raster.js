const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const WIDTH = 560;
const HEIGHT = 360;
const BALL_COUNT = 4;
const BALL_RADIUS_PERCENT = 8;
const MINIMUM_DISTANCE_PERCENT = 26;
const SUPERSAMPLE = 3;
const FALLBACK_LAYOUT = Object.freeze([
  Object.freeze({ x: 78, y: 72 }),
  Object.freeze({ x: 20, y: 75 }),
  Object.freeze({ x: 80, y: 25 }),
  Object.freeze({ x: 22, y: 28 }),
]);
const LEGACY_STYLE = Object.freeze({
  pitchStart: Object.freeze([98, 0, 25, 255]),
  pitchMiddle: Object.freeze([16, 18, 26, 255]),
  pitchEnd: Object.freeze([18, 48, 95, 255]),
  fieldLine: Object.freeze([255, 255, 255, 34]),
  neutralFill: Object.freeze([247, 248, 251, 255]),
  completedFill: Object.freeze([84, 209, 139, 255]),
  outline: Object.freeze([17, 21, 29, 255]),
  neutralNumber: Object.freeze([255, 255, 255, 255]),
  completedNumber: Object.freeze([255, 255, 255, 255]),
});

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 255;
  target[offset + 1] = (value >>> 16) & 255;
  target[offset + 2] = (value >>> 8) & 255;
  target[offset + 3] = value & 255;
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const payload = concatBytes([typeBytes, data]);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(payload));
  return chunk;
}

function blendPixel(pixels, width, height, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const sourceAlpha = clampByte(color[3]) / 255;
  const inverse = 1 - sourceAlpha;
  pixels[offset] = clampByte(color[0] * sourceAlpha + pixels[offset] * inverse);
  pixels[offset + 1] = clampByte(color[1] * sourceAlpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = clampByte(color[2] * sourceAlpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = 255;
}

function drawCircle(pixels, width, height, centerX, centerY, radius, color) {
  const minimumX = Math.floor(centerX - radius);
  const maximumX = Math.ceil(centerX + radius);
  const minimumY = Math.floor(centerY - radius);
  const maximumY = Math.ceil(centerY + radius);
  const squaredRadius = radius * radius;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= squaredRadius) blendPixel(pixels, width, height, x, y, color);
    }
  }
}

function drawRing(pixels, width, height, centerX, centerY, radius, thickness, color) {
  const outer = radius * radius;
  const innerRadius = Math.max(0, radius - thickness);
  const inner = innerRadius * innerRadius;
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = dx * dx + dy * dy;
      if (distance <= outer && distance >= inner) blendPixel(pixels, width, height, x, y, color);
    }
  }
}

function drawRoundLine(pixels, width, height, x1, y1, x2, y2, thickness, color) {
  const radius = Math.max(0.5, thickness / 2);
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    drawCircle(
      pixels,
      width,
      height,
      x1 + (x2 - x1) * ratio,
      y1 + (y2 - y1) * ratio,
      radius,
      color,
    );
  }
}

function drawPolyline(pixels, width, height, points, thickness, color) {
  for (let index = 1; index < points.length; index += 1) {
    drawRoundLine(
      pixels,
      width,
      height,
      points[index - 1].x,
      points[index - 1].y,
      points[index].x,
      points[index].y,
      thickness,
      color,
    );
  }
}

function pointInsidePolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const currentPoint = points[current];
    const previousPoint = points[previous];
    const crosses = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function fillPolygon(pixels, width, height, points, color) {
  const minimumX = Math.floor(Math.min(...points.map((point) => point.x)));
  const maximumX = Math.ceil(Math.max(...points.map((point) => point.x)));
  const minimumY = Math.floor(Math.min(...points.map((point) => point.y)));
  const maximumY = Math.ceil(Math.max(...points.map((point) => point.y)));
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (pointInsidePolygon(x + 0.5, y + 0.5, points)) blendPixel(pixels, width, height, x, y, color);
    }
  }
}

function drawPentagon(pixels, width, height, centerX, centerY, radius, color) {
  const points = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }
  fillPolygon(pixels, width, height, points, color);
}

function digitPaths(digit, centerX, centerY, radius) {
  const x = (value) => centerX + value * radius;
  const y = (value) => centerY + value * radius;
  if (digit === 1) {
    return [
      [{ x: x(-0.13), y: y(-0.22) }, { x: x(0.03), y: y(-0.33) }, { x: x(0.03), y: y(0.28) }],
      [{ x: x(-0.13), y: y(0.28) }, { x: x(0.18), y: y(0.28) }],
    ];
  }
  if (digit === 2) {
    return [[
      { x: x(-0.19), y: y(-0.20) },
      { x: x(-0.10), y: y(-0.31) },
      { x: x(0.12), y: y(-0.31) },
      { x: x(0.21), y: y(-0.20) },
      { x: x(0.18), y: y(-0.07) },
      { x: x(-0.18), y: y(0.21) },
      { x: x(-0.18), y: y(0.28) },
      { x: x(0.21), y: y(0.28) },
    ]];
  }
  if (digit === 3) {
    return [
      [
        { x: x(-0.18), y: y(-0.24) },
        { x: x(-0.08), y: y(-0.31) },
        { x: x(0.13), y: y(-0.31) },
        { x: x(0.21), y: y(-0.21) },
        { x: x(0.17), y: y(-0.06) },
        { x: x(0.05), y: y(0) },
      ],
      [
        { x: x(0.05), y: y(0) },
        { x: x(0.17), y: y(0.06) },
        { x: x(0.21), y: y(0.20) },
        { x: x(0.13), y: y(0.30) },
        { x: x(-0.09), y: y(0.30) },
        { x: x(-0.19), y: y(0.22) },
      ],
      [{ x: x(-0.08), y: y(0) }, { x: x(0.08), y: y(0) }],
    ];
  }
  if (digit === 4) {
    return [
      [{ x: x(0.13), y: y(-0.32) }, { x: x(0.13), y: y(0.31) }],
      [{ x: x(-0.18), y: y(-0.08) }, { x: x(-0.18), y: y(0.04) }, { x: x(0.22), y: y(0.04) }],
      [{ x: x(-0.18), y: y(-0.08) }, { x: x(0.05), y: y(-0.32) }],
    ];
  }
  throw new RangeError(`Unsupported digit: ${digit}`);
}

function drawDigit(pixels, width, height, digit, centerX, centerY, radius, color) {
  const thickness = Math.max(2.8 * SUPERSAMPLE, radius * 0.105);
  for (const path of digitPaths(digit, centerX, centerY, radius)) {
    drawPolyline(pixels, width, height, path, thickness, color);
  }
}

function interpolateColor(from, to, ratio) {
  return from.map((value, index) => value + (to[index] - value) * ratio);
}

function drawPitch(pixels, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const diagonal = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
      const firstSegment = diagonal <= 0.48;
      const ratio = firstSegment ? diagonal / 0.48 : (diagonal - 0.48) / 0.52;
      const color = firstSegment
        ? interpolateColor(LEGACY_STYLE.pitchStart, LEGACY_STYLE.pitchMiddle, ratio)
        : interpolateColor(LEGACY_STYLE.pitchMiddle, LEGACY_STYLE.pitchEnd, ratio);
      const offset = (y * width + x) * 4;
      pixels[offset] = clampByte(color[0]);
      pixels[offset + 1] = clampByte(color[1]);
      pixels[offset + 2] = clampByte(color[2]);
      pixels[offset + 3] = 255;
    }
  }

  const margin = 18 * SUPERSAMPLE;
  const thickness = 2 * SUPERSAMPLE;
  drawRoundLine(pixels, width, height, margin, margin, width - margin, margin, thickness, LEGACY_STYLE.fieldLine);
  drawRoundLine(pixels, width, height, width - margin, margin, width - margin, height - margin, thickness, LEGACY_STYLE.fieldLine);
  drawRoundLine(pixels, width, height, width - margin, height - margin, margin, height - margin, thickness, LEGACY_STYLE.fieldLine);
  drawRoundLine(pixels, width, height, margin, height - margin, margin, margin, thickness, LEGACY_STYLE.fieldLine);
  drawRoundLine(pixels, width, height, width / 2, margin, width / 2, height - margin, thickness, LEGACY_STYLE.fieldLine);
  drawRing(
    pixels,
    width,
    height,
    width / 2,
    height / 2,
    Math.min(width, height) * 0.13,
    thickness,
    LEGACY_STYLE.fieldLine,
  );
}

function drawLegacyShadow(pixels, width, height, centerX, centerY, radius) {
  const blur = 12 * SUPERSAMPLE;
  const layers = 12;
  for (let layer = layers; layer >= 1; layer -= 1) {
    const ratio = layer / layers;
    const alpha = Math.round(20 * (1 - ratio) + 5);
    drawCircle(
      pixels,
      width,
      height,
      centerX,
      centerY,
      radius + blur * ratio,
      [0, 0, 0, alpha],
    );
  }
}

function drawBall(pixels, width, height, ball, completed) {
  const logicalWidth = width / SUPERSAMPLE;
  const logicalHeight = height / SUPERSAMPLE;
  const centerX = logicalWidth * Number(ball.x) / 100 * SUPERSAMPLE;
  const centerY = logicalHeight * Number(ball.y) / 100 * SUPERSAMPLE;
  const logicalRadius = Math.max(25, Math.min(38, logicalWidth * Number(ball.radius) / 100));
  const radius = logicalRadius * SUPERSAMPLE;
  const fill = completed ? LEGACY_STYLE.completedFill : LEGACY_STYLE.neutralFill;
  const number = completed ? LEGACY_STYLE.completedNumber : LEGACY_STYLE.neutralNumber;

  drawLegacyShadow(pixels, width, height, centerX, centerY, radius);
  drawCircle(pixels, width, height, centerX, centerY, radius, fill);
  drawRing(pixels, width, height, centerX, centerY, radius, 3 * SUPERSAMPLE, LEGACY_STYLE.outline);
  drawPentagon(pixels, width, height, centerX, centerY, radius * 0.34, LEGACY_STYLE.outline);
  drawDigit(
    pixels,
    width,
    height,
    Number(ball.order),
    centerX,
    centerY + SUPERSAMPLE,
    radius,
    number,
  );
}

function downsample(source, sourceWidth, sourceHeight, scale) {
  const width = Math.floor(sourceWidth / scale);
  const height = Math.floor(sourceHeight / scale);
  const result = new Uint8Array(width * height * 4);
  const samples = scale * scale;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceOffset = (((y * scale + sampleY) * sourceWidth) + x * scale + sampleX) * 4;
          totals[0] += source[sourceOffset];
          totals[1] += source[sourceOffset + 1];
          totals[2] += source[sourceOffset + 2];
          totals[3] += source[sourceOffset + 3];
        }
      }
      const targetOffset = (y * width + x) * 4;
      result[targetOffset] = clampByte(totals[0] / samples);
      result[targetOffset + 1] = clampByte(totals[1] / samples);
      result[targetOffset + 2] = clampByte(totals[2] / samples);
      result[targetOffset + 3] = clampByte(totals[3] / samples);
    }
  }
  return result;
}

function normalizeRandom(randomValue) {
  const number = Number(randomValue);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(0.999999, number));
}

function secureUnitRandom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function normalizeSelectedCount(value) {
  const selectedCount = Number(value ?? 0);
  if (!Number.isInteger(selectedCount) || selectedCount < 0 || selectedCount > BALL_COUNT) {
    throw new RangeError(`selectedCount must be an integer between 0 and ${BALL_COUNT}`);
  }
  return selectedCount;
}

export function createHumanCheckLayout(random = secureUnitRandom) {
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  const balls = [];
  for (let order = 1; order <= BALL_COUNT; order += 1) {
    let candidate = FALLBACK_LAYOUT[order - 1];
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const proposed = {
        x: 14 + normalizeRandom(random()) * 72,
        y: 18 + normalizeRandom(random()) * 64,
      };
      const separated = balls.every((ball) => Math.hypot(ball.x - proposed.x, ball.y - proposed.y) >= MINIMUM_DISTANCE_PERCENT);
      if (separated) {
        candidate = proposed;
        break;
      }
    }
    balls.push(Object.freeze({
      order,
      x: Number(candidate.x.toFixed(2)),
      y: Number(candidate.y.toFixed(2)),
      radius: BALL_RADIUS_PERCENT,
    }));
  }
  return Object.freeze(balls);
}

async function compressDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function renderHumanCheckRaster(balls, options = {}) {
  if (!Array.isArray(balls) || balls.length !== BALL_COUNT) {
    throw new TypeError(`Expected exactly ${BALL_COUNT} balls`);
  }
  const selectedCount = normalizeSelectedCount(options.selectedCount);
  const width = Math.max(320, Math.min(640, Math.round(Number(options.width) || WIDTH)));
  const height = Math.max(220, Math.min(480, Math.round(Number(options.height) || HEIGHT)));
  const renderWidth = width * SUPERSAMPLE;
  const renderHeight = height * SUPERSAMPLE;
  const supersampled = new Uint8Array(renderWidth * renderHeight * 4);
  drawPitch(supersampled, renderWidth, renderHeight);
  balls.forEach((ball, index) => drawBall(
    supersampled,
    renderWidth,
    renderHeight,
    ball,
    index < selectedCount,
  ));
  const pixels = downsample(supersampled, renderWidth, renderHeight, SUPERSAMPLE);

  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (width * 4 + 1);
    scanlines[scanlineOffset] = 0;
    scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), scanlineOffset + 1);
  }

  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8;
  header[9] = 6;
  const compressed = await compressDeflate(scanlines);
  const png = concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array()),
  ]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', png));
  return Object.freeze({
    mediaType: 'image/png',
    width,
    height,
    bytes: png,
    dataUrl: `data:image/png;base64,${toBase64(png)}`,
    digest: toHex(digest),
  });
}

export const HUMAN_CHECK_RASTER = Object.freeze({
  width: WIDTH,
  height: HEIGHT,
  ballCount: BALL_COUNT,
  radiusPercent: BALL_RADIUS_PERCENT,
  minimumDistancePercent: MINIMUM_DISTANCE_PERCENT,
  supersample: SUPERSAMPLE,
  style: LEGACY_STYLE,
});
