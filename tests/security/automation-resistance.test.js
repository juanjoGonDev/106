import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('public/index.html', 'utf8');
const appSource = readFileSync('public/app.js', 'utf8');
const controlSource = readFileSync('public/stop-control.js', 'utf8');
const humanCheckSource = readFileSync('public/human-check.js', 'utf8');
const readyFlowSource = readFileSync('public/human-check-ready-flow.js', 'utf8');
const apiSource = readFileSync('supabase/functions/game-api/index.ts', 'utf8');
const readyApiSource = readFileSync('supabase/functions/game-ready-api/index.ts', 'utf8');
const migrationSource = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join('supabase/migrations', file), 'utf8'))
  .join('\n');

const pointerMigration = readFileSync('supabase/migrations/20260721240000_pointer_only_human_checks.sql', 'utf8');
const mobileTouchMigration = readFileSync('supabase/migrations/20260722090000_mobile_touch_finish_compat.sql', 'utf8');
const antiCheatMigration = readFileSync('supabase/migrations/20260802030000_ranked_game_anti_cheat.sql', 'utf8');
const legacyMigration = readFileSync('supabase/migrations/20260802030100_disable_legacy_human_check_contract.sql', 'utf8');

describe('automation-resistant game interactions', () => {
  it('does not expose a static stop button or selector contract', () => {
    expect(indexHtml).not.toContain('id="stopButton"');
    expect(indexHtml).not.toMatch(/<button[^>]*>\s*PARAR\s*<\/button>/i);
    expect(appSource).not.toContain('#stopButton');
    expect(controlSource).not.toContain("createElement('button')");
    expect(controlSource).not.toContain("setAttribute('role'");
    expect(controlSource).not.toContain("setAttribute('aria-label'");
    expect(controlSource).not.toContain("setAttribute('title'");
    expect(controlSource).not.toContain('tabIndex');
    expect(controlSource).not.toContain('tabindex');
  });

  it('renders the finish control inside a closed shadow root and canvas', () => {
    expect(controlSource).toContain("attachShadow({ mode: 'closed' })");
    expect(controlSource).toContain("createElement('canvas')");
    expect(controlSource).toContain('hostTag = `m106-${interaction.nonce');
    expect(controlSource).toContain('controlNonce');
    expect(controlSource).toContain('pointerMoveCount');
    expect(controlSource).toContain('automationDetected');
  });

  it('permits only a trusted pointer press for the final stop', () => {
    expect(controlSource).toContain("finishEvent: 'pointerdown'");
    expect(controlSource).toContain("interactionMode: 'press'");
    expect(controlSource).toContain("['mouse', 'touch', 'pen'].includes(event.pointerType)");
    expect(controlSource).not.toContain("addEventListener('keydown'");
    expect(controlSource).not.toContain('keyboardKey');
    expect(controlSource).not.toContain('RELEASE_LABELS');
  });

  it('renders a server-issued raster without exposing the ordered solution', () => {
    expect(indexHtml).toContain('human-check.js');
    expect(humanCheckSource).toContain('action: CHECK_ACTION');
    expect(humanCheckSource).toContain('action: COMPLETE_ACTION');
    expect(humanCheckSource).toContain("createElement('img')");
    expect(humanCheckSource).toContain('image.onpointerdown = (event) => {');
    expect(humanCheckSource).toContain('readyFlowApi.isTrustedReadyPointer(event)');
    expect(humanCheckSource).toContain('image.src = challengeImage.dataUrl');
    expect(humanCheckSource).not.toContain('created.balls');
    expect(humanCheckSource).not.toContain('drawCaptchaScene');
    expect(readyFlowSource).toContain("Object.freeze(['mouse', 'touch', 'pen'])");
    expect(readyApiSource).toContain("challengeFormat: 'raster-png-v1'");
    expect(readyApiSource).toContain('renderHumanCheckRaster');
  });

  it('persists and consumes the visual proof before creating a challenge', () => {
    for (const contract of ['game_human_checks', 'create_game_human_check', 'complete_game_human_check', 'consume_game_human_check', 'start_game_challenge_pointer_only', 'finish_game_attempt_pointer_only']) {
      expect(pointerMigration).toContain(contract);
    }
    expect(pointerMigration).toContain("interaction_mode = 'press'");
    expect(antiCheatMigration).toContain('complete_game_human_check_raster');
    expect(antiCheatMigration).toContain('finish_game_attempt_ranked');
    expect(legacyMigration).toContain('legacy human-check contract disabled');
  });

  it('accepts trusted mobile touch without weakening mouse checks', () => {
    expect(mobileTouchMigration).toContain("v_pointer_type = 'mouse'");
    expect(mobileTouchMigration).toContain("v_pointer_type in ('touch', 'pen')");
    expect(mobileTouchMigration).toContain("automationDetected', 'false') = 'true'");
    expect(mobileTouchMigration).toContain("'{userActivationObserved}'");
    expect(mobileTouchMigration).toContain("'{userActivation}'");
    expect(mobileTouchMigration).toContain("'true'::jsonb");
    expect(mobileTouchMigration).not.toContain("finishEvent', '') = 'keydown'");
  });

  it('treats browser signals as telemetry while server state authorizes finish', () => {
    for (const signal of ['interactionMode', 'controlNonce', 'finishEvent', 'pointerTrusted', 'userActivation', 'automationDetected', 'pointerXPercent', 'pointerYPercent']) {
      expect(apiSource).toContain(signal);
    }
    expect(apiSource).toContain("rpc('finish_game_attempt_pointer_only'");
    expect(antiCheatMigration).toContain("jsonb_build_object('clientTelemetry'");
    expect(antiCheatMigration).toContain('v_server_elapsed_ms');
    expect(antiCheatMigration).toContain('v_transport_delta_ms');
    expect(migrationSource).toContain('challenge_used');
  });
});
