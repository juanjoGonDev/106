import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:3000';

function readLocalEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);

  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  const environment = {
    apiUrl: values.API_URL || 'http://127.0.0.1:54321',
    anonKey: values.ANON_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY,
    databaseUrl: values.DB_URL || values.POSTGRES_URL,
  };
  if (!environment.anonKey || !environment.serviceRoleKey || !environment.databaseUrl) {
    throw new Error('Local Supabase auth environment is incomplete.');
  }
  return environment;
}

function psql(databaseUrl, sql) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${url}, received ${text.slice(0, 300)}`);
  }
  return { response, body };
}

async function createAuthUser(environment, email, password) {
  const created = await jsonRequest(`${environment.apiUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: environment.serviceRoleKey,
      authorization: `Bearer ${environment.serviceRoleKey}`,
    },
    body: { email, password, email_confirm: true },
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
}

async function signIn(environment, email, password) {
  const result = await jsonRequest(`${environment.apiUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: environment.anonKey },
    body: { email, password },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.access_token;
}

async function createAnonymousPlayer(environment, token, nick) {
  const result = await jsonRequest(`${environment.apiUrl}/functions/v1/game-api`, {
    headers: {
      'x-account-token': token,
      'x-device-id': `concurrency-player-${randomUUID()}`.slice(0, 80),
    },
    body: { action: 'link-account-player', nick },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.authorized, true);
}

function seedCompetitiveImpact(databaseUrl, sourceNick, targetNick, suffix) {
  psql(databaseUrl, `
    insert into public.game_referrals(
      referral_code, referrer_nick_key, referred_nick_key,
      referred_device_hash, referred_ip_hash, completed_at
    ) values (
      gen_random_uuid(), ${sqlLiteral(sourceNick)}, ${sqlLiteral(targetNick)},
      ${sqlLiteral(`concurrency-referral-device-${suffix}`)},
      ${sqlLiteral(`concurrency-referral-ip-${suffix}`)},
      clock_timestamp()
    );
    update public.game_player_bonus
    set bonus_attempts = bonus_attempts + 1,
        updated_at = clock_timestamp()
    where nick_key = ${sqlLiteral(sourceNick)};
  `);
}

async function accountAuth(environment, jwt, action, body = {}, accountToken = '') {
  const headers = {
    apikey: environment.anonKey,
    authorization: `Bearer ${jwt}`,
    'x-device-id': `concurrency-auth-${randomUUID()}`.slice(0, 80),
  };
  if (accountToken) headers['x-account-token'] = accountToken;
  return jsonRequest(`${environment.apiUrl}/functions/v1/account-auth`, {
    headers,
    body: { action, ...body },
  });
}

async function prepareMerge(environment, suffix, caseName) {
  const password = 'MergeConcurrencyPassword123!';
  const targetToken = randomBytes(32).toString('hex');
  const sourceToken = randomBytes(32).toString('hex');
  const targetNick = `${caseName}T${suffix}`.slice(0, 24);
  const sourceNick = `${caseName}S${suffix}`.slice(0, 24);
  await createAnonymousPlayer(environment, targetToken, targetNick);
  await createAnonymousPlayer(environment, sourceToken, sourceNick);

  const email = `${caseName.toLowerCase()}-${suffix}@example.com`;
  await createAuthUser(environment, email, password);
  const jwt = await signIn(environment, email, password);

  const linked = await accountAuth(environment, jwt, 'sync-account', {}, targetToken);
  assert.equal(linked.response.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.linked, true);

  seedCompetitiveImpact(environment.databaseUrl, sourceNick, targetNick, `${caseName}-${suffix}`);
  const proposal = await accountAuth(environment, jwt, 'sync-account', {}, sourceToken);
  assert.equal(proposal.response.status, 200, JSON.stringify(proposal.body));
  assert.equal(proposal.body.mergeRequired, true);
  assert.equal(proposal.body.impact.referrals.length, 1);
  assert.match(proposal.body.proposalId, /^[0-9a-f-]{36}$/);
  assert.match(proposal.body.fingerprint, /^[a-f0-9]{64}$/);

  return { jwt, sourceToken, proposal };
}

const environment = readLocalEnvironment();
const suffix = Date.now().toString(36);

const duplicate = await prepareMerge(environment, suffix, 'Duplicate');
const duplicateBody = {
  proposalId: duplicate.proposal.body.proposalId,
  fingerprint: duplicate.proposal.body.fingerprint,
};
const firstConfirmation = await accountAuth(
  environment,
  duplicate.jwt,
  'confirm-merge',
  duplicateBody,
  duplicate.sourceToken,
);
assert.equal(firstConfirmation.response.status, 200, JSON.stringify(firstConfirmation.body));
assert.equal(firstConfirmation.body.merged, true);
assert.notEqual(firstConfirmation.body.alreadyMerged, true);

const repeatedConfirmation = await accountAuth(
  environment,
  duplicate.jwt,
  'confirm-merge',
  duplicateBody,
  duplicate.sourceToken,
);
assert.equal(repeatedConfirmation.response.status, 200, JSON.stringify(repeatedConfirmation.body));
assert.equal(repeatedConfirmation.body.merged, true);
assert.equal(repeatedConfirmation.body.alreadyMerged, true);
process.stdout.write('✓ merge confirmation is idempotent after a successful commit\n');

const concurrent = await prepareMerge(environment, suffix, 'Concurrent');
const concurrentBody = {
  proposalId: concurrent.proposal.body.proposalId,
  fingerprint: concurrent.proposal.body.fingerprint,
};
const concurrentResults = await Promise.all([
  accountAuth(environment, concurrent.jwt, 'confirm-merge', concurrentBody, concurrent.sourceToken),
  accountAuth(environment, concurrent.jwt, 'confirm-merge', concurrentBody, concurrent.sourceToken),
]);
for (const result of concurrentResults) {
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.merged, true);
}
assert.equal(
  concurrentResults.filter((result) => result.body.alreadyMerged === true).length,
  1,
  'Exactly one concurrent request must observe the already committed merge.',
);
process.stdout.write('✓ concurrent confirmations serialize to one merge and one idempotent replay\n');

const expired = await prepareMerge(environment, suffix, 'Expired');
psql(environment.databaseUrl, `
  update public.game_account_merge_proposals
  set expires_at = clock_timestamp() - interval '1 second'
  where id = ${sqlLiteral(expired.proposal.body.proposalId)}::uuid;
`);
const expiredResult = await accountAuth(environment, expired.jwt, 'confirm-merge', {
  proposalId: expired.proposal.body.proposalId,
  fingerprint: expired.proposal.body.fingerprint,
}, expired.sourceToken);
assert.equal(expiredResult.response.status, 409, JSON.stringify(expiredResult.body));
assert.equal(expiredResult.body.code, 'merge_proposal_expired');
process.stdout.write('✓ expired merge proposals cannot mutate account or competitive data\n');

const mismatch = await prepareMerge(environment, suffix, 'Mismatch');
const mismatchResult = await accountAuth(environment, mismatch.jwt, 'confirm-merge', {
  proposalId: mismatch.proposal.body.proposalId,
  fingerprint: 'f'.repeat(64),
}, mismatch.sourceToken);
assert.equal(mismatchResult.response.status, 400, JSON.stringify(mismatchResult.body));
assert.equal(mismatchResult.body.code, 'merge_proposal_mismatch');
process.stdout.write('✓ confirmation rejects fingerprints that do not match the displayed impact\n');
