import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiPath = 'supabase/functions/game-api/index.ts';
const apiSource = readFileSync(apiPath, 'utf8');
const migrationDirectory = 'supabase/migrations';
const migrationSource = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrationDirectory, file), 'utf8'))
  .join('\n');

describe('Edge Function attack surface', () => {
  it('enforces method, origin and request-size boundaries', () => {
    expect(apiSource).toContain("request.method !== 'POST'");
    expect(apiSource).toContain('allowedOrigins.has(origin)');
    expect(apiSource).toMatch(/content-length[^\n]+16_384/);
    expect(apiSource).toContain("'Cache-Control': 'no-store'");
    expect(apiSource).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('validates identifiers and account tokens before private actions', () => {
    expect(apiSource).toContain('const UUID =');
    expect(apiSource).toContain('const PRIVATE_TOKEN =');
    expect(apiSource).toContain("request.headers.get('x-account-token')");
    expect(apiSource).toContain('authorizePlayer(request');
    expect(apiSource).toContain('normalizeLeagueCode');
    expect(apiSource).toContain('normalizeTeam');
    expect(apiSource).toContain('moderateNickname');
  });

  it('validates pointer-only human checks before starting an attempt', () => {
    expect(apiSource).toContain('normalizeHumanClicks');
    expect(apiSource).toContain("['mouse', 'touch', 'pen'].includes(pointerType)");
    expect(apiSource).toContain("rpc('complete_game_human_check'");
    expect(apiSource).toContain("rpc('consume_game_human_check'");
    expect(apiSource).toContain("rpc('start_game_challenge_pointer_only'");
  });

  it('does not execute or construct SQL from request input', () => {
    expect(apiSource).not.toMatch(/\b(eval|Function)\s*\(/);
    expect(apiSource).not.toMatch(/\b(exec|execute)\s*\(/i);
    expect(apiSource).not.toMatch(/from\s*\(\s*body\./i);
    expect(apiSource).not.toMatch(/rpc\s*\(\s*body\./i);
    expect(apiSource).not.toMatch(/`[^`]*(select|insert|update|delete)[^`]*\$\{/i);
  });

  it('uses named RPC calls with parameter objects', () => {
    const rpcCalls = [...apiSource.matchAll(/rpc\(([^\n;]+)\)/g)].map((match) => match[1]);
    expect(rpcCalls.length).toBeGreaterThan(5);
    for (const call of rpcCalls) expect(call.trim()).not.toMatch(/^body\./);
  });
});

describe('PostgreSQL access controls', () => {
  it('enables RLS and revokes browser roles from sensitive tables', () => {
    for (const table of [
      'game_attempts',
      'game_challenges',
      'game_players',
      'game_duels',
      'game_leagues',
      'game_league_members',
      'game_accounts',
      'game_account_players',
      'game_human_checks',
    ]) {
      expect(migrationSource).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    }
    expect(migrationSource).toMatch(/revoke all[\s\S]+from anon, authenticated/i);
  });

  it('contains no dynamic SQL or unsafe search_path', () => {
    expect(migrationSource).not.toMatch(/execute\s+(format|\$|')/i);
    expect(migrationSource).not.toMatch(/set\s+search_path\s*=\s*public\s*(;|as)/i);
    expect(migrationSource).not.toMatch(/grant\s+all[\s\S]+to\s+(anon|authenticated)/i);
  });

  it('uses bounded validated fields for public identifiers', () => {
    expect(migrationSource).toMatch(/char_length\(name\) between 3 and 40/i);
    expect(migrationSource).toMatch(/code\s+~\s+'\^\[A-Z0-9\]\{6\}\$'/i);
  });
});
