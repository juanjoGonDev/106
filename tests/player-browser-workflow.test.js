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

describe('parallel player browser workflow', () => {
  it('caps every evidence stage at three minutes', () => {
    expect(workflow).not.toMatch(/timeout-minutes:\s*(?:15|30)/u);
    expect(workflow.match(/timeout-minutes:\s*3/gu)).toHaveLength(4);
  });

  it('isolates complete capture and GIF encoding over parallel browser shards', () => {
    expect(workflow.match(/max-parallel:\s*16/gu)).toHaveLength(2);
    expect(workflow.match(/project: \[desktop-chrome, mobile-chrome\]/gu)).toHaveLength(2);
    expect(workflow.match(/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/gu)).toHaveLength(2);
    expect(workflow).toContain('--project=');
    expect(workflow).toContain('matrix.project');
    expect(workflow).toContain('--shard=');
    expect(workflow).toContain('EVIDENCE_SHARDS_PER_PROJECT: 8');
    expect(workflow).toContain("PLATFORM_EVIDENCE_FRAGMENT: '1'");
    expect(workflow).toContain('gif-shards:');
    expect(workflow).toContain('needs: browser-shards');
    expect(stepBlock('Run isolated responsive journey shard')).not.toContain('create-preview-gif.mjs');
    expect(stepBlock('Encode shard recordings as GIF')).toContain('node scripts/create-preview-gif.mjs');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('prevents capture workers from recording every test implicitly', () => {
    expect(playwrightConfig).toContain("const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';");
    expect(playwrightConfig).toContain('workers: visualCapture ? 1 : 2');
    expect(playwrightConfig).toContain("video: visualCapture ? 'off' : 'retain-on-failure'");
  });

  it('installs the full GIF encoder only after a shard produced recordings', () => {
    expect(gifEncoder.indexOf('const recordings = recordingFiles();'))
      .toBeLessThan(gifEncoder.indexOf('installHostedFfmpeg()'));
    expect(gifEncoder).toContain("process.env.GITHUB_ACTIONS === 'true'");
    expect(gifEncoder).toContain("['apt-get', 'update', '-qq']");
    expect(gifEncoder).toContain("['apt-get', 'install', '-y', '--no-install-recommends', 'ffmpeg']");
    expect(gifEncoder).toContain('gifCapableFfmpeg() || installHostedFfmpeg()');
  });

  it('publishes raw and GIF fragments before one validated canonical artifact', () => {
    expect(workflow).toContain('platform-evidence-raw-fragment-');
    expect(workflow).toContain('platform-evidence-gif-fragment-');
    expect(workflow.match(/include-hidden-files:\s*true/gu)).toHaveLength(2);
    expect(workflow).toContain('needs: [browser-shards, gif-shards]');
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
    expect(workflow).toContain('pattern: platform-evidence-*-fragment-*');
    expect(workflow).toContain('node scripts/merge-platform-evidence.mjs');
    expect(workflow).toContain('node scripts/package-platform-evidence.mjs');
    expect(workflow).toContain('name: platform-evidence-${{ github.run_id }}');
    expect(workflow.match(/compression-level:\s*0/gu).length).toBeGreaterThanOrEqual(4);
  });

  it('surfaces concise failure fingerprints without uploading duplicate preview trees', () => {
    expect(workflow).toContain('node scripts/write-playwright-failure-summary.mjs');
    expect(workflow).toContain('steps.failure.outputs.slug');
    expect(stepBlock('Upload failed shard diagnostics')).not.toContain('.tmp/pr-previews');
  });
});
