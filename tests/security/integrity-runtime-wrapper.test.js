import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const capture = readFileSync(
  'supabase/migrations/20260810029999_capture_ranked_runtime_contract.sql',
  'utf8',
);
const wrappers = readFileSync(
  'supabase/migrations/20260810030200_ranked_integrity_prepare_ban_wrapper.sql',
  'utf8',
);

function bodyOf(source, functionName) {
  const pattern = new RegExp(`create or replace function public\\.${functionName}\\([^]*?\\n\\$\\$;`, 'gi');
  return [...source.matchAll(pattern)].at(-1)?.[0] ?? '';
}

describe('ranked integrity runtime wrappers', () => {
  it('captures the pre-policy-v3 start and finish owners before policy replacement', () => {
    expect(capture).toContain('rename to start_game_challenge_pointer_only_policy_v2');
    expect(capture).toContain('rename to finish_game_attempt_pointer_only_policy_v2');
  });

  it('adds the ban gate without reimplementing league or reservation rules', () => {
    const start = bodyOf(wrappers, 'start_game_challenge_pointer_only');
    expect(start).toContain('public.get_game_active_integrity_ban');
    expect(start).toContain("return jsonb_build_object('error', 'integrity_banned')");
    expect(start).toContain('public.start_game_challenge_pointer_only_policy_v2');
    expect(start).not.toContain('public.start_game_challenge(');
    expect(start).not.toContain('game_leagues');
    expect(start).not.toContain('v_active_challenges');
  });

  it('keeps authoritative timing and one-use finish semantics in the preserved owner', () => {
    const finish = bodyOf(wrappers, 'finish_game_attempt_pointer_only');
    expect(finish).toContain('public.finish_game_attempt_pointer_only_policy_v2');
    expect(finish).toContain('public.reassess_game_integrity_cluster');
    expect(finish).toContain("'{attempt,verified}'");
    expect(finish).not.toContain('v_transport_delta_ms');
    expect(finish).not.toContain('v_server_elapsed_ms');
  });

  it('does not expose bypass implementations to service or API roles', () => {
    expect(wrappers).toContain(
      'revoke all on function public.start_game_challenge_pointer_only_policy_v2(text, text, text, text, text, uuid, text)',
    );
    expect(wrappers).toContain(
      'revoke all on function public.finish_game_attempt_pointer_only_policy_v2(uuid, integer, text, text, jsonb)',
    );
    expect(wrappers).toContain(
      'revoke all on function public.prepare_game_challenge_pointer_only_unchecked(text, text, text, text, text, uuid, text)',
    );
    expect(wrappers).toContain('from public, anon, authenticated, service_role;');
  });
});
