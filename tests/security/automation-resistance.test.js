import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('public/index.html', 'utf8');
const appSource = readFileSync('public/app.js', 'utf8');
const controlSource = readFileSync('public/stop-control.js', 'utf8');
const humanCheckSource = readFileSync('public/human-check.js', 'utf8');
const apiSource = readFileSync('supabase/functions/game-api/index.ts', 'utf8');
const migrationSource = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join('supabase/migrations', file), 'utf8'))
  .join('\n');

const pointerMigration = readFileSync(
  'supabase/migrations/20260721240000_pointer_only_human_checks.sql',
  'utf8',
);
const mobileTouchMigration = readFileSync(
  'supabase/migrations/20260722090000_mobile_touch_finish_compat.sql',
  'utf8',
);

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

  it('uses a server-issued numbered-ball check drawn on one canvas', () => {
    expect(indexHtml).toContain('human-check.js');
    expect(humanCheckSource).toContain("action: CHECK_ACTION");
    expect(humanCheckSource).toContain("action: COMPLETE_ACTION");
    expect(humanCheckSource).toContain("createElement('canvas')");
    expect(humanCheckSource).toContain("addEventListener('pointerdown'");
    expect(humanCheckSource).toContain("['mouse', 'touch', 'pen'].includes(event.pointerType)");
    expect(humanCheckSource).not.toContain("createElement('button');\n      ball");
  });

  it('persists and consumes the visual proof before creating a challenge', () => {
    for (const contract of [
      'game_human_checks',
      'create_game_human_check',
      'complete_game_human_check',
      'consume_game_human_check',
      'start_game_challenge_pointer_only',
      'finish_game_attempt_pointer_only',
    ]) expect(pointerMigration).toContain(contract);

    expect(pointerMigration).toContain("interaction_mode = 'press'");
    expect(pointerMigration).toContain("finishEvent', '') <> 'pointerdown'");
    expect(pointerMigration).toContain("pointerType', '') not in ('mouse', 'touch', 'pen')");
    expect(migrationSource).toContain('interaction_challenge_mismatch');
    expect(migrationSource).toContain('repeated_interaction_fingerprint');
  });

  it('accepts trusted mobile touch without weakening mouse or automation checks', () => {
    expect(mobileTouchMigration).toContain("v_pointer_type = 'mouse'");
    expect(mobileTouchMigration).toContain("v_pointer_type in ('touch', 'pen')");
    expect(mobileTouchMigration).toContain("automationDetected', 'false') = 'true'");
    expect(mobileTouchMigration).toContain("'{userActivationObserved}'");
    expect(mobileTouchMigration).toContain("'{userActivation}'");
    expect(mobileTouchMigration).toContain("'true'::jsonb");
    expect(mobileTouchMigration).not.toContain("finishEvent', '') = 'keydown'");
  });

  it('normalizes proof and pointer signals before PostgreSQL RPCs', () => {
    for (const signal of [
      'interactionMode',
      'controlNonce',
      'finishEvent',
      'pointerTrusted',
      'userActivation',
      'automationDetected',
      'pointerXPercent',
      'pointerYPercent',
    ]) expect(apiSource).toContain(signal);

    expect(apiSource).toContain("action === 'human-check'");
    expect(apiSource).toContain("action === 'complete-human-check'");
    expect(apiSource).toContain("rpc('consume_game_human_check'");
    expect(apiSource).toContain("rpc('finish_game_attempt_pointer_only'");
    expect(apiSource).not.toContain("finishEvent = ['pointerdown', 'pointerup', 'keydown']");
  });
});
