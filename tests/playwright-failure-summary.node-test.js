import assert from 'node:assert/strict';
import test from 'node:test';

import {
  playwrightFailureSlug,
  slugifyFailure,
} from '../scripts/playwright-failure-summary.mjs';

test('normalizes safe bounded artifact slugs', () => {
  assert.equal(slugifyFailure('  Verificación Ágil: Error!  '), 'verificacion-agil-error');
  assert.equal(slugifyFailure('***'), 'unknown');
  assert.equal(slugifyFailure(null), 'unknown');
  assert.equal(slugifyFailure('a'.repeat(200)).length, 120);
  assert.equal(slugifyFailure(`${'a'.repeat(119)}---`).endsWith('-'), false);
});

test('summarizes the first nested failed Playwright result', () => {
  const report = {
    suites: [{
      suites: [{
        file: '/repo/tests/e2e/account-auth.e2e.js',
        specs: [{
          title: 'resends pending confirmation',
          tests: [{
            results: [
              { status: 'passed' },
              { status: 'failed', errors: [{ message: '\u001b[31mExpected button to be enabled\u001b[0m\nstack' }] },
            ],
          }],
        }],
      }],
    }],
  };
  assert.equal(
    playwrightFailureSlug(report),
    'account-auth-e2e-js-resends-pending-confirmation-expected-button-to-be-enabled',
  );
});

test('falls back through test fields and post-processing output', () => {
  const report = {
    suites: [{
      file: '/repo/fallback.e2e.js',
      specs: [{
        tests: [{
          title: 'fallback title',
          results: [{ status: 'timedOut', error: { message: 'Timed out after 30s' } }],
        }],
      }],
    }],
  };
  assert.equal(
    playwrightFailureSlug(report),
    'fallback-e2e-js-fallback-title-timed-out-after-30s',
  );
  assert.equal(playwrightFailureSlug({}, 'first\n\u001b[31mFFmpeg failed\u001b[0m\n'), 'ffmpeg-failed');
  assert.equal(playwrightFailureSlug(null, ''), 'postprocess-failure');
});

test('ignores passed and skipped results before selecting a failure', () => {
  const report = {
    suites: [{
      specs: [{
        title: 'healthy',
        tests: [{ results: [{ status: 'passed' }, { status: 'skipped' }] }],
      }, {
        title: 'broken',
        tests: [{ results: [{ status: 'failed', errors: [] }] }],
      }],
    }],
  };
  assert.equal(playwrightFailureSlug(report), 'playwright-broken-failed');
});

test('covers defensive report shapes and every fallback field', () => {
  assert.equal(playwrightFailureSlug({ suites: 'invalid' }, '\nlast line\n'), 'last-line');
  assert.equal(playwrightFailureSlug({ suites: [{ suites: 'invalid', specs: 'invalid' }] }), 'postprocess-failure');
  assert.equal(playwrightFailureSlug({ suites: [{ specs: [{ tests: 'invalid' }] }] }), 'postprocess-failure');
  assert.equal(playwrightFailureSlug({ suites: [{ specs: [{ tests: [{ results: 'invalid' }] }] }] }), 'postprocess-failure');
  assert.equal(playwrightFailureSlug({
    suites: [{
      specs: [{
        tests: [{
          title: 'test title',
          results: [{ status: 'failed', error: { message: '\nSecond line' } }],
        }],
      }],
    }],
  }), 'playwright-test-title-second-line');
  assert.equal(playwrightFailureSlug({
    suites: [{ specs: [{ tests: [{ results: [{ status: 'failed' }] }] }] }],
  }), 'playwright-test-failed');
  assert.equal(playwrightFailureSlug({
    suites: [{
      file: '/suite-file.js',
      specs: [{
        file: '/spec-file.js',
        title: '',
        tests: [{
          title: '',
          results: [{ status: 'failed', errors: [{ message: '' }] }],
        }],
      }],
    }],
  }), 'spec-file-js-test-failed');
});

test('handles empty nullable failure messages', () => {
  assert.equal(playwrightFailureSlug({
    suites: [{
      specs: [{
        tests: [{
          results: [{ status: null, errors: [{ message: null }], error: { message: null } }],
        }],
      }],
    }],
  }), 'playwright-test');
});
