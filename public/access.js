const ACCESS_STORAGE_KEY = 'minuto106:player-access-v1';
const protectedActions = new Set(['start', 'create-duel', 'resolve-duel', 'create-league', 'join-league']);

function normalizeAccessNick(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function readAccessMap() {
  try {
    const value = JSON.parse(localStorage.getItem(ACCESS_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeAccessMap(value) {
  localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(value));
}

function generatePlayerKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getPlayerKey(nick, create = false) {
  const key = normalizeAccessNick(nick);
  if (!key) return '';
  const map = readAccessMap();
  if (!map[key] && create) {
    map[key] = generatePlayerKey();
    writeAccessMap(map);
  }
  return String(map[key] || '');
}

function setPlayerKey(nick, token) {
  const key = normalizeAccessNick(nick);
  const normalizedToken = String(token ?? '').trim().toLowerCase();
  if (!key || !/^[a-f0-9]{64}$/.test(normalizedToken)) throw new Error('La clave debe contener 64 caracteres hexadecimales.');
  const map = readAccessMap();
  map[key] = normalizedToken;
  writeAccessMap(map);
  document.dispatchEvent(new CustomEvent('minuto106:access-updated', { detail: { nick } }));
  return normalizedToken;
}

window.Minuto106Access = { getPlayerKey, setPlayerKey, generatePlayerKey, normalizeAccessNick };

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  let body;
  try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
  if (body && protectedActions.has(String(body.action || ''))) {
    const nick = String(body.nick || document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
    if (nick) {
      const token = getPlayerKey(nick, true);
      const headers = new Headers(init.headers || {});
      headers.set('x-player-token', token);
      init = { ...init, headers };
    }
  }
  const response = await originalFetch(input, init);
  if (!response.ok) {
    response.clone().json().then((payload) => {
      const message = String(payload?.error || '');
      if (message.includes('clave de jugador') || message.includes('clave') || message.includes('dispositivo donde se creó')) {
        document.dispatchEvent(new CustomEvent('minuto106:access-denied', { detail: { message } }));
      }
    }).catch(() => {});
  }
  return response;
};

function currentNick() {
  return String(document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
}

function refreshAccessPanel() {
  const panel = document.querySelector('#playerAccessPanel');
  const status = document.querySelector('#playerAccessStatus');
  if (!panel || !status) return;
  const nick = currentNick();
  panel.hidden = nick.length < 2;
  status.textContent = nick.length < 2
    ? ''
    : getPlayerKey(nick) ? 'Este dispositivo tiene la clave privada de este nick.' : 'Este dispositivo todavía no tiene una clave para este nick.';
}

document.addEventListener('DOMContentLoaded', () => {
  const nickInput = document.querySelector('#nick');
  nickInput?.addEventListener('input', refreshAccessPanel);
  document.querySelector('#copyPlayerKeyButton')?.addEventListener('click', async () => {
    const nick = currentNick();
    if (nick.length < 2) return;
    const token = getPlayerKey(nick, true);
    await navigator.clipboard.writeText(token);
    const button = document.querySelector('#copyPlayerKeyButton');
    button.textContent = 'Clave copiada';
    setTimeout(() => { button.textContent = 'Copiar clave'; }, 1600);
    refreshAccessPanel();
  });
  document.querySelector('#importPlayerKeyButton')?.addEventListener('click', () => {
    const nick = currentNick();
    const field = document.querySelector('#playerKeyInput');
    try {
      setPlayerKey(nick, field?.value || '');
      field.value = '';
      refreshAccessPanel();
      alert('Clave guardada en este dispositivo.');
    } catch (error) {
      alert(error.message);
    }
  });
  document.addEventListener('minuto106:access-denied', (event) => {
    const panel = document.querySelector('#playerAccessPanel');
    if (panel) panel.hidden = false;
    const status = document.querySelector('#playerAccessStatus');
    if (status) status.textContent = event.detail?.message || 'Introduce la clave privada correcta de este nick.';
  });
  refreshAccessPanel();
});