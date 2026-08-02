const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const WIDTH = 560;
const HEIGHT = 360;
const BALL_COUNT = 4;
const BALL_RADIUS_PERCENT = 8;
const MINIMUM_DISTANCE_PERCENT = 26;
const ANTIALIAS_WIDTH = 1;
const SHADOW_BLUR = 12;
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

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
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

function blendColor(pixels, width, height, x, y, color, coverage = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const sourceAlpha = clampUnit(coverage) * clampByte(color[3]) / 255;
  const inverse = 1 - sourceAlpha;
  pixels[offset] = clampByte(color[0] * sourceAlpha + pixels[offset] * inverse);
  pixels[offset + 1] = clampByte(color[1] * sourceAlpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = clampByte(color[2] * sourceAlpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = 255;
}

function circleCoverage(distance, radius) {
  return clampUnit(radius + ANTIALIAS_WIDTH / 2 - distance);
}

function drawCircle(pixels, width, height, centerX, centerY, radius, color) {
  const extent = radius + ANTIALIAS_WIDTH;
  for (let y = Math.floor(centerY - extent); y <= Math.ceil(centerY + extent); y += 1) {
    for (let x = Math.floor(centerX - extent); x <= Math.ceil(centerX + extent); x += 1) {
      const coverage = circleCoverage(Math.hypot(x - centerX, y - centerY), radius);
      if (coverage > 0) blendColor(pixels, width, height, x, y, color, coverage);
    }
  }
}

function drawRing(pixels, width, height, centerX, centerY, radius, thickness, color) {
  const extent = radius + ANTIALIAS_WIDTH;
  const innerRadius = radius - thickness;
  for (let y = Math.floor(centerY - extent); y <= Math.ceil(centerY + extent); y += 1) {
    for (let x = Math.floor(centerX - extent); x <= Math.ceil(centerX + extent); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      const outerCoverage = circleCoverage(distance, radius);
      const innerCoverage = clampUnit(distance - innerRadius + ANTIALIAS_WIDTH / 2);
      const coverage = Math.min(outerCoverage, innerCoverage);
      if (coverage > 0) blendColor(pixels, width, height, x, y, color, coverage);
    }
  }
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const lengthSquared = Math.max(Number.EPSILON, deltaX * deltaX + deltaY * deltaY);
  const ratio = clampUnit(((x - x1) * deltaX + (y - y1) * deltaY) / lengthSquared);
  return Math.hypot(x - (x1 + deltaX * ratio), y - (y1 + deltaY * ratio));
}

function drawRoundLine(pixels, width, height, x1, y1, x2, y2, thickness, color) {
  const radius = thickness / 2;
  const extent = radius + ANTIALIAS_WIDTH;
  const minimumX = Math.floor(Math.min(x1, x2) - extent);
  const maximumX = Math.ceil(Math.max(x1, x2) + extent);
  const minimumY = Math.floor(Math.min(y1, y2) - extent);
  const maximumY = Math.ceil(Math.max(y1, y2) + extent);
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const coverage = clampUnit(radius + ANTIALIAS_WIDTH / 2 - distanceToSegment(x, y, x1, y1, x2, y2));
      if (coverage > 0) blendColor(pixels, width, height, x, y, color, coverage);
    }
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

function polygonCoverage(x, y, points) {
  const samples = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  let inside = 0;
  for (const [offsetX, offsetY] of samples) {
    if (pointInsidePolygon(x + offsetX, y + offsetY, points)) inside += 1;
  }
  return inside / samples.length;
}

function fillPolygon(pixels, width, height, points, color) {
  const minimumX = Math.floor(Math.min(...points.map((point) => point.x)));
  const maximumX = Math.ceil(Math.max(...points.map((point) => point.x)));
  const minimumY = Math.floor(Math.min(...points.map((point) => point.y)));
  const maximumY = Math.ceil(Math.max(...points.map((point) => point.y)));
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const coverage = polygonCoverage(x, y, points);
      if (coverage > 0) blendColor(pixels, width, height, x, y, color, coverage);
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
  const thickness = Math.max(2.8, radius * 0.105);
  for (const path of digitPaths(digit, centerX, centerY, radius)) {
    drawPolyline(pixels, width, height, path, thickness, color);
  }
}

function drawPitch(pixels, width, height) {
  const widthScale = Math.max(1, width - 1);
  const heightScale = Math.max(1, height - 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const diagonal = (x / widthScale + y / heightScale) / 2;
      const firstSegment = diagonal <= 0.48;
      const ratio = firstSegment ? diagonal / 0.48 : (diagonal - 0.48) / 0.52;
      const from = firstSegment ? LEGACY_STYLE.pitchStart : LEGACY_STYLE.pitchMiddle;
      const to = firstSegment ? LEGACY_STYLE.pitchMiddle : LEGACY_STYLE.pitchEnd;
      const offset = (y * width + x) * 4;
      pixels[offset] = clampByte(from[0] + (to[0] - from[0]) * ratio);
      pixels[offset + 1] = clampByte(from[1] + (to[1] - from[1]) * ratio);
      pixels[offset + 2] = clampByte(from[2] + (to[2] - from[2]) * ratio);
      pixels[offset + 3] = 255;
    }
  }

  const margin = 18;
  const thickness = 2;
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
  const extent = radius + SHADOW_BLUR;
  for (let y = Math.floor(centerY - extent); y <= Math.ceil(centerY + extent); y += 1) {
    for (let x = Math.floor(centerX - extent); x <= Math.ceil(centerX + extent); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      const progress = clampUnit((distance - radius) / SHADOW_BLUR);
      const coverage = distance <= radius + SHADOW_BLUR ? (1 - progress) ** 2 : 0;
      if (coverage > 0) blendColor(pixels, width, height, x, y, [0, 0, 0, 153], coverage);
    }
  }
}

function drawBall(pixels, width, height, ball, completed) {
  const centerX = width * Number(ball.x) / 100;
  const centerY = height * Number(ball.y) / 100;
  const radius = Math.max(25, Math.min(38, width * Number(ball.radius) / 100));
  const fill = completed ? LEGACY_STYLE.completedFill : LEGACY_STYLE.neutralFill;
  const number = completed ? LEGACY_STYLE.completedNumber : LEGACY_STYLE.neutralNumber;

  drawLegacyShadow(pixels, width, height, centerX, centerY, radius);
  drawCircle(pixels, width, height, centerX, centerY, radius, fill);
  drawRing(pixels, width, height, centerX, centerY, radius, 3, LEGACY_STYLE.outline);
  drawPentagon(pixels, width, height, centerX, centerY, radius * 0.34, LEGACY_STYLE.outline);
  drawDigit(pixels, width, height, Number(ball.order), centerX, centerY + 1, radius, number);
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
  const pixels = new Uint8Array(width * height * 4);
  drawPitch(pixels, width, height);
  balls.forEach((ball, index) => drawBall(pixels, width, height, ball, index < selectedCount));

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
  antialiasWidth: ANTIALIAS_WIDTH,
  shadowBlur: SHADOW_BLUR,
  style: LEGACY_STYLE,
});
