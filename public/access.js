const LEGACY_ACCESS_STORAGE_KEY = 'minuto106:player-access-v1';
const ACCOUNT_STORAGE_KEY = 'minuto106:account-access-v1';
const ACCOUNT_NICKS_STORAGE_KEY = 'minuto106:account-nicks-v1';
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
const accountActions = new Set([...protectedActions, 'account-players']);

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

function readLegacyAccessMap() {
  const value = readJsonStorage(LEGACY_ACCESS_STORAGE_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function generatePrivateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getAccountToken(create = false) {
  let token = String(localStorage.getItem(ACCOUNT_STORAGE_KEY) || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) token = '';
  if (!token && create) {
    token = generatePrivateKey();
    localStorage.setItem(ACCOUNT_STORAGE_KEY, token);
    document.dispatchEvent(new CustomEvent('minuto106:account-updated'));
  }
  return token;
}

function setAccountToken(token) {
  const normalizedToken = String(token ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedToken)) {
    throw new Error('La clave de cuenta debe contener 64 caracteres hexadecimales.');
  }
  localStorage.setItem(ACCOUNT_STORAGE_KEY, normalizedToken);
  document.dispatchEvent(new CustomEvent('minuto106:account-updated'));
  return normalizedToken;
}

function clearAccountToken() {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  document.dispatchEvent(new CustomEvent('minuto106:account-updated'));
}

function getLegacyPlayerKey(nick) {
  const key = normalizeAccessNick(nick);
  if (!key) return '';
  return String(readLegacyAccessMap()[key] || '').trim().toLowerCase();
}

function getLegacyLocalNicks() {
  return Object.keys(readLegacyAccessMap());
}

function rememberAccountNick(nick) {
  const normalized = String(nick ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const key = normalizeAccessNick(normalized);
  if (!key) return;
  const entries = readJsonStorage(ACCOUNT_NICKS_STORAGE_KEY, {});
  const map = entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {};
  map[key] = normalized;
  localStorage.setItem(ACCOUNT_NICKS_STORAGE_KEY, JSON.stringify(map));
}

function getRememberedNicks() {
  const entries = readJsonStorage(ACCOUNT_NICKS_STORAGE_KEY, {});
  return entries && typeof entries === 'object' && !Array.isArray(entries) ? Object.values(entries) : [];
}

window.Minuto106Access = {
  clearAccountToken,
  generatePrivateKey,
  getAccountToken,
  getLegacyLocalNicks,
  getLegacyPlayerKey,
  getRememberedNicks,
  normalizeAccessNick,
  rememberAccountNick,
  setAccountToken,
};

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

    const nick = String(
      body.nick
      || document.querySelector('#nick')?.value
      || document.querySelector('#leagueNick')?.value
      || localStorage.getItem('minuto106:nick')
      || '',
    ).trim();
    const legacyToken = getLegacyPlayerKey(nick);
    if (legacyToken) headers.set('x-player-token', legacyToken);
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
    || localStorage.getItem('minuto106:nick')
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
});
