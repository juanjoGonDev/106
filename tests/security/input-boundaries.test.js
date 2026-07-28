import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunctionPaths = [
  'supabase/functions/game-api/index.ts',
  'supabase/functions/player-context/index.ts',
  'supabase/functions/league-api/index.ts',
  'supabase/functions/account-auth/index.ts',
  'supabase/functions/player-share/index.ts',
  'supabase/functions/social-share/index.ts',
];
const edgeSources = new Map(edgeFunctionPaths.map((path) => [path, readFileSync(path, 'utf8')]));
const hardeningMigration = readFileSync(
  'supabase/migrations/20260728090000_nickname_input_hardening.sql',
  'utf8',
);

function rpcArguments(source) {
  return [...source.matchAll(/\brpc\s*\(\s*([^,\n)]+)/g)]
    .map((match) => match[1].trim())
    .filter((argument) => argument !== 'name' && !argument.startsWith('name:'));
}

describe('all public input boundaries', () => {
  it('never derives SQL, RPC names or executable code from request input', () => {
    for (const [path, source] of edgeSources) {
      expect(source, path).not.toMatch(/\b(eval|Function)\s*\(/);
      expect(source, path).not.toMatch(/supabase\.rpc\s*\(\s*(body|action|request|payload)\b/i);
      expect(source, path).not.toMatch(/\brpc\s*\(\s*(body|action|request|payload)\b/i);
      expect(source, path).not.toMatch(/`[^`]*(select|insert|update|delete|drop|alter)[^`]*\$\{/i);
      expect(source, path).not.toMatch(/\bexecute\s+(format|body|payload|request)/i);
    }
  });

  it('uses literal named RPC calls at every repository-owned helper boundary', () => {
    for (const [path, source] of edgeSources) {
      for (const argument of rpcArguments(source)) {
        expect(argument, `${path}: ${argument}`).toMatch(/^['"][a-z0-9_]+['"]$/i);
      }
    }
  });

  it('bounds public text inputs before parameterized RPC calls', () => {
    expect(edgeSources.get('supabase/functions/game-api/index.ts')).toContain('16_384');
    expect(edgeSources.get('supabase/functions/player-context/index.ts')).toContain('4_096');
    expect(edgeSources.get('supabase/functions/league-api/index.ts')).toContain('8_192');
    expect(edgeSources.get('supabase/functions/league-api/index.ts')).toContain("slice(0, 80)");
    expect(edgeSources.get('supabase/functions/game-api/index.ts')).toContain('slice(0, 40)');
    expect(edgeSources.get('supabase/functions/account-auth/index.ts')).toContain("request.method !== 'POST'");
  });

  it('applies the shared nickname policy to debounce, writes and public routes', () => {
    expect(edgeSources.get('supabase/functions/player-context/index.ts')).toContain('moderateNickname(body.nick)');
    expect(edgeSources.get('supabase/functions/player-context/index.ts')).toContain("availability: `invalid-${reason}`");
    expect(edgeSources.get('supabase/functions/game-api/index.ts')).toContain('moderateNickname');
    expect(edgeSources.get('supabase/functions/league-api/index.ts')).toContain('moderateNickname');
    expect(readFileSync('public/player-ui.js', 'utf8')).toContain('playerShellUrl(validation.normalized');
    expect(readFileSync('public/nickname-input-guard.js', 'utf8')).toContain('resolveNicknameGate');
  });

  it('adds a forward-only database constraint without rewriting malformed legacy rows', () => {
    expect(hardeningMigration).toMatch(/game_players_nickname_shape_check[\s\S]+char_length\(nick\) between 3 and 24/i);
    expect(hardeningMigration).toMatch(/game_players_nickname_shape_check[\s\S]+not valid/i);
    expect(hardeningMigration).toContain("nick !~ '[[:cntrl:]/\\\\]'");
    expect(hardeningMigration).not.toMatch(/update\s+public\.game_players\s+set\s+nick\s*=/i);
  });
});
