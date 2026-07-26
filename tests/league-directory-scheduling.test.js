import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const migration = [
  'supabase/migrations/20260726235950_league_settings.sql',
  'supabase/migrations/20260726235951_league_membership.sql',
  'supabase/migrations/20260726235952_league_directory.sql',
  'supabase/migrations/20260726235953_league_player_views.sql',
  'supabase/migrations/20260726235954_league_start_gate.sql',
].map(read).join('\n');
const api = read('supabase/functions/league-api/index.ts');
const config = read('supabase/config.toml');
const html = read('public/ligas.html');
const frontend = read('public/ligas.js');
const directory = read('public/league-directory.js');
const styles = read('public/v16.css');
const e2e = read('tests/e2e/league-management.e2e.js');
const packageJson = read('package.json');
const browserWorkflow = read('.github/workflows/player-browser.yml');

 describe('league configuration and lifecycle', () => {
  it('stores bounded visibility, duration and capacity settings', () => {
    expect(migration).toContain("add column if not exists visibility text not null default 'private'");
    expect(migration).toContain('add column if not exists duration_days smallint not null default 3');
    expect(migration).toContain('add column if not exists max_participants smallint not null default 10');
    expect(migration).toContain("check (visibility in ('public', 'private'))");
    expect(migration).toContain('check (duration_days between 1 and 7)');
    expect(migration).toContain('check (max_participants between 10 and 100 and max_participants % 10 = 0)');
  });

  it('schedules the start exactly 23 hours after the eligible threshold and applies the chosen duration', () => {
    expect(migration).toContain("v_starts_at := v_now + interval '23 hours'");
    expect(migration).toContain('ends_at = v_starts_at + make_interval(days => v_league.duration_days)');
    expect(migration).toContain("'scheduled', v_league.activated_at is not null and v_league.starts_at > v_now");
    expect(migration).toContain("return jsonb_build_object('error', 'league_scheduled')");
    expect(migration).toContain('and league.starts_at <= clock_timestamp()');
  });

  it('serializes joins, enforces capacity and allows one identity per account and device in a league', () => {
    expect(migration).toContain('for update;');
    expect(migration).toContain('member.account_id = v_account_id or member.device_hash = v_identity_device_hash');
    expect(migration).toContain("return jsonb_build_object('error', 'league_identity_limit')");
    expect(migration).toContain('if v_member_count >= v_league.max_participants then');
    expect(migration).toContain("return jsonb_build_object('error', 'league_full')");
  });
});

describe('public and private league boundaries', () => {
  it('lists both visibility types without exposing private credentials', () => {
    const listFunction = migration.slice(
      migration.indexOf('create or replace function public.list_game_leagues'),
      migration.indexOf('create or replace function public.get_game_public_league'),
    );
    expect(listFunction).toContain("v_visibility not in ('all', 'public', 'private')");
    expect(listFunction).toContain("league.visibility = 'public'");
    expect(listFunction).not.toContain("'joinCode'");
    expect(listFunction).not.toContain('league.join_code');
  });

  it('accepts a public identifier only for public leagues and a private code for private invitations', () => {
    expect(migration).toContain('league.join_code = v_private_code');
    expect(migration).toContain("league.visibility = 'public'");
    expect(api).toContain('p_public_id: publicId');
    expect(api).toContain('p_code: code');
    expect(api).toContain("league_identity_limit: 'Esta cuenta o dispositivo ya ocupa una plaza en la liga.'");
  });

  it('registers a focused unauthenticated Edge Function with account-protected mutations', () => {
    expect(config).toContain('[functions.league-api]');
    expect(config).toMatch(/\[functions\.league-api\]\s+verify_jwt = false/);
    expect(api).toContain('const ACTIONS = new Set([');
    expect(api).toContain("'list-leagues'");
    expect(api).toContain('await requireOwnedPlayer(request, key)');
    expect(api).toContain('await authorizePlayer(request, nick, deviceHash, ipHash)');
    expect(api).toContain("'Cache-Control': 'no-store'");
  });
});

describe('dedicated league UX and directory', () => {
  it('keeps management on the hub and hides it on clean dedicated routes', () => {
    expect(html).toContain('class="page-card league-directory-only"');
    expect(html).toContain('id="leagueDirectoryList"');
    expect(html).toContain('id="leagueVisibilityFilter"');
    expect(html).toContain('id="leagueSearch"');
    expect(html).toContain('id="joinPublicLeagueButton"');
    expect(html).toContain('id="competeLeagueLink"');
    expect(styles).toContain('html[data-league-mode="detail"] .league-directory-only');
    expect(frontend).toContain("document.documentElement.dataset.leagueMode = 'detail'");
  });

  it('offers the complete bounded creation configuration', () => {
    expect(html).toContain('id="newLeagueVisibility"');
    expect(html).toContain('id="newLeagueMaxParticipants"');
    expect(html).toContain('<option value="100">100</option>');
    expect(html).toContain('id="newLeagueDuration"');
    expect(html).toContain('<option value="7">7 días</option>');
    expect(directory).toContain('normalizeMaxParticipants');
    expect(directory).toContain('normalizeDurationDays');
  });

  it('only exposes play for an active membership and carries the public scope to home', () => {
    expect(directory).toContain("leaguePhase(league) === 'active'");
    expect(directory).toContain('Number(membership?.attemptsLeft ?? 0) > 0');
    expect(frontend).toContain("url.searchParams.set('competition', publicId)");
    expect(frontend).toContain('competeLink.hidden = !directory.canPlayLeague');
    expect(e2e).toContain("toHaveValue('league:ACTV01')");
    expect(e2e).toContain("request.action === 'prepare-start'");
  });
});

describe('coverage and remote visual evidence', () => {
  it('enforces 100 percent coverage for the isolated directory decision module', () => {
    expect(packageJson).toContain('"test:league-directory:coverage"');
    expect(packageJson).toContain('--test-coverage-lines=100');
    expect(packageJson).toContain('--test-coverage-functions=100');
    expect(packageJson).toContain('--test-coverage-branches=100');
    expect(packageJson).toContain('pnpm test:league-directory:coverage');
    expect(browserWorkflow).toContain('Enforce league directory coverage');
  });

  it('captures complete desktop and mobile screenshots plus real recordings for every league state', () => {
    for (const area of ['league-directory', 'league-detail-active', 'league-detail-scheduled']) {
      expect(e2e).toContain(`'${area}'`);
    }
    expect(e2e).toContain('recordVideo:');
    expect(e2e).toContain('video.saveAs(join(previewDirectory');
    expect(browserWorkflow).toContain('Upload downloadable platform evidence ZIP');
    expect(browserWorkflow).toContain('name: platform-evidence-${{ github.run_id }}');
    expect(browserWorkflow).toContain('path: .tmp/pr-previews');
  });
});
