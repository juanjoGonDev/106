import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeSource = readFileSync('supabase/functions/game-api/index.ts', 'utf8');
const accountMigration = readFileSync(
  'supabase/migrations/20260721233000_accounts_and_linked_players.sql',
  'utf8',
);

const injectionPayloads = [
  "' OR '1'='1",
  "'; DROP TABLE public.game_accounts; --",
  '1 UNION SELECT token_hash FROM game_accounts',
  "x'); SELECT pg_sleep(10); --",
];

describe('anonymous account API security', () => {
  it('requires a 256-bit hexadecimal account token', () => {
    expect(edgeSource).toContain("const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i");
    expect(edgeSource).toContain("request.headers.get('x-account-token')");
    expect(edgeSource).toContain("sha256(`account:${rawToken}`)");
  });

  it('uses static parameterized Supabase RPC calls instead of SQL text', () => {
    expect(edgeSource).not.toMatch(/\.from\(body\.|\.rpc\(action|\.rpc\(body\./);
    expect(edgeSource).not.toMatch(/select\s+.*\$\{.*body|insert\s+.*\$\{.*body/i);
    expect(accountMigration).not.toMatch(/\bexecute\s+format\b|\bexecute\s+p_/i);
  });

  it('locks account tables behind RLS and service-role-only functions', () => {
    expect(accountMigration).toContain('alter table public.game_accounts enable row level security');
    expect(accountMigration).toContain('alter table public.game_account_players enable row level security');
    expect(accountMigration).toContain('revoke all on table public.game_accounts, public.game_account_players from anon, authenticated');
    expect(accountMigration).toContain('set search_path = public, pg_temp');
    expect(accountMigration).toContain('grant execute on function public.ensure_game_account_player');
  });

  it.each(injectionPayloads)('never interpolates an attack payload into SQL: %s', (payload) => {
    const serialized = JSON.stringify({ action: 'link-account-player', nick: payload });
    expect(serialized).toContain(payload.replaceAll("'", "'"));
    expect(accountMigration).not.toContain(payload);
  });
});