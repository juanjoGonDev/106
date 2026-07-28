import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/player-browser.yml', 'utf8');

describe('parallel player browser workflow', () => {
  it('caps every evidence stage at three minutes', () => {
    expect(workflow).not.toMatch(/timeout-minutes:\s*(?:15|30)/u);
    expect(workflow.match(/timeout-minutes:\s*3/gu)).toHaveLength(4);
  });

  it('distributes capture and GIF encoding over parallel browser shards', () => {
    expect(workflow.match(/max-parallel:\s*16/gu)).toHaveLength(2);
    expect(workflow.match(/project: \[desktop-chrome, mobile-chrome\]/gu)).toHaveLength(2);
    expect(workflow.match(/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/gu)).toHaveLength(2);
    expect(workflow).toContain('--project=');
    expect(workflow).toContain('matrix.project');
    expect(workflow).toContain('--shard=');
    expect(workflow).toContain('EVIDENCE_SHARDS_PER_PROJECT');
    expect(workflow).toContain("PLATFORM_EVIDENCE_FRAGMENT: '1'");
    expect(workflow).toContain('needs: browser-shards');
    expect(workflow).toContain('node scripts/create-preview-gif.mjs');
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('publishes raw and GIF fragments before one validated canonical artifact', () => {
    expect(workflow).toContain('platform-evidence-raw-fragment-');
    expect(workflow).toContain('platform-evidence-gif-fragment-');
    expect(workflow).toContain('needs: [browser-shards, gif-shards]');
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
    expect(workflow).toContain('pattern: platform-evidence-*-fragment-*');
    expect(workflow).toContain('node scripts/merge-platform-evidence.mjs');
    expect(workflow).toContain('node scripts/package-platform-evidence.mjs');
    expect(workflow).toContain('name: platform-evidence-${{ github.run_id }}');
    expect(workflow.match(/compression-level:\s*0/gu).length).toBeGreaterThanOrEqual(4);
  });

  it('surfaces concise failure fingerprints without uploading duplicate preview trees', () => {
    expect(workflow).toContain('node scripts/playwright-failure-summary.mjs');
    expect(workflow).toContain('steps.failure.outputs.slug');
    expect(workflow).not.toMatch(/Upload failed shard diagnostics[\s\S]*\.tmp\/pr-previews/u);
  });
});
