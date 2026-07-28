import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/player-browser.yml', 'utf8');

describe('parallel player browser workflow', () => {
  it('caps every evidence stage at three minutes', () => {
    expect(workflow).not.toMatch(/timeout-minutes:\s*(?:15|30)/u);
    expect(workflow.match(/timeout-minutes:\s*3/gu)).toHaveLength(3);
  });

  it('distributes both browser projects over sixteen concurrent shards', () => {
    expect(workflow).toContain('max-parallel: 16');
    expect(workflow).toContain('project: [desktop-chrome, mobile-chrome]');
    expect(workflow).toContain('shard: [1, 2, 3, 4, 5, 6, 7, 8]');
    expect(workflow).toContain('--project=');
    expect(workflow).toContain('matrix.project');
    expect(workflow).toContain('--shard=');
    expect(workflow).toContain('EVIDENCE_SHARDS_PER_PROJECT');
    expect(workflow).toContain("PLATFORM_EVIDENCE_FRAGMENT: '1'");
    expect(workflow).not.toContain('continue-on-error: true');
  });

  it('merges fragments without collisions before publishing one canonical artifact', () => {
    expect(workflow).toContain('needs: browser-shards');
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
    expect(workflow).toContain('pattern: platform-evidence-fragment-*');
    expect(workflow).toContain('node scripts/merge-platform-evidence.mjs');
    expect(workflow).toContain('node scripts/package-platform-evidence.mjs');
    expect(workflow).toContain('name: platform-evidence-');
    expect(workflow.match(/compression-level:\s*0/gu).length).toBeGreaterThanOrEqual(3);
  });
});
