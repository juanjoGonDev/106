import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/player-browser.yml', 'utf8');
const gifEncoder = readFileSync('scripts/create-preview-gif.mjs', 'utf8');
const playwrightConfig = readFileSync('playwright.config.js', 'utf8');

function stepBlock(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start < 0) return '';
  const next = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = workflow.indexOf(`\n  ${nextName}:`, start);
  return workflow.slice(start, end < 0 ? workflow.length : end);
}

describe('parallel player browser workflow', () => {
  it('caps the complete evidence workflow at three minutes per critical stage', () => {
    expect(workflow).not.toMatch(/timeout-minutes:\s*(?:15|30)/u);
    expect(workflow.match(/timeout-minutes:\s*3/gu)).toHaveLength(3);
    expect(workflow).not.toContain('gif-shards:');
  });

  it('captures and encodes evidence inside sixteen parallel browser shards', () => {
    expect(workflow.match(/max-parallel:\s*16/gu)).toHaveLength(1);
    expect(workflow.match(/project: \[desktop-chrome, mobile-chrome\]/gu)).toHaveLength(1);
    expect(workflow.match(/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/gu)).toHaveLength(1);
    expect(workflow).toContain('--project=');
    expect(workflow).toContain('matrix.project');
    expect(workflow).toContain('--shard=');
    expect(workflow).toContain('EVIDENCE_SHARDS_PER_PROJECT: 8');
    expect(workflow).toContain("PLATFORM_EVIDENCE_FRAGMENT: '1'");
    expect(stepBlock('Run isolated responsive journey and encode its evidence')).toContain("compgen -G '.tmp/pr-previews/*.webm'");
    expect(stepBlock('Run isolated responsive journey and encode its evidence')).toContain('node scripts/create-preview-gif.mjs');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('does not install unrelated project dependencies in each visual shard', () => {
    const shards = jobBlock('browser-shards', 'browser');

    expect(shards).toContain('Validate package policy without installing project dependencies');
    expect(shards).toContain('node scripts/check-package-policy.mjs');
    expect(shards).not.toContain('pnpm install');
    expect(shards).not.toContain('cache: pnpm');
    expect(shards).toContain('Set up pinned Node.js');
    expect(shards).toContain('node scripts/run-playwright.mjs');
    expect(shards).not.toContain('pnpm run test:e2e');
  });

  it('prevents capture workers from recording every test implicitly', () => {
    expect(playwrightConfig).toContain("const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';");
    expect(playwrightConfig).toContain('workers: visualCapture ? 1 : 2');
    expect(playwrightConfig).toContain("video: visualCapture ? 'off' : 'retain-on-failure'");
  });

  it('uses Chrome as the existing WebM decoder and keeps GIF encoding dependency-free', () => {
    expect(gifEncoder).toContain("chromium.launch({ channel: 'chrome', headless: true })");
    expect(gifEncoder).toContain("contentType: 'video/webm'");
    expect(gifEncoder).toContain("context.drawImage(video, 0, 0, width, height)");
    expect(gifEncoder).toContain("Buffer.from('GIF89a')");
    expect(gifEncoder).toContain("Buffer.from('NETSCAPE2.0')");
    expect(gifEncoder).toContain('encodeRgbFrameLzw');
    expect(gifEncoder).toContain('createRgb332Palette');
    expect(gifEncoder).not.toContain('rawvideo');
    expect(gifEncoder).not.toContain('apt-get');
    expect(gifEncoder).not.toContain('sudo');
    expect(gifEncoder).not.toContain('palettegen');
  });

  it('publishes complete fragments before one validated canonical artifact', () => {
    expect(workflow).toContain('platform-evidence-fragment-');
    expect(workflow.match(/include-hidden-files:\s*true/gu)).toHaveLength(1);
    expect(workflow).toContain('needs: browser-shards');
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
    expect(workflow).toContain('pattern: platform-evidence-fragment-*');
    expect(workflow).toContain('node scripts/merge-platform-evidence.mjs');
    expect(workflow).toContain('node scripts/package-platform-evidence.mjs');
    expect(workflow).toContain('name: platform-evidence-${{ github.run_id }}');
    expect(workflow.match(/compression-level:\s*0/gu).length).toBeGreaterThanOrEqual(3);
  });

  it('surfaces concise failure fingerprints without uploading duplicate preview trees', () => {
    expect(workflow).toContain('node scripts/write-playwright-failure-summary.mjs');
    expect(workflow).toContain('steps.failure.outputs.slug');
    expect(stepBlock('Upload failed shard diagnostics')).not.toContain('.tmp/pr-previews');
  });
});
