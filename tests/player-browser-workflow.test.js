import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/player-browser.yml', 'utf8');

function stepBlock(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start < 0) return '';
  const next = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

describe('parallel player browser workflow', () => {
  it('caps every evidence stage at three minutes', () => {
    expect(workflow).not.toMatch(/timeout-minutes:\s*(?:15|30)/u);
    expect(workflow.match(/timeout-minutes:\s*3/gu)).toHaveLength(3);
  });

  it('distributes complete capture and GIF encoding over balanced browser shards', () => {
    expect(workflow.match(/max-parallel:\s*16/gu)).toHaveLength(1);
    expect(workflow.match(/project: \[desktop-chrome, mobile-chrome\]/gu)).toHaveLength(1);
    expect(workflow).toContain('shard: [1, 2, 3, 4, 5, 6, 7, 8]');
    expect(workflow).toContain('--project=');
    expect(workflow).toContain('matrix.project');
    expect(workflow).toContain('--shard=');
    expect(workflow).toContain('EVIDENCE_SHARDS_PER_PROJECT: 8');
    expect(workflow).toContain("PLATFORM_EVIDENCE_FRAGMENT: '1'");
    expect(workflow).toContain("compgen -G '.tmp/pr-previews/*.webm'");
    expect(workflow).toContain('node scripts/create-preview-gif.mjs');
    expect(workflow).not.toContain('gif-shards:');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('publishes complete fragments before one validated canonical artifact', () => {
    expect(workflow).toContain('platform-evidence-fragment-');
    expect(workflow).toContain('include-hidden-files: true');
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
