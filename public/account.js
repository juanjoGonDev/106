const accountConfig = window.__MINUTO106_CONFIG__ ?? {};
const accountApiUrl = String(accountConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const accountDeviceKey = 'minuto106:device-id';
const accountDeviceId = localStorage.getItem(accountDeviceKey) || crypto.randomUUID();
localStorage.setItem(accountDeviceKey, accountDeviceId);
let keyIsVisible = false;

async function accountRequest(action, payload = {}) {
  const response = await fetch(accountApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': accountDeviceId },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la cuenta.');
  return body;
}

function formatDifference(value) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : 'Sin marca';
}

function refreshAccountKey() {
  const access = window.Minuto106Access;
  const token = access?.getAccountToken(false) || '';
  const preview = document.querySelector('#accountKeyPreview');
  const status = document.querySelector('#accountKeyStatus');
  const createButton = document.querySelector('#createAccountKey');
  const copyButton = document.querySelector('#copyAccountKey');
  const showButton = document.querySelector('#showAccountKey');
  const logoutButton = document.querySelector('#logoutAccount');

  if (!token) {
    preview.textContent = 'No hay una cuenta activa en este dispositivo.';
    status.textContent = 'Crea una clave nueva o importa la que utilizas en otro dispositivo.';
    createButton.hidden = false;
    copyButton.hidden = true;
    showButton.hidden = true;
    logoutButton.hidden = true;
    return;
  }

  preview.textContent = keyIsVisible ? token : `${token.slice(0, 8)}••••••••••••••••••••••••••••••••${token.slice(-8)}`;
  status.textContent = 'Cuenta activa en este dispositivo.';
  createButton.hidden = true;
  copyButton.hidden = false;
  showButton.hidden = false;
  showButton.textContent = keyIsVisible ? 'Ocultar' : 'Mostrar';
  logoutButton.hidden = false;
}

function createPlayerItem(player) {
  const item = document.createElement('li');
  item.className = 'account-player';
  const information = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = player.nick;
  const details = document.createElement('small');
  const team = player.team === 'spain' ? 'España' : player.team === 'argentina' ? 'Argentina' : 'Sin selección';
  details.textContent = `${team} · ${formatDifference(player.bestDifferenceMs)} · ${player.attemptsLeft ?? 0} intentos disponibles`;
  information.append(name, details);

  const actions = document.createElement('div');
  actions.className = 'account-player-actions';
  const useButton = document.createElement('button');
  useButton.type = 'button';
  useButton.className = 'secondary compact';
  useButton.textContent = 'Usar';
  useButton.addEventListener('click', () => {
    localStorage.setItem('minuto106:nick', player.nick);
    location.href = './';
  });
  const profileLink = document.createElement('a');
  profileLink.className = 'ghost compact';
  profileLink.href = `./ranking.html?nick=${encodeURIComponent(player.nick)}`;
  profileLink.textContent = 'Perfil';
  actions.append(useButton, profileLink);
  item.append(information, actions);
  return item;
}

async function linkLegacyNicks() {
  const access = window.Minuto106Access;
  if (!access?.getAccountToken(false)) return;
  const legacyNicks = access.getLegacyLocalNicks();
  for (const nick of legacyNicks) {
    try {
      await accountRequest('link-account-player', { nick });
    } catch {
      // A legacy nick can belong to a different imported account. It remains untouched.
    }
  }
}

async function loadPlayers() {
  const list = document.querySelector('#accountPlayers');
  const status = document.querySelector('#accountPlayersStatus');
  list.replaceChildren();
  const access = window.Minuto106Access;
  if (!access?.getAccountToken(false)) {
    status.textContent = 'Inicia una cuenta para ver y recuperar tus nicks.';
    const empty = document.createElement('li');
    empty.className = 'account-empty';
    empty.textContent = 'Todavía no hay una cuenta activa.';
    list.append(empty);
    return;
  }

  status.textContent = 'Sincronizando nicks vinculados…';
  await linkLegacyNicks();
  const account = await accountRequest('account-players');
  const players = Array.isArray(account.players) ? account.players : [];
  status.textContent = players.length
    ? `${players.length} ${players.length === 1 ? 'nick vinculado' : 'nicks vinculados'}.`
    : 'La cuenta todavía no tiene nicks vinculados. Juega con uno para añadirlo.';
  if (!players.length) {
    const empty = document.createElement('li');
    empty.className = 'account-empty';
    empty.textContent = 'Juega con un nick o importa una cuenta que ya tenga jugadores.';
    list.append(empty);
    return;
  }
  for (const player of players) list.append(createPlayerItem(player));
}

async function copyKey() {
  const token = window.Minuto106Access.getAccountToken(true);
  await navigator.clipboard.writeText(token);
  const button = document.querySelector('#copyAccountKey');
  const original = button.textContent;
  button.textContent = 'Copiada';
  setTimeout(() => { button.textContent = original; }, 1500);
  refreshAccountKey();
}

document.querySelector('#createAccountKey')?.addEventListener('click', async () => {
  window.Minuto106Access.getAccountToken(true);
  refreshAccountKey();
  await loadPlayers();
});
document.querySelector('#copyAccountKey')?.addEventListener('click', () => copyKey().catch((error) => alert(error.message)));
document.querySelector('#showAccountKey')?.addEventListener('click', () => {
  keyIsVisible = !keyIsVisible;
  refreshAccountKey();
});
document.querySelector('#logoutAccount')?.addEventListener('click', () => {
  window.Minuto106Access.clearAccountToken();
  keyIsVisible = false;
  refreshAccountKey();
  loadPlayers().catch(() => {});
});
document.querySelector('#importAccountButton')?.addEventListener('click', async () => {
  const input = document.querySelector('#importAccountKey');
  try {
    window.Minuto106Access.setAccountToken(input.value);
    input.value = '';
    keyIsVisible = false;
    refreshAccountKey();
    await loadPlayers();
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Clave inválida.');
  }
});
document.addEventListener('minuto106:account-updated', refreshAccountKey);
refreshAccountKey();
loadPlayers().catch((error) => {
  document.querySelector('#accountPlayersStatus').textContent = error.message;
});