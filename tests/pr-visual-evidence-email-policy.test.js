import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/pr-visual-evidence.yml', 'utf8');
const emailOperations = readFileSync('docs/auth-email-templates.md', 'utf8');

describe('visual evidence policy for authentication emails', () => {
  it('keeps browser platform evidence strict while excluding non-browser email HTML', () => {
    expect(workflow).toContain("frontend_prefixes = ('public/', 'supabase/functions/player-share/')");
    expect(workflow).toContain("non_browser_visual_prefixes = ('supabase/templates/',)");
    expect(workflow).toContain('if normalized.startswith(non_browser_visual_prefixes):');
    expect(workflow).toContain('return False');
    expect(workflow).toContain('Add at least one complete Desktop/Mobile/GIF visual evidence area.');
  });

  it('requires real hosted email-client smoke evidence instead of browser-route screenshots', () => {
    expect(emailOperations).toContain('Gmail desktop/mobile');
    expect(emailOperations).toContain('at least one non-Gmail client');
    expect(emailOperations).toContain('real confirmation, recovery and security smoke emails');
    expect(emailOperations).toContain('Repository files and `supabase/config.toml` do **not** mutate the hosted project');
  });
});
