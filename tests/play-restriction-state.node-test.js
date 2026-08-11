import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatRestrictionCountdown,
  normalizePlayRestriction,
  restrictionEndText,
  restrictionReasonText,
  restrictionRemainingSeconds,
  restrictionScopeLabel,
  restrictionSourceLabel,
} from '../public/play-restriction-state.js';

const now = Date.parse('2026-08-11T08:00:00Z');

test('normalizes active timed restrictions and rejects inactive or expired values', () => {
  assert.equal(normalizePlayRestriction(null, now), null);
  assert.equal(normalizePlayRestriction({}, now), null);
  assert.equal(normalizePlayRestriction({ active: false }, now), null);
  assert.equal(normalizePlayRestriction({ active: true, expiresAt: 'invalid' }, now), null);
  assert.equal(normalizePlayRestriction({ active: true, expiresAt: '2026-08-11T08:00:00Z' }, now), null);

  const restriction = normalizePlayRestriction({
    active: true,
    source: 'manual',
    scope: 'nick',
    expiresAt: '2026-08-11T09:00:00Z',
    retryAfterSeconds: 99,
  }, now);
  assert.deepEqual(restriction, {
    active: true,
    source: 'manual',
    scope: 'nick',
    permanent: false,
    expiresAt: '2026-08-11T09:00:00.000Z',
    expiresAtMs: Date.parse('2026-08-11T09:00:00Z'),
    retryAfterSeconds: 3_600,
  });
});

test('defaults unknown source and scope safely and preserves permanent restrictions', () => {
  const permanent = normalizePlayRestriction({
    active: true,
    source: 'unknown',
    scope: 'unknown',
    permanent: true,
  }, now);
  assert.deepEqual(permanent, {
    active: true,
    source: 'integrity',
    scope: 'account',
    permanent: true,
    expiresAt: null,
    expiresAtMs: null,
    retryAfterSeconds: null,
  });

  const nullExpiry = normalizePlayRestriction({ active: true, source: 'manual', scope: 'ip', expiresAt: null }, now);
  assert.equal(nullExpiry.permanent, true);
});

test('derives remaining time from the absolute expiry without drift', () => {
  const restriction = normalizePlayRestriction({
    active: true,
    source: 'integrity',
    scope: 'device',
    expiresAt: '2026-08-12T10:02:03Z',
  }, now);
  assert.equal(restrictionRemainingSeconds(restriction, now), 93_723);
  assert.equal(restrictionRemainingSeconds(restriction, Date.parse('2026-08-12T10:02:03Z')), 0);
  assert.equal(restrictionRemainingSeconds({ active: true, permanent: true }, now), null);
  assert.equal(restrictionRemainingSeconds(null, now), null);
});

test('formats countdowns across seconds, hours and days', () => {
  assert.equal(formatRestrictionCountdown(-10), '00:00:00');
  assert.equal(formatRestrictionCountdown('invalid'), '00:00:00');
  assert.equal(formatRestrictionCountdown(5), '00:00:05');
  assert.equal(formatRestrictionCountdown(3_661), '01:01:01');
  assert.equal(formatRestrictionCountdown(90_061), '1 d 01:01:01');
});

test('provides bounded public source, scope and reason copy', () => {
  assert.equal(restrictionScopeLabel('nick'), 'nick');
  assert.equal(restrictionScopeLabel('device'), 'dispositivo');
  assert.equal(restrictionScopeLabel('ip'), 'conexión');
  assert.equal(restrictionScopeLabel('account'), 'cuenta');
  assert.equal(restrictionScopeLabel('other'), 'cuenta');
  assert.equal(restrictionSourceLabel('manual'), 'Administración');
  assert.equal(restrictionSourceLabel('integrity'), 'Integridad automática');
  assert.equal(
    restrictionReasonText({ source: 'manual', scope: 'ip' }),
    'Hay una restricción manual activa asociada a esta conexión.',
  );
  assert.equal(
    restrictionReasonText({ source: 'integrity', scope: 'device' }),
    'Los controles de integridad han bloqueado temporalmente el juego competitivo para este dispositivo.',
  );
});

test('formats restriction end text only when meaningful', () => {
  assert.equal(restrictionEndText(null), '');
  assert.equal(restrictionEndText({ active: false }), '');
  assert.equal(restrictionEndText({ active: true, permanent: true }), 'Sin fecha de finalización.');
  assert.equal(restrictionEndText({ active: true, permanent: false, expiresAt: 'invalid' }), '');
  assert.match(
    restrictionEndText({ active: true, permanent: false, expiresAt: '2026-08-11T09:00:00Z' }),
    /^Finaliza el /,
  );
});
