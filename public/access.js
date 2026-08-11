const LEGACY_ACCESS_STORAGE_KEY = 'minuto106:player-access-v1';
const ACCOUNT_STORAGE_KEY = 'minuto106:account-access-v1';
const ACCOUNT_NICKS_STORAGE_KEY = 'minuto106:account-nicks-v1';
const ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY = 'minuto106:account-daily-attempt-policy-v1';
const ACTIVE_NICK_STORAGE_KEY = 'minuto106:nick';
const ACCESS_ASSET_BASE = String(document.currentScript?.src || '').replace(/[^/]*$/, '') || './';
const protectedActions = new Set([
  'start',
  'prepare-start',
  'create-duel',
  'resolve-duel',
  'create-league',
  'join-league',
  'player-leagues',
  'league-status',
  'link-account-player',
]);
const accountActions = new Set([
  ...protectedActions,
  'account-players',
  'player-context',
  'set-featured-achievements',
]);

function normalizeAccessNick(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function dispatchAccountUpdated() {
  document.dispatchEvent(new CustomEvent('minuto106:account-updated'));
}

function readLegacyAccessMap() {
  const value = readJsonStorage(LEGACY_ACCESS_STORAGE_KEY, {});
  return isRecord(value) ? value : {};
}

function generatePrivateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeAccountToken(token) {
  const normalizedToken = String(token ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedToken)) {
    throw new Error('La clave de cuenta debe contener 64 caracteres hexadecimales.');
  }
  return normalizedToken;
}

function writeAccountDailyAttemptPolicy(policy) {
  if (!isRecord(policy)) {
    localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
    return null;
  }
  try {
    const normalized = JSON.parse(JSON.stringify(policy));
    if (!isRecord(normalized)) throw new Error('invalid policy');
    localStorage.setItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
    return null;
  }
}

function getAccountDailyAttemptPolicy() {
  const policy = readJsonStorage(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY, null);
  return isRecord(policy) ? policy : null;
}

function getAccountToken(create = false) {
  let token = String(localStorage.getItem(ACCOUNT_STORAGE_KEY) || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) token = '';
  if (!token && create) {
    token = generatePrivateKey();
    localStorage.setItem(ACCOUNT_STORAGE_KEY, token);
    localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
    dispatchAccountUpdated();
  }
  return token;
}

function setAccountToken(token) {
  const normalizedToken = normalizeAccountToken(token);
  localStorage.setItem(ACCOUNT_STORAGE_KEY, normalizedToken);
  localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
  dispatchAccountUpdated();
  return normalizedToken;
}

function setAccountDailyAttemptPolicy(policy) {
  const normalized = writeAccountDailyAttemptPolicy(policy);
  dispatchAccountUpdated();
  return normalized;
}

function setAccountSession(token, policy) {
  const normalizedToken = normalizeAccountToken(token);
  localStorage.setItem(ACCOUNT_STORAGE_KEY, normalizedToken);
  writeAccountDailyAttemptPolicy(policy);
  dispatchAccountUpdated();
  return normalizedToken;
}

function clearAccountToken() {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
  dispatchAccountUpdated();
}

function clearAccountSession() {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  localStorage.removeItem(ACCOUNT_NICKS_STORAGE_KEY);
  localStorage.removeItem(ACCOUNT_DAILY_ATTEMPT_POLICY_STORAGE_KEY);
  localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_NICK_STORAGE_KEY);
  dispatchAccountUpdated();
}

function getLegacyPlayerKey(nick) {
  const key = normalizeAccessNick(nick);
  if (!key) return '';
  return String(readLegacyAccessMap()[key] || '').trim().toLowerCase();
}

function getLegacyLocalNicks() {
  return Object.keys(readLegacyAccessMap());
}

function forgetLegacyPlayerKey(nick) {
  const key = normalizeAccessNick(nick);
  if (!key) return;
  const map = readLegacyAccessMap();
  if (!(key in map)) return;
  delete map[key];
  if (Object.keys(map).length > 0) localStorage.setItem(LEGACY_ACCESS_STORAGE_KEY, JSON.stringify(map));
  else localStorage.removeItem(LEGACY_ACCESS_STORAGE_KEY);
}

function rememberAccountNick(nick) {
  const normalized = String(nick ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const key = normalizeAccessNick(normalized);
  if (!key) return;
  const entries = readJsonStorage(ACCOUNT_NICKS_STORAGE_KEY, {});
  const map = isRecord(entries) ? entries : {};
  map[key] = normalized;
  localStorage.setItem(ACCOUNT_NICKS_STORAGE_KEY, JSON.stringify(map));
}

function getRememberedNicks() {
  const entries = readJsonStorage(ACCOUNT_NICKS_STORAGE_KEY, {});
  return isRecord(entries) ? Object.values(entries) : [];
}

window.Minuto106Access = {
  clearAccountSession,
  clearAccountToken,
  forgetLegacyPlayerKey,
  generatePrivateKey,
  getAccountDailyAttemptPolicy,
  getAccountToken,
  getLegacyLocalNicks,
  getLegacyPlayerKey,
  getRememberedNicks,
  normalizeAccessNick,
  rememberAccountNick,
  setAccountDailyAttemptPolicy,
  setAccountSession,
  setAccountToken,
};

function loadNicknameRequirementComponent() {
  if (document.querySelector('script[data-minuto106-nickname-requirement]')) {
    window.Minuto106NicknameRequirement?.refresh?.().catch?.(() => {});
    return;
  }
  const script = document.createElement('script');
  script.src = `${ACCESS_ASSET_BASE}nickname-requirement.js?v=202608111333`;
  script.dataset.minuto106NicknameRequirement = 'true';
  script.async = false;
  document.head.append(script);
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  let body;
  try {
    body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }

  const action = String(body?.action || '');
  if (body && accountActions.has(action)) {
    const createAccount = protectedActions.has(action);
    const accountToken = getAccountToken(createAccount);
    const headers = new Headers(init.headers || {});
    if (accountToken) headers.set('x-account-token', accountToken);

    if (protectedActions.has(action)) {
      const nick = String(
        body.nick
        || document.querySelector('#nick')?.value
        || document.querySelector('#leagueNick')?.value
        || localStorage.getItem(ACTIVE_NICK_STORAGE_KEY)
        || '',
      ).trim();
      const legacyToken = getLegacyPlayerKey(nick);
      if (legacyToken) headers.set('x-player-token', legacyToken);
    }
    init = { ...init, headers };
  }

  const response = await originalFetch(input, init);
  if (body && protectedActions.has(action) && response.ok) {
    const nick = String(
      body.nick
      || document.querySelector('#nick')?.value
      || document.querySelector('#leagueNick')?.value
      || '',
    ).trim();
    if (nick) rememberAccountNick(nick);
  }
  if (!response.ok) {
    response.clone().json().then((payload) => {
      const message = String(payload?.error || '');
      const code = String(payload?.code || '');
      if (code === 'nickname_change_required') {
        document.dispatchEvent(new CustomEvent('minuto106:nickname-change-required', { detail: { playerId: payload?.playerId || null } }));
        loadNicknameRequirementComponent();
      }
      if (message.includes('cuenta') || message.includes('clave') || message.includes('pertenece a otra')) {
        document.dispatchEvent(new CustomEvent('minuto106:access-denied', { detail: { message } }));
      }
    }).catch(() => {});
  }
  return response;
};

function currentNick() {
  return String(
    document.querySelector('#nick')?.value
    || document.querySelector('#leagueNick')?.value
    || localStorage.getItem(ACTIVE_NICK_STORAGE_KEY)
    || '',
  ).trim();
}

function refreshAccessPanel() {
  const panel = document.querySelector('#playerAccessPanel');
  const status = document.querySelector('#playerAccessStatus');
  if (!panel || !status) return;
  const nick = currentNick();
  panel.hidden = nick.length < 2;
  status.textContent = nick.length < 2
    ? ''
    : getAccountToken(false)
      ? 'Este navegador tiene tu clave de cuenta. Los nicks que uses quedarán vinculados a ella.'
      : 'Al comenzar se creará una única clave privada para todos tus nicks.';
}

document.addEventListener('DOMContentLoaded', () => {
  const copyButton = document.querySelector('#copyPlayerKeyButton');
  const importButton = document.querySelector('#importPlayerKeyButton');
  const field = document.querySelector('#playerKeyInput');
  if (copyButton) copyButton.textContent = 'Copiar clave de cuenta';
  if (importButton) importButton.textContent = 'Importar cuenta';
  if (field) field.placeholder = 'Pega la clave privada de tu cuenta';

  document.querySelector('#nick')?.addEventListener('input', refreshAccessPanel);
  document.querySelector('#leagueNick')?.addEventListener('input', refreshAccessPanel);
  copyButton?.addEventListener('click', async () => {
    const token = getAccountToken(true);
    await navigator.clipboard.writeText(token);
    copyButton.textContent = 'Clave copiada';
    setTimeout(() => { copyButton.textContent = 'Copiar clave de cuenta'; }, 1600);
    refreshAccessPanel();
  });
  importButton?.addEventListener('click', async () => {
    try {
      setAccountToken(field?.value || '');
      if (field) field.value = '';
      refreshAccessPanel();
      await window.Minuto106UI?.success({
        title: 'Cuenta vinculada',
        message: 'Este dispositivo ya puede utilizar todos los nicks vinculados. Puedes consultarlos desde Mi cuenta.',
      });
    } catch (error) {
      await window.Minuto106UI?.error({
        title: 'Clave no válida',
        message: error instanceof Error ? error.message : 'La clave introducida no es válida.',
      });
    }
  });
  document.addEventListener('minuto106:access-denied', (event) => {
    const panel = document.querySelector('#playerAccessPanel');
    if (panel) panel.hidden = false;
    const status = document.querySelector('#playerAccessStatus');
    if (status) status.textContent = event.detail?.message || 'Introduce la clave privada correcta de tu cuenta.';
  });
  document.addEventListener('minuto106:account-updated', refreshAccessPanel);
  refreshAccessPanel();
  loadNicknameRequirementComponent();
});