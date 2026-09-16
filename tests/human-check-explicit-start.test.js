import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/human-check.js', 'utf8');
const flow = readFileSync('public/human-check-ready-flow.js', 'utf8');
const timing = readFileSync('public/attempt-timing.js', 'utf8');
const control = readFileSync('public/stop-control.js', 'utf8');
const access = readFileSync('public/access.js', 'utf8');
const index = readFileSync('public/index.html', 'utf8');
const styles = readFileSync('public/v13.css', 'utf8');
const readyApi = readFileSync('supabase/functions/game-ready-api/index.ts', 'utf8');
const preparedMigration = readFileSync('supabase/migrations/20260722190000_prepared_countdown_challenges.sql', 'utf8');
const boundedMigration = readFileSync('supabase/migrations/20260723190000_bounded_attempt_timeout.sql', 'utf8');

describe('captcha, inline readiness, and bounded attempt lifecycle', () => {
  it('uses the modal only for numbered-ball solving', () => {
    expect(source).toContain("overlay.dataset.phase = 'solving'");
    expect(source).toContain("kind: 'solved'");
    expect(source).toContain('humanProofToken: updated.proofToken');
    expect(source).not.toContain('human-check-countdown');
    expect(source).not.toContain("className = 'game-readiness-layer'");
  });

  it('closes captcha before exposing the complete gameplay surface', () => {
    expect(source).toContain('dialog.destroy();\n          return result.proof;');
    expect(source).toContain("document.querySelector(`#${id}`)?.classList.toggle('active', id === 'playing')");
    expect(source).toContain("timer.classList.remove('concealed')");
    expect(index).toContain('Después tendrás todo el juego visible antes de iniciar la cuenta atrás.');
    expect(styles).toContain('.game-readiness-control');
    expect(styles).not.toContain('position: fixed');
  });

  it('uses the same closed-shadow stop control for ready, countdown, and final stop', () => {
    expect(source).toContain("presentation: { label: 'ESTOY LISTO', detail: 'PULSA PARA EMPEZAR' }");
    expect(source).toContain("control.setPresentation({ label: String(value), detail: '' })");
    expect(source).toContain("control.setPresentation({ label: 'PARAR', detail: 'ESPERA A QUE SE OCULTE' })");
    expect(source).toContain("className = 'game-readiness-control'");
    expect(source).not.toContain("createElement('canvas');\n    host.className = 'game-readiness-host'");
    expect(control).toContain("attachShadow({ mode: 'closed' })");
    expect(control).toContain("createElement('canvas')");
  });

  it('starts exactly 3, 2, 1 from one trusted ready press', () => {
    expect(flow).toContain('Object.freeze([3, 2, 1])');
    expect(flow).toContain('COUNTDOWN_INTERVAL_MS = 1_000');
    expect(source).toContain('if (!flow.startCountdown()) return;');
    expect(source).toContain('action: ACTIVATE_ACTION');
    expect(source).toContain('countdownMs: COUNTDOWN_MS');
    expect(source).toContain('onPress: () => {');
  });

  it('keeps the final control disabled until the timer is concealed', () => {
    expect(source).toContain('gateNextStopControl = true');
    expect(source).toContain('control.setDisabled(true, { muted: false })');
    expect(source).toContain("timer?.classList.contains('concealed')");
    expect(source).toContain('control.setDisabled(false)');
    expect(control).toContain('timingApi.canSubmitManualStop({ elapsedMs, timerConcealed })');
    expect(timing).toContain('MIN_MANUAL_STOP_MS = 2_000');
  });

  it('registers exactly 30 seconds automatically once', () => {
    expect(timing).toContain('MAX_ATTEMPT_MS = 30_000');
    expect(timing).toContain("finishEvent: 'timeout'");
    expect(timing).toContain('automaticFinish: true');
    expect(control).toContain('onDeadline: finishAutomatically');
    expect(control).toContain('deadline.start()');
    expect(boundedMigration).toContain('p_client_elapsed_ms = 30000');
    expect(boundedMigration).toContain("v_server_elapsed_ms not between 29500 and 40000");
    expect(boundedMigration).toContain("v_challenge.expires_at + interval '10 seconds'");
  });

  it('aligns the server manual window with the concealed timer', () => {
    expect(boundedMigration).toContain('p_client_elapsed_ms not between 2000 and 30000');
    expect(boundedMigration).toContain('v_server_elapsed_ms not between 1800 and 35000');
    expect(boundedMigration).toContain('if not v_is_timeout and abs(v_server_elapsed_ms - p_client_elapsed_ms) > 3000');
  });

  it('regenerates the complete server raster and keeps one modal mounted', () => {
    expect(source).toContain("settle({ kind: 'refresh', previousDigest: challenge.image.digest })");
    expect(source).toContain('previousDigest: previousDigest || undefined');
    expect(source).toContain('created.image.digest === previousDigest');
    expect(source).toContain('Generando una imagen nueva…');
    expect(source).toContain('LOADING_DELAY_MS = 180');
    expect(source).toContain('function createHumanCheckDialog(onCancel)');
    expect(source).toContain('createHumanCheckDialog(() => requestController.abort())');
    expect(source).toContain('signal: requestController.signal');
    expect(source).toContain('requestController.signal.aborted');
    expect(readyApi).toContain('createHumanCheckLayout');
  });

  it('replaces confirmed raster states without exposing drawing commands or coordinates', () => {
    expect(source).toContain("const image = document.createElement('img')");
    expect(source).toContain('element.src = challengeImage.dataUrl');
    expect(source).toContain('element.dataset.digest = challengeImage.digest');
    expect(source).toContain('image.onpointerdown = async (event) => {');
    expect(source).toContain('await applyChallengeImage(image, updated.image)');
    expect(source).not.toContain('drawCaptchaScene');
    expect(source).not.toContain('created.balls');
  });

  it('bootstraps the private account key for the prepare-start action', () => {
    expect(access).toMatch(/const protectedActions = new Set\(\[[\s\S]*'prepare-start'/);
    expect(source).toContain('action: PREPARE_ACTION');
  });

  it('expires readiness after two minutes and restarts the full captcha flow', () => {
    expect(flow).toContain('READY_WINDOW_MS = 120_000');
    expect(source).toContain('if (stageResult.expired) continue;');
    expect(preparedMigration).toContain("v_ready_expires_at timestamptz := v_prepared_at + interval '2 minutes'");
  });

  it('loads timing before the progressive interaction scripts and cache-busts changed assets', () => {
    const timingIndex = index.indexOf('src="./attempt-timing.js?v=20260723"');
    const interceptorIndex = index.indexOf('src="./human-check.js?v=20260802-progressive-footballs"');
    const controlIndex = index.indexOf('src="./stop-control.js?v=20260723"');
    expect(timingIndex).toBeGreaterThan(-1);
    expect(interceptorIndex).toBeGreaterThan(timingIndex);
    expect(controlIndex).toBeGreaterThan(interceptorIndex);
  });

  it('keeps one-time progressive proof, prepare, activate, and finish contracts', () => {
    expect(source).toContain('action: CHECK_ACTION');
    expect(source).toContain('action: CLICK_ACTION');
    expect(source).toContain('action: PREPARE_ACTION');
    expect(source).toContain('action: ACTIVATE_ACTION');
    expect(readyApi).toContain("action === 'human-check-click'");
    expect(readyApi).toContain("action === 'prepare-start'");
    expect(readyApi).toContain("action === 'activate-start'");
    expect(preparedMigration).toContain('challenge_not_activated');
    expect(boundedMigration).toContain('finish_game_attempt_pointer_only');
  });
});
