import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/human-check.js', 'utf8');
const flow = readFileSync('public/human-check-ready-flow.js', 'utf8');
const access = readFileSync('public/access.js', 'utf8');
const index = readFileSync('public/index.html', 'utf8');
const styles = readFileSync('public/v9.css', 'utf8');
const readyApi = readFileSync('supabase/functions/game-ready-api/index.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260722190000_prepared_countdown_challenges.sql', 'utf8');

describe('captcha, ready canvas, and countdown separation', () => {
  it('uses the captcha modal only for numbered-ball solving', () => {
    expect(source).toContain("overlay.dataset.phase = 'solving'");
    expect(source).toContain("if (completedCount === balls.length) settle({ kind: 'solved'");
    expect(source).not.toContain("readyButton.textContent = 'Estoy preparado'");
    expect(source).not.toContain("createElement('button');\n    ready");
    expect(source).not.toContain('human-check-countdown');
  });

  it('closes captcha before exposing a randomized pointer-only ready canvas', () => {
    expect(source).toContain('dialog.destroy();\n          return proof;');
    expect(source).toContain("host.attachShadow({ mode: 'closed' })");
    expect(source).toContain("context.fillText('ESTOY PREPARADO'");
    expect(source).toContain('readyFlowApi.createReadyTarget');
    expect(source).toContain('readyFlowApi.isPointInsideTarget');
    expect(source).toContain('readyFlowApi.isTrustedReadyPointer');
    expect(source).not.toMatch(/ready[^\n]{0,40}createElement\('button'\)/i);
  });

  it('prepares the game surface and disabled final-control preview below the ready layer', () => {
    expect(source).toContain("className = 'game-readiness-layer'");
    expect(source).toContain("className = 'game-stop-preview'");
    expect(source).toContain('previewControl.setDisabled(true)');
    expect(source).toContain("document.querySelector(`#${id}`)?.classList.toggle('active', id === 'playing')");
    expect(styles).toContain('.game-readiness-layer');
    expect(styles).toContain('.game-stop-preview');
  });

  it('starts exactly 3, 2, 1 from a trusted ready pointer and reveals after activation', () => {
    expect(flow).toContain('Object.freeze([3, 2, 1])');
    expect(flow).toContain('COUNTDOWN_INTERVAL_MS = 1_000');
    expect(source).toContain('if (!flow.startCountdown()) return;');
    expect(source).toContain('action: ACTIVATE_ACTION');
    expect(source).toContain('countdownMs: COUNTDOWN_MS');
    expect(source).toContain('revealWhenMounted()');
    expect(migration).toContain("v_starts_at := v_activated_at + p_countdown_ms * interval '1 millisecond'");
  });

  it('keeps the real stop control disabled until the timer is concealed', () => {
    expect(source).toContain('gateNextStopControl = true');
    expect(source).toContain('control.setDisabled(true)');
    expect(source).toContain("timer?.classList.contains('concealed')");
    expect(source).toContain('control.setDisabled(false)');
  });

  it('regenerates the complete server captcha and keeps one modal mounted', () => {
    expect(source).toContain("settle({ kind: 'refresh', previousBalls: balls })");
    expect(source).toContain('previousBalls: previousBalls.length ? previousBalls : undefined');
    expect(source).toContain('readyFlowApi.layoutsDiffer(previousBalls, created.balls)');
    expect(source).toContain('Generando posiciones nuevas…');
    expect(source).toContain('LOADING_DELAY_MS = 180');
    expect(source.match(/createHumanCheckDialog\(\)/g)).toHaveLength(2);
    expect(readyApi).toContain('HUMAN_BALL_REPLACEMENT_DISTANCE = 12');
    expect(readyApi).toContain('createBallLayout(previousBalls)');
  });

  it('invalidates stale Chrome resize frames before painting a replacement captcha', () => {
    expect(flow).toContain('function createLatestFrameRenderer');
    expect(source).toContain('readyFlowApi.createLatestFrameRenderer');
    expect(source).toContain('frameRenderer.invalidate()');
    expect(source).toContain('frameRenderer.replace(redraw)');
    expect(source).toContain('frameRenderer.renderNow();\n      frameRenderer.request();');
    expect(source).toContain('function onResize() {\n      frameRenderer.request();\n    }');
    expect(source).not.toContain('requestAnimationFrame(activeRedraw)');
  });

  it('bootstraps the private account key for the new prepare-start action', () => {
    expect(access).toMatch(/const protectedActions = new Set\(\[[\s\S]*'prepare-start'/);
    expect(source).toContain('action: PREPARE_ACTION');
  });

  it('expires readiness after two minutes and restarts the full captcha flow', () => {
    expect(flow).toContain('READY_WINDOW_MS = 120_000');
    expect(source).toContain('if (stageResult.expired) continue;');
    expect(migration).toContain("v_ready_expires_at timestamptz := v_prepared_at + interval '2 minutes'");
    expect(migration).toContain("v_ready_expires_at timestamptz := clock_timestamp() + interval '2 minutes'");
  });

  it('loads the covered controller before the interceptor and keeps responsive layouts', () => {
    const flowIndex = index.indexOf('src="./human-check-ready-flow.js"');
    const interceptorIndex = index.indexOf('src="./human-check.js"');
    expect(flowIndex).toBeGreaterThan(-1);
    expect(interceptorIndex).toBeGreaterThan(flowIndex);
    expect(styles).toContain('@media (max-width: 620px)');
    expect(styles).toContain('@media (max-height: 520px) and (orientation: landscape)');
    expect(styles).toContain('position: fixed');
  });

  it('uses one-time proof, prepare, and activate contracts without changing legacy start', () => {
    expect(source).toContain('action: CHECK_ACTION');
    expect(source).toContain('action: COMPLETE_ACTION');
    expect(source).toContain('action: PREPARE_ACTION');
    expect(source).toContain('action: ACTIVATE_ACTION');
    expect(readyApi).toContain("action === 'prepare-start'");
    expect(readyApi).toContain("action === 'activate-start'");
    expect(readyApi).toContain("rpc('consume_game_human_check'");
    expect(readyApi).toContain("rpc('prepare_game_challenge_pointer_only'");
    expect(readyApi).toContain("rpc('activate_game_challenge_pointer_only'");
    expect(migration).toContain('challenge_not_activated');
  });
});
