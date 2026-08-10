import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ZADMIN_LOGIN_LIMIT,
  ZADMIN_LOGIN_WINDOW_SECONDS,
  ZADMIN_MAX_BODY_BYTES,
  ZADMIN_SESSION_TTL_SECONDS,
  adminCredentialsMatch,
  aggregateIntegrityEntities,
  bearerTokenFromHeader,
  fixedLengthHexEqual,
  integrityDistribution,
  normalizeAdminDeviceId,
  normalizeAdminRangeDays,
  normalizeAdminScope,
  normalizeAdminSearch,
  parseBanDurationMinutes,
  pepperedDigest,
  riskBucket,
} from '../supabase/functions/_shared/zadmin-core.js';

test('exports the bounded admin security policy', () => {
  assert.equal(ZADMIN_SESSION_TTL_SECONDS, 12 * 60 * 60);
  assert.equal(ZADMIN_LOGIN_LIMIT, 3);
  assert.equal(ZADMIN_LOGIN_WINDOW_SECONDS, 3_600);
  assert.equal(ZADMIN_MAX_BODY_BYTES, 32 * 1_024);
});

test('normalizes device, scope, range and search inputs', () => {
  assert.equal(normalizeAdminDeviceId(' security-device-106-0001 '), 'security-device-106-0001');
  assert.equal(normalizeAdminDeviceId('short'), null);
  assert.equal(normalizeAdminDeviceId(null), null);

  assert.equal(normalizeAdminScope(' ACCOUNT '), 'account');
  assert.equal(normalizeAdminScope('nick'), 'nick');
  assert.equal(normalizeAdminScope('Ip'), 'ip');
  assert.equal(normalizeAdminScope('device'), null);

  assert.equal(normalizeAdminRangeDays(1), 1);
  assert.equal(normalizeAdminRangeDays('7'), 7);
  assert.equal(normalizeAdminRangeDays(30), 30);
  assert.equal(normalizeAdminRangeDays(365), 7);

  assert.equal(normalizeAdminSearch('  ÁDMIN\u0000 TEST  '), 'ádmin test');
  assert.equal(normalizeAdminSearch('ＡＢＣ'), 'abc');
  assert.equal(normalizeAdminSearch('X'.repeat(100)).length, 80);
});

test('accepts only the configured ban-duration policy', () => {
  assert.deepEqual(parseBanDurationMinutes(null), { valid: true, minutes: null });
  assert.deepEqual(parseBanDurationMinutes('permanent'), { valid: true, minutes: null });
  assert.deepEqual(parseBanDurationMinutes(60), { valid: true, minutes: 60 });
  assert.deepEqual(parseBanDurationMinutes('1440'), { valid: true, minutes: 1_440 });
  assert.deepEqual(parseBanDurationMinutes(10_080), { valid: true, minutes: 10_080 });
  assert.deepEqual(parseBanDurationMinutes(90), { valid: false, minutes: null });
  assert.deepEqual(parseBanDurationMinutes(0), { valid: false, minutes: null });
  assert.deepEqual(parseBanDurationMinutes('invalid'), { valid: false, minutes: null });
});

test('parses only fixed-size bearer session tokens', () => {
  const token = 'Ab'.repeat(32);
  assert.equal(bearerTokenFromHeader(`Bearer ${token}`), token.toLowerCase());
  assert.equal(bearerTokenFromHeader(`bearer ${token}`), token.toLowerCase());
  assert.equal(bearerTokenFromHeader(`Basic ${token}`), null);
  assert.equal(bearerTokenFromHeader('Bearer abc'), null);
  assert.equal(bearerTokenFromHeader(null), null);
});

test('creates domain-separated peppered hashes and compares them without early string equality', async () => {
  const left = await pepperedDigest('secret', 'pepper', 'one');
  const same = await pepperedDigest('secret', 'pepper', 'one');
  const otherValue = await pepperedDigest('other', 'pepper', 'one');
  const otherDomain = await pepperedDigest('secret', 'pepper', 'two');
  assert.match(left, /^[a-f0-9]{64}$/);
  assert.equal(left, same);
  assert.notEqual(left, otherValue);
  assert.notEqual(left, otherDomain);

  assert.equal(fixedLengthHexEqual(left, same.toUpperCase()), true);
  assert.equal(fixedLengthHexEqual(left, otherValue), false);
  assert.equal(fixedLengthHexEqual(left, `${left}00`), false);
  assert.equal(fixedLengthHexEqual('', ''), true);
});

test('credential verification requires both username and password', async () => {
  const base = {
    expectedUsername: 'operator',
    expectedPassword: 'correct horse battery staple',
    pepper: 'test-pepper',
  };
  assert.equal(await adminCredentialsMatch({ ...base, username: 'operator', password: 'correct horse battery staple' }), true);
  assert.equal(await adminCredentialsMatch({ ...base, username: 'other', password: 'correct horse battery staple' }), false);
  assert.equal(await adminCredentialsMatch({ ...base, username: 'operator', password: 'wrong' }), false);
  assert.equal(await adminCredentialsMatch({ ...base, username: 'other', password: 'wrong' }), false);
});

test('maps every risk-score boundary into a stable display bucket', () => {
  assert.equal(riskBucket(-1), '0-19');
  assert.equal(riskBucket('not-a-number'), '0-19');
  assert.equal(riskBucket(19), '0-19');
  assert.equal(riskBucket(20), '20-39');
  assert.equal(riskBucket(39), '20-39');
  assert.equal(riskBucket(40), '40-59');
  assert.equal(riskBucket(59), '40-59');
  assert.equal(riskBucket(60), '60-79');
  assert.equal(riskBucket(79), '60-79');
  assert.equal(riskBucket(80), '80-100');
  assert.equal(riskBucket(150), '80-100');
});

const rows = [
  {
    nick: 'Alpha', nick_key: 'alpha', account_id: 'account-a', ip_hash: 'ip-1', device_hash: 'device-1',
    verified: true, integrity_status: 'eligible', risk_score: 0, created_at: '2026-08-10T09:00:00Z',
  },
  {
    nick: 'Alpha', nick_key: 'alpha', account_id: 'account-a', ip_hash: 'ip-2', device_hash: 'device-1',
    verified: false, integrity_status: 'watch', risk_score: 45, created_at: '2026-08-10T10:00:00Z',
  },
  {
    nick: 'Beta', nick_key: 'beta', account_id: 'account-a', ip_hash: 'ip-2', device_hash: 'device-2',
    verified: false, integrity_status: 'excluded', risk_score: 88, created_at: '2026-08-10T08:00:00Z',
  },
  {
    nick: '', nick_key: 'gamma', account_id: 'account-b', ip_hash: 'ip-3', device_hash: 'device-3',
    verified: true, integrity_status: 'watch', risk_score: 101, created_at: '2026-08-09T08:00:00Z',
  },
  {
    nick: 'No account', nick_key: 'orphan', account_id: null, ip_hash: 'ip-4', device_hash: null,
    verified: true, integrity_status: 'eligible', risk_score: -4, created_at: null,
  },
  {
    nick: null, nick_key: null, account_id: null, ip_hash: null, device_hash: null,
    verified: false, integrity_status: 'excluded', risk_score: 70, created_at: '2026-08-08T00:00:00Z',
  },
];

test('aggregates accounts with correlations, risk and newest activity', () => {
  const result = aggregateIntegrityEntities(rows, 'account');
  assert.equal(result.length, 2);
  assert.equal(result[0].key, 'account-b');
  assert.equal(result[0].maxRiskScore, 100);
  assert.deepEqual(result[1], {
    key: 'account-a',
    label: 'account-a',
    attempts: 3,
    verifiedAttempts: 1,
    watchAttempts: 1,
    excludedAttempts: 1,
    maxRiskScore: 88,
    averageRiskScore: 44,
    distinctNicks: 2,
    distinctAccounts: 1,
    distinctIps: 2,
    distinctDevices: 2,
    lastSeenAt: '2026-08-10T10:00:00Z',
  });
});

test('aggregates nick and IP scopes and filters by normalized key or label', () => {
  const nickResult = aggregateIntegrityEntities(rows, 'nick');
  assert.deepEqual(nickResult.map((entry) => entry.key), ['gamma', 'beta', 'alpha', 'orphan']);
  assert.equal(nickResult.find((entry) => entry.key === 'gamma').label, 'gamma');
  assert.equal(nickResult.find((entry) => entry.key === 'alpha').attempts, 2);

  assert.deepEqual(aggregateIntegrityEntities(rows, 'nick', ' ALP ').map((entry) => entry.key), ['alpha']);
  assert.deepEqual(aggregateIntegrityEntities(rows, 'nick', 'beta').map((entry) => entry.key), ['beta']);

  const ipResult = aggregateIntegrityEntities(rows, 'ip');
  assert.equal(ipResult.find((entry) => entry.key === 'ip-2').attempts, 2);
  assert.equal(ipResult.find((entry) => entry.key === 'ip-4').distinctDevices, 0);

  assert.deepEqual(aggregateIntegrityEntities(rows, 'unsupported', 'orphan').map((entry) => entry.key), ['orphan']);
  assert.deepEqual(aggregateIntegrityEntities(null, 'nick'), []);
});

test('uses risk, exclusion, volume and label as deterministic ordering tie-breakers', () => {
  const tieRows = [
    { nick: 'Zulu', nick_key: 'zulu', risk_score: 50, integrity_status: 'eligible' },
    { nick: 'Alpha', nick_key: 'alpha', risk_score: 50, integrity_status: 'eligible' },
    { nick: 'Bravo', nick_key: 'bravo', risk_score: 50, integrity_status: 'excluded' },
    { nick: 'Charlie', nick_key: 'charlie', risk_score: 50, integrity_status: 'eligible' },
    { nick: 'Charlie', nick_key: 'charlie', risk_score: 0, integrity_status: 'eligible' },
    { nick: 'Risk', nick_key: 'risk', risk_score: 90, integrity_status: 'eligible' },
  ];
  assert.deepEqual(aggregateIntegrityEntities(tieRows, 'nick').map((entry) => entry.key), [
    'risk', 'bravo', 'charlie', 'alpha', 'zulu',
  ]);
});

test('counts all risk buckets without trusting out-of-range input', () => {
  assert.deepEqual(integrityDistribution([
    { risk_score: 0 },
    { risk_score: 20 },
    { risk_score: 40 },
    { risk_score: 60 },
    { risk_score: 80 },
    { risk_score: 1_000 },
  ]), {
    '0-19': 1,
    '20-39': 1,
    '40-59': 1,
    '60-79': 1,
    '80-100': 2,
  });
  assert.deepEqual(integrityDistribution(null), {
    '0-19': 0,
    '20-39': 0,
    '40-59': 0,
    '60-79': 0,
    '80-100': 0,
  });
});
