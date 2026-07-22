import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import process from 'node:process';

const WIDTH = 1200;
const HEIGHT = 630;
const ROOT = process.cwd();
const OUTPUTS = [
  resolve(ROOT, 'public/assets/social-preview-v2.png'),
  resolve(ROOT, 'assets/social-preview-v2.png'),
  resolve(ROOT, 'public/public/assets/social-preview-v2.png'),
  resolve(ROOT, 'public/assets/social-preview.png'),
  resolve(ROOT, 'assets/social-preview.png'),
  resolve(ROOT, 'public/public/assets/social-preview.png'),
];
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'Ñ': ['01010','00100','10001','11001','10101','10011','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  ':': ['00000','01100','01100','00000','01100','01100','00000'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '¿': ['00100','00000','00100','01000','10000','10001','01110'],
  '·': ['00000','00000','00100','00100','00000','00000','00000'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
};

function rgba(hex, alpha = 255) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

function blendPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inverse);
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inverse);
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inverse);
  pixels[index + 3] = 255;
}

function fillRect(x, y, width, height, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(WIDTH, Math.ceil(x + width));
  const y1 = Math.min(HEIGHT, Math.ceil(y + height));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) blendPixel(px, py, color);
  }
}

function fillGradient() {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const centre = 1 - Math.min(1, Math.abs(x - WIDTH / 2) / (WIDTH / 2));
      const vertical = y / HEIGHT;
      const red = x < WIDTH / 2 ? 28 + Math.round((1 - x / (WIDTH / 2)) * 50) : 6;
      const blue = x >= WIDTH / 2 ? 30 + Math.round(((x - WIDTH / 2) / (WIDTH / 2)) * 45) : 12;
      const glow = Math.round(centre * 18 * (1 - vertical));
      const index = (y * WIDTH + x) * 4;
      pixels[index] = Math.min(255, red + glow);
      pixels[index + 1] = 8 + glow;
      pixels[index + 2] = Math.min(255, blue + glow);
      pixels[index + 3] = 255;
    }
  }
}

function fillCircle(cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) blendPixel(x, y, color);
    }
  }
}

function line(x0, y0, x1, y1, thickness, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, color);
  }
}

function polygon(points, color) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) fillRect(intersections[i], y, intersections[i + 1] - intersections[i], 1, color);
  }
}

function roundedRect(x, y, width, height, radius, color, borderColor = null, border = 0) {
  fillRect(x + radius, y, width - radius * 2, height, color);
  fillRect(x, y + radius, width, height - radius * 2, color);
  fillCircle(x + radius, y + radius, radius, color);
  fillCircle(x + width - radius, y + radius, radius, color);
  fillCircle(x + radius, y + height - radius, radius, color);
  fillCircle(x + width - radius, y + height - radius, radius, color);
  if (borderColor && border > 0) {
    line(x + radius, y, x + width - radius, y, border, borderColor);
    line(x + radius, y + height, x + width - radius, y + height, border, borderColor);
    line(x, y + radius, x, y + height - radius, border, borderColor);
    line(x + width, y + radius, x + width, y + height - radius, border, borderColor);
  }
}

function textWidth(text, scale, spacing = 1) {
  return [...text].reduce((total, char) => total + ((FONT[char] ?? FONT['?'])[0].length + spacing) * scale, 0) - spacing * scale;
}

function drawText(text, x, y, scale, color, align = 'left', spacing = 1, shadow = true) {
  const width = textWidth(text, scale, spacing);
  const cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const drawPass = (offsetX, offsetY, passColor) => {
    let currentX = cursor;
    for (const char of text) {
      const glyph = FONT[char] ?? FONT['?'];
      glyph.forEach((row, glyphY) => {
        [...row].forEach((cell, glyphX) => {
          if (cell === '1') fillRect(currentX + glyphX * scale + offsetX, y + glyphY * scale + offsetY, scale, scale, passColor);
        });
      });
      currentX += (glyph[0].length + spacing) * scale;
    }
  };
  if (shadow) drawPass(Math.max(2, scale / 3), Math.max(2, scale / 3), [0, 0, 0, 150]);
  drawPass(0, 0, color);
}

function pseudoRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function drawPlayer(cx, teamColor, accent, mirror = 1) {
  fillCircle(cx, 220, 48, rgba('#05070d', 245));
  polygon([[cx - 108, 410], [cx - 82, 295], [cx - 35, 262], [cx + 35, 262], [cx + 82, 295], [cx + 108, 410]], teamColor);
  line(cx - 76, 300, cx - 145 * mirror, 366, 30, teamColor);
  line(cx + 76, 300, cx + 145 * mirror, 366, 30, teamColor);
  line(cx - 45, 278, cx - 82, 390, 4, accent);
  line(cx + 45, 278, cx + 82, 390, 4, accent);
  line(cx - 58, 306, cx + 58, 306, 5, accent);
}

fillGradient();
polygon([[0, 0], [540, 0], [440, 630], [0, 630]], rgba('#aa002b', 175));
polygon([[1200, 0], [660, 0], [760, 630], [1200, 630]], rgba('#1977ad', 175));
polygon([[0, 105], [505, 180], [477, 240], [0, 172]], rgba('#e4113d', 230));
polygon([[0, 172], [477, 240], [449, 300], [0, 237]], rgba('#ffd34a', 245));
polygon([[1200, 105], [695, 180], [723, 240], [1200, 172]], rgba('#64c9f5', 235));
polygon([[1200, 172], [723, 240], [751, 300], [1200, 237]], rgba('#f4f8fc', 245));
polygon([[0, 465], [600, 330], [1200, 465], [1200, 630], [0, 630]], rgba('#03050a', 250));
const random = pseudoRandom(106);
for (let index = 0; index < 950; index += 1) {
  const x = Math.floor(random() * WIDTH);
  const y = Math.floor(390 + random() * 150);
  const color = random() > 0.82 ? rgba('#f4c95d', 130) : rgba('#ffffff', 90);
  fillCircle(x, y, random() > 0.7 ? 1.5 : 1, color);
}
for (const x of [120, 1080]) {
  for (let radius = 100; radius > 8; radius -= 8) fillCircle(x, 260, radius, [255, 255, 255, Math.max(2, Math.round((105 - radius) / 10))]);
  roundedRect(x - 64, 251, 128, 18, 9, rgba('#ffffff', 190));
}
polygon([[170, 630], [465, 456], [735, 456], [1030, 630]], rgba('#073021', 230));
line(600, 456, 600, 630, 2, rgba('#d9f7e8', 70));
line(455, 535, 745, 535, 2, rgba('#d9f7e8', 70));
drawPlayer(235, rgba('#31000d', 245), rgba('#f14565', 210), 1);
drawPlayer(965, rgba('#07243e', 245), rgba('#6acdf7', 220), -1);
roundedRect(35, 28, 205, 50, 22, rgba('#05070d', 235), rgba('#f4c95d', 255), 3);
drawText('MINUTO 106', 137, 45, 3, rgba('#f4c95d'), 'center', 1, false);
drawText('ESPAÑA', 305, 87, 8, rgba('#ffd247'), 'center');
drawText('VS', 600, 91, 6, rgba('#ffffff'), 'center');
drawText('ARGENTINA', 895, 88, 6, rgba('#78d2fa'), 'center');
for (let radius = 184; radius >= 171; radius -= 1) fillCircle(600, 290, radius, rgba('#f4c95d', radius === 184 ? 65 : 10));
fillCircle(600, 290, 171, rgba('#05070d', 242));
for (let angle = 0; angle < 360; angle += 15) {
  const radians = (angle * Math.PI) / 180;
  const x1 = 600 + Math.cos(radians) * 148;
  const y1 = 290 + Math.sin(radians) * 148;
  const x2 = 600 + Math.cos(radians) * 159;
  const y2 = 290 + Math.sin(radians) * 159;
  line(x1, y1, x2, y2, angle % 45 === 0 ? 4 : 2, rgba('#f4c95d', 180));
}
roundedRect(568, 88, 64, 24, 5, rgba('#f4c95d'));
line(580, 80, 620, 80, 8, rgba('#f4c95d'));
drawText('OBJETIVO', 600, 165, 4, rgba('#dfe3eb'), 'center', 2);
drawText('10.600', 600, 231, 16, rgba('#ffffff'), 'center', 1);
drawText('SEGUNDOS EXACTOS', 600, 354, 3, rgba('#f4c95d'), 'center', 1);
roundedRect(88, 432, 1024, 158, 28, rgba('#05070d', 245), rgba('#ffffff', 40), 2);
drawText('¿PUEDES CLAVAR EL 10.600?', 600, 459, 5, rgba('#ffffff'), 'center', 1);
drawText('5 INTENTOS', 285, 521, 3, rgba('#edf0f6'), 'center');
fillCircle(430, 532, 4, rgba('#f4c95d'));
drawText('RANKING GLOBAL', 600, 521, 3, rgba('#edf0f6'), 'center');
fillCircle(770, 532, 4, rgba('#f4c95d'));
drawText('MINILIGAS', 915, 521, 3, rgba('#edf0f6'), 'center');
roundedRect(420, 554, 360, 58, 25, rgba('#f4bd32'), rgba('#ffe28a'), 3);
drawText('JUEGA AHORA', 600, 570, 5, rgba('#07080b'), 'center', 1, false);
drawText('JUANJOGONDEV.GITHUB.IO/106', 1160, 608, 1, rgba('#d9dde6', 225), 'right', 1, false);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng() {
  const rows = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * (WIDTH * 4 + 1);
    rows[row] = 0;
    pixels.copy(rows, row + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = encodePng();
for (const output of OUTPUTS) mkdirSync(dirname(output), { recursive: true });
writeFileSync(OUTPUTS[0], png);
for (const output of OUTPUTS.slice(1)) copyFileSync(OUTPUTS[0], output);
process.stdout.write(`Rendered deterministic 1200×630 social preview (${png.length} bytes).\n`);
