import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/human-check.js', 'utf8');
const styles = readFileSync('public/v9.css', 'utf8');

describe('explicit post-captcha start', () => {
  it('does not start the game when the final numbered ball is selected', () => {
    expect(source).not.toContain('setTimeout(succeed');
    expect(source).toContain('if (completedCount === balls.length) showExplicitStart();');
    expect(source).toContain("continueButton.addEventListener('click', succeed)");
    expect(source).toContain("event?.isTrusted !== true");
  });

  it('hides the completed counter and presents a separate start action', () => {
    expect(source).toContain("continueButton.textContent = 'Empezar intento'");
    expect(source).toContain('progress.hidden = true');
    expect(source).toContain('continueButton.hidden = false');
    expect(source).toContain('continueButton.focus()');
  });

  it('reserves stable panel rows on desktop and mobile', () => {
    expect(styles).toContain('.human-check-panel { min-height:');
    expect(styles).toContain('grid-template-rows:');
    expect(styles).toContain('.human-check-progress[hidden]');
    expect(styles).toContain('@media (max-width: 620px)');
  });

  it('still uses server-issued, one-time proof before forwarding start', () => {
    expect(source).toContain("action: CHECK_ACTION");
    expect(source).toContain("action: COMPLETE_ACTION");
    expect(source).toContain('humanProofToken: completed.proofToken');
    expect(source).toContain('body: JSON.stringify({ ...body, ...proof })');
  });
});
