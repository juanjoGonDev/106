import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/human-check.js', 'utf8');
const flow = readFileSync('public/human-check-ready-flow.js', 'utf8');
const index = readFileSync('public/index.html', 'utf8');
const styles = readFileSync('public/v9.css', 'utf8');

describe('explicit post-captcha readiness', () => {
  it('does not start when the final numbered ball is selected', () => {
    expect(source).not.toContain('setTimeout(succeed');
    expect(source).toContain('if (completedCount === balls.length) showReadyAction();');
    expect(source).toContain("readyButton.addEventListener('click', beginCountdown)");
    expect(source).toContain("event?.isTrusted !== true");
  });

  it('requires an explicit ready action and a 3, 2, 1 countdown', () => {
    expect(source).toContain("readyButton.textContent = 'Estoy preparado'");
    expect(source).toContain('readyFlow.startCountdown()');
    expect(source).toContain('countdown.textContent = String(value)');
    expect(flow).toContain('Object.freeze([3, 2, 1])');
    expect(flow).toContain('COUNTDOWN_INTERVAL_MS = 1_000');
  });

  it('expires the ready state after exactly two minutes and refreshes the captcha', () => {
    expect(flow).toContain('READY_WINDOW_MS = 120_000');
    expect(source).toContain('new HumanCheckRefreshError');
    expect(source).toContain('if (isRefreshError(error)) continue;');
    expect(source).toContain('serverFailures += 1');
  });

  it('loads the covered state controller before the fetch interceptor', () => {
    const flowIndex = index.indexOf('src="./human-check-ready-flow.js"');
    const interceptorIndex = index.indexOf('src="./human-check.js"');
    expect(flowIndex).toBeGreaterThan(-1);
    expect(interceptorIndex).toBeGreaterThan(flowIndex);
  });

  it('keeps a stable responsive action stage', () => {
    expect(styles).toContain('.human-check-panel { min-height:');
    expect(styles).toContain('grid-template-rows:');
    expect(styles).toContain('.human-check-action-stage');
    expect(styles).toContain('.human-check-countdown');
    expect(styles).toContain('@media (max-width: 620px)');
  });

  it('still uses the server-issued one-time proof before forwarding start', () => {
    expect(source).toContain('action: CHECK_ACTION');
    expect(source).toContain('action: COMPLETE_ACTION');
    expect(source).toContain('humanProofToken: completed.proofToken');
    expect(source).toContain('body: JSON.stringify({ ...body, ...proof })');
  });
});
