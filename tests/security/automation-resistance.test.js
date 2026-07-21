import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('public/index.html', 'utf8');
const appSource = readFileSync('public/app.js', 'utf8');
const controlSource = readFileSync('public/stop-control.js', 'utf8');
const apiSource = readFileSync('supabase/functions/game-api/index.ts', 'utf8');
const migrationSource = readFileSync('supabase/migrations/20260721234500_ephemeral_finish_gestures.sql', 'utf8');

describe('automation-resistant finish interaction', () => {
  it('does not expose a static stop button or selector contract', () => {
    expect(indexHtml).not.toContain('id="stopButton"');
    expect(indexHtml).not.toMatch(/<button[^>]*>\s*PARAR\s*<\/button>/i);
    expect(appSource).not.toContain("#stopButton");
    expect(controlSource).not.toContain("createElement('button')");
  });

  it('renders the finish control inside a closed shadow root and canvas', () => {
    expect(controlSource).toContain("attachShadow({ mode: 'closed' })");
    expect(controlSource).toContain("createElement('canvas')");
    expect(controlSource).toContain('controlNonce');
    expect(controlSource).toContain('pointerMoveCount');
    expect(controlSource).toContain('automationDetected');
  });

  it('randomizes and persists the server-side interaction contract', () => {
    for (const field of [
      'interaction_mode',
      'interaction_nonce',
      'target_x_percent',
      'target_y_percent',
      'min_hold_ms',
      'max_hold_ms',
      'keyboard_code',
      'render_variant',
    ]) {
      expect(migrationSource).toContain(field);
    }
    expect(migrationSource).toMatch(/random\(\) < 0\.5 then 'press' else 'release'/i);
    expect(migrationSource).toContain('interaction_challenge_mismatch');
    expect(migrationSource).toContain('repeated_interaction_fingerprint');
  });

  it('normalizes every interaction signal before sending it to PostgreSQL', () => {
    for (const signal of [
      'interactionMode',
      'controlNonce',
      'finishEvent',
      'pointerTrusted',
      'userActivation',
      'automationDetected',
      'pointerXPercent',
      'pointerYPercent',
      'holdDurationMs',
      'samePointer',
      'keyboardKey',
    ]) {
      expect(apiSource).toContain(signal);
    }
    expect(apiSource).toContain('normalizeSignals(body.clientSignals)');
  });
});