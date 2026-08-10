export const ZADMIN_SESSION_TTL_SECONDS = 30 * 60;
export const ZADMIN_LOGIN_LIMIT = 3;
export const ZADMIN_LOGIN_WINDOW_SECONDS = 60 * 60;
export const ZADMIN_MAX_BODY_BYTES = 32 * 1024;

const DEVICE_ID = /^[a-zA-Z0-9._:-]{16,80}$/;
const SESSION_TOKEN = /^[a-f0-9]{64}$/i;
const ADMIN_SCOPES = new Set(['account', 'nick', 'ip']);
const RANGE_DAYS = new Set([1, 7, 30]);

export function normalizeAdminDeviceId(value) {
  const deviceId = String(value ?? '').trim();
  return DEVICE_ID.test(deviceId) ? deviceId : null;
}

export function normalizeAdminScope(value) {
  const scope = String(value ?? '').trim().toLowerCase();
  return ADMIN_SCOPES.has(scope) ? scope : null;
}

export function parseBanDurationMinutes(value) {
  if (value === null || value === 'permanent') return { valid: true, minutes: null };
  const minutes = Number(value);
  const hourly = Number.isInteger(minutes) && minutes >= 60 && minutes <= 1_440 && minutes % 60 === 0;
  if (hourly || minutes === 10_080) return { valid: true, minutes };
  return { valid: false, minutes: null };
}

export function normalizeAdminRangeDays(value) {
  const days = Number(value);
  return RANGE_DAYS.has(days) ? days : 7;
}

export function normalizeAdminSearch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .toLocaleLowerCase('es')
    .slice(0, 80);
}

export function bearerTokenFromHeader(value) {
  const match = String(value ?? '').match(/^Bearer\s+([a-f0-9]{64})$/i);
  return match && SESSION_TOKEN.test(match[1]) ? match[1].toLowerCase() : null;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pepperedDigest(value, pepper, label) {
  const source = `${String(pepper ?? '')}:${String(label ?? '')}:${String(value ?? '')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return bytesToHex(new Uint8Array(digest));
}

export function fixedLengthHexEqual(left, right) {
  const leftValue = String(left ?? '').toLowerCase();
  const rightValue = String(right ?? '').toLowerCase();
  let mismatch = leftValue.length ^ rightValue.length;
  const length = Math.max(leftValue.length, rightValue.length, 64);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function adminCredentialsMatch({ username, password, expectedUsername, expectedPassword, pepper }) {
  const [suppliedUser, configuredUser, suppliedPassword, configuredPassword] = await Promise.all([
    pepperedDigest(username, pepper, 'zadmin-user'),
    pepperedDigest(expectedUsername, pepper, 'zadmin-user'),
    pepperedDigest(password, pepper, 'zadmin-password'),
    pepperedDigest(expectedPassword, pepper, 'zadmin-password'),
  ]);
  const userMatches = fixedLengthHexEqual(suppliedUser, configuredUser);
  const passwordMatches = fixedLengthHexEqual(suppliedPassword, configuredPassword);
  return userMatches && passwordMatches;
}

export function riskBucket(score) {
  const normalized = Math.max(0, Math.min(100, Number(score) || 0));
  if (normalized >= 80) return '80-100';
  if (normalized >= 60) return '60-79';
  if (normalized >= 40) return '40-59';
  if (normalized >= 20) return '20-39';
  return '0-19';
}

export function aggregateIntegrityEntities(rows, scope, search = '') {
  const normalizedScope = normalizeAdminScope(scope) ?? 'nick';
  const normalizedSearch = normalizeAdminSearch(search);
  const entities = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizedScope === 'account'
      ? row.account_id
      : normalizedScope === 'ip'
        ? row.ip_hash
        : row.nick_key;
    if (!key) continue;
    const label = normalizedScope === 'nick' ? (row.nick || row.nick_key) : String(key);
    const current = entities.get(String(key)) ?? {
      key: String(key),
      label: String(label),
      attempts: 0,
      verifiedAttempts: 0,
      watchAttempts: 0,
      excludedAttempts: 0,
      maxRiskScore: 0,
      riskScoreTotal: 0,
      nicks: new Set(),
      accounts: new Set(),
      ips: new Set(),
      devices: new Set(),
      lastSeenAt: null,
    };
    const riskScore = Math.max(0, Math.min(100, Number(row.risk_score) || 0));
    current.attempts += 1;
    current.verifiedAttempts += row.verified === true ? 1 : 0;
    current.watchAttempts += row.integrity_status === 'watch' ? 1 : 0;
    current.excludedAttempts += row.integrity_status === 'excluded' ? 1 : 0;
    current.maxRiskScore = Math.max(current.maxRiskScore, riskScore);
    current.riskScoreTotal += riskScore;
    if (row.nick_key) current.nicks.add(String(row.nick_key));
    if (row.account_id) current.accounts.add(String(row.account_id));
    if (row.ip_hash) current.ips.add(String(row.ip_hash));
    if (row.device_hash) current.devices.add(String(row.device_hash));
    const createdAt = row.created_at ? String(row.created_at) : null;
    if (createdAt && (!current.lastSeenAt || createdAt > current.lastSeenAt)) current.lastSeenAt = createdAt;
    entities.set(String(key), current);
  }

  return [...entities.values()]
    .filter((entity) => !normalizedSearch
      || entity.key.toLocaleLowerCase('es').includes(normalizedSearch)
      || entity.label.toLocaleLowerCase('es').includes(normalizedSearch))
    .map((entity) => ({
      key: entity.key,
      label: entity.label,
      attempts: entity.attempts,
      verifiedAttempts: entity.verifiedAttempts,
      watchAttempts: entity.watchAttempts,
      excludedAttempts: entity.excludedAttempts,
      maxRiskScore: entity.maxRiskScore,
      averageRiskScore: entity.attempts ? Math.round(entity.riskScoreTotal / entity.attempts) : 0,
      distinctNicks: entity.nicks.size,
      distinctAccounts: entity.accounts.size,
      distinctIps: entity.ips.size,
      distinctDevices: entity.devices.size,
      lastSeenAt: entity.lastSeenAt,
    }))
    .sort((left, right) => right.maxRiskScore - left.maxRiskScore
      || right.excludedAttempts - left.excludedAttempts
      || right.attempts - left.attempts
      || left.label.localeCompare(right.label, 'es'));
}

export function integrityDistribution(rows) {
  const buckets = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
  for (const row of Array.isArray(rows) ? rows : []) buckets[riskBucket(row.risk_score)] += 1;
  return buckets;
}
