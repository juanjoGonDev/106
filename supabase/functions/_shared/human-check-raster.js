const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const WIDTH = 480;
const HEIGHT = 300;
const BALL_COUNT = 4;
const BALL_RADIUS_PERCENT = 8;
const MINIMUM_DISTANCE_PERCENT = 26;
const NUMBER_BADGE_RADIUS_RATIO = 0.68;
const FALLBACK_LAYOUT = Object.freeze([
  Object.freeze({ x: 78, y: 72 }),
  Object.freeze({ x: 20, y: 75 }),
  Object.freeze({ x: 80, y: 25 }),
  Object.freeze({ x: 22, y: 28 }),
]);
const DIGITS = Object.freeze({
  1: Object.freeze(['01110', '00110', '00110', '00110', '00110', '00110', '11111']),
  2: Object.freeze(['11110', '00001', '00001', '01110', '10000', '10000', '11111']),
  3: Object.freeze(['11110', '00001', '00001', '01110', '00001', '00001', '11110']),
  4: Object.freeze(['10010', '10010', '10010', '11111', '00010', '00010', '00010']),
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

function setPixel(pixels, width, height, x, y, red, green, blue, alpha = 255) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  pixels[offset] = clampByte(red);
  pixels[offset + 1] = clampByte(green);
  pixels[offset + 2] = clampByte(blue);
  pixels[offset + 3] = clampByte(alpha);
}

function fillRect(pixels, width, height, left, top, rectWidth, rectHeight, color) {
  const startX = Math.max(0, Math.floor(left));
  const startY = Math.max(0, Math.floor(top));
  const endX = Math.min(width, Math.ceil(left + rectWidth));
  const endY = Math.min(height, Math.ceil(top + rectHeight));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      setPixel(pixels, width, height, x, y, ...color);
    }
  }
}

function drawLine(pixels, width, height, x1, y1, x2, y2, thickness, color) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const radius = Math.max(0, Math.floor(thickness / 2));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = x1 + (x2 - x1) * ratio;
    const y = y1 + (y2 - y1) * ratio;
    fillRect(pixels, width, height, x - radius, y - radius, radius * 2 + 1, radius * 2 + 1, color);
  }
}

function drawCircle(pixels, width, height, centerX, centerY, radius, color) {
  const minX = Math.floor(centerX - radius);
  const maxX = Math.ceil(centerX + radius);
  const minY = Math.floor(centerY - radius);
  const maxY = Math.ceil(centerY + radius);
  const squaredRadius = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= squaredRadius) {
        setPixel(pixels, width, height, x, y, ...color);
      }
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
      if (distance <= outer && distance >= inner) {
        setPixel(pixels, width, height, x, y, ...color);
      }
    }
  }
}

function drawDigit(pixels, width, height, digit, centerX, centerY, scale, color) {
  const rows = DIGITS[digit];
  if (!rows) throw new RangeError(`Unsupported digit: ${digit}`);
  const glyphWidth = rows[0].length * scale;
  const glyphHeight = rows.length * scale;
  const left = Math.round(centerX - glyphWidth / 2);
  const top = Math.round(centerY - glyphHeight / 2);
  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell === '1') {
        fillRect(
          pixels,
          width,
          height,
          left + columnIndex * scale,
          top + rowIndex * scale,
          scale,
          scale,
          color,
        );
      }
    });
  });
}

function drawPitch(pixels, width, height) {
  for (let y = 0; y < height; y += 1) {
    const ratio = y / Math.max(1, height - 1);
    fillRect(pixels, width, height, 0, y, width, 1, [30 + ratio * 12, 58 + ratio * 28, 45 + ratio * 15, 255]);
  }
  const white = [235, 245, 240, 210];
  drawLine(pixels, width, height, 16, 16, width - 16, 16, 2, white);
  drawLine(pixels, width, height, width - 16, 16, width - 16, height - 16, 2, white);
  drawLine(pixels, width, height, width - 16, height - 16, 16, height - 16, 2, white);
  drawLine(pixels, width, height, 16, height - 16, 16, 16, 2, white);
  drawLine(pixels, width, height, width / 2, 16, width / 2, height - 16, 2, white);
  drawRing(pixels, width, height, width / 2, height / 2, Math.min(width, height) * 0.13, 2, white);
}

function drawBall(pixels, width, height, ball) {
  const centerX = width * Number(ball.x) / 100;
  const centerY = height * Number(ball.y) / 100;
  const radius = Math.max(24, Math.min(36, width * Number(ball.radius) / 100));
  const badgeRadius = radius * NUMBER_BADGE_RADIUS_RATIO;
  const digitScale = Math.max(3, Math.floor(radius / 7));
  drawCircle(pixels, width, height, centerX + 3, centerY + 4, radius + 3, [0, 0, 0, 70]);
  drawCircle(pixels, width, height, centerX, centerY, radius, [247, 248, 251, 255]);
  drawRing(pixels, width, height, centerX, centerY, radius, 3, [17, 21, 29, 255]);
  drawCircle(pixels, width, height, centerX, centerY, badgeRadius, [17, 21, 29, 255]);
  drawDigit(pixels, width, height, Number(ball.order), centerX, centerY, digitScale, [255, 255, 255, 255]);
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
  const width = Math.max(320, Math.min(640, Math.round(Number(options.width) || WIDTH)));
  const height = Math.max(200, Math.min(480, Math.round(Number(options.height) || HEIGHT)));
  const pixels = new Uint8Array(width * height * 4);
  drawPitch(pixels, width, height);
  for (const ball of balls) drawBall(pixels, width, height, ball);

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
});
