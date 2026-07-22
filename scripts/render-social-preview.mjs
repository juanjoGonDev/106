import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const ROOT = process.cwd();
const SOURCE = resolve(ROOT, 'public/assets/social-preview.svg');
const OUTPUTS = [
  resolve(ROOT, 'public/assets/social-preview-v2.png'),
  resolve(ROOT, 'assets/social-preview-v2.png'),
  resolve(ROOT, 'public/public/assets/social-preview-v2.png'),
  resolve(ROOT, 'public/assets/social-preview.png'),
  resolve(ROOT, 'assets/social-preview.png'),
  resolve(ROOT, 'public/public/assets/social-preview.png'),
];
const PRIMARY_OUTPUT = OUTPUTS[0];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function executableCandidates() {
  if (process.env.SOCIAL_PREVIEW_RENDERER) return [process.env.SOCIAL_PREVIEW_RENDERER];
  if (process.platform === 'win32') {
    return [
      'magick.exe',
      'convert.exe',
      'chrome.exe',
      'msedge.exe',
      'brave.exe',
      resolve(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
      resolve(process.env.PROGRAMFILES ?? '', 'Microsoft/Edge/Application/msedge.exe'),
      resolve(process.env.LOCALAPPDATA ?? '', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    ];
  }
  return ['magick', 'convert', 'rsvg-convert', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

function rendererArguments(executable) {
  const name = executable.toLowerCase();
  if (name.endsWith('rsvg-convert')) {
    return ['--width', '1200', '--height', '630', '--output', PRIMARY_OUTPUT, SOURCE];
  }
  if (name.includes('chrome') || name.includes('chromium') || name.includes('brave') || name.includes('msedge')) {
    return [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      `--screenshot=${PRIMARY_OUTPUT}`,
      pathToFileURL(SOURCE).href,
    ];
  }
  if (name.endsWith('magick') || name.endsWith('magick.exe')) {
    return ['convert', '-background', 'none', SOURCE, '-resize', '1200x630!', PRIMARY_OUTPUT];
  }
  return ['-background', 'none', SOURCE, '-resize', '1200x630!', PRIMARY_OUTPUT];
}

function validPng(path) {
  if (!existsSync(path) || statSync(path).size < 10_000) return false;
  const data = readFileSync(path);
  return data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    && data.readUInt32BE(16) === 1200
    && data.readUInt32BE(20) === 630;
}

for (const output of OUTPUTS) mkdirSync(dirname(output), { recursive: true });

let lastError = new Error('No compatible SVG renderer was found.');
for (const executable of executableCandidates()) {
  if (!executable) continue;
  try {
    execFileSync(executable, rendererArguments(executable), {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 30_000,
      windowsHide: true,
    });
    if (!validPng(PRIMARY_OUTPUT)) throw new Error(`${executable} did not produce a valid 1200×630 PNG.`);
    lastError = null;
    break;
  } catch (error) {
    lastError = error instanceof Error ? error : lastError;
  }
}

if (lastError) throw lastError;
for (const output of OUTPUTS.slice(1)) copyFileSync(PRIMARY_OUTPUT, output);
process.stdout.write(`Rendered social preview to ${OUTPUTS.map((path) => path.replace(`${ROOT}/`, '')).join(', ')}.\n`);
