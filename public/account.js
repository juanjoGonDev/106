const accountConfig = window.__MINUTO106_CONFIG__ ?? {};
const accountApiUrl = String(accountConfig.apiBaseUrl ?? '').replace(/\/$/u, '');
const accountDeviceKey = 'minuto106:device-id';
const accountDeviceId = localStorage.getItem(accountDeviceKey) || crypto.randomUUID();
localStorage.setItem(accountDeviceKey, accountDeviceId);
let keyIsVisible = false;
let nicknameAvailability = 'unknown';

const nicknameLookup = window.Minuto106NicknameAvailability?.createDebouncedLookup({
  checkFn: (input) => window.Minuto106NicknameAvailability.check({
    ...input,
    apiBaseUrl: accountApiUrl,
  }),
});

async function accountRequest(action, payload = {}) {
  const response = await fetch(accountApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': accountDeviceId },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'No se pudo cargar la cuenta.');
    error.code = String(body.code || 'account_error');
    throw error;
  }
  return body;
}

function showAccountError(error, title = 'No se pudo completar') {
  return window.Minuto106UI?.error({
    title,
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
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
    status.textContent = 'Crea una clave nueva o inicia sesión para generar una cuenta recuperable.';
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
  profileLink.href = window.Minuto106PlayerUI?.playerShellUrl(player.nick) || `./player.html?nick=${encodeURIComponent(player.nick)}`;
  profileLink.textContent = 'Perfil';
  actions.append(useButton, profileLink);
  item.append(information, actions);
  return item;
}

async function linkLegacyNicks() {
  const access = window.Minuto106Access;
  if (!access?.getAccountToken(false)) return;
  for (const nick of access.getLegacyLocalNicks()) {
    try {
      await accountRequest('link-account-player', { nick });
      access.forgetLegacyPlayerKey(nick);
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
    status.textContent = 'Crea una cuenta local, inicia sesión o vincula un proveedor para añadir nicks.';
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
    : 'La cuenta todavía no tiene nicks. Puedes crear el primero desde esta página.';
  if (!players.length) {
    const empty = document.createElement('li');
    empty.className = 'account-empty';
    empty.textContent = 'Escribe un nick arriba para añadirlo a la cuenta.';
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

function setNicknameStatus(message, tone = 'neutral') {
  const status = document.querySelector('#accountNickStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function refreshNicknameButton() {
  const button = document.querySelector('#createAccountNick');
  if (button) button.disabled = nicknameAvailability !== 'available';
}

function scheduleNicknameCheck() {
  const input = document.querySelector('#accountNickInput');
  const validation = window.Minuto106NicknamePolicy?.validateNickname(input?.value);
  nicknameAvailability = 'unknown';
  refreshNicknameButton();
  if (!validation?.valid) {
    nicknameLookup?.cancel();
    setNicknameStatus(window.Minuto106NicknamePolicy?.nicknameErrorMessage(validation?.reason) || 'El nick no es válido.', 'error');
    input?.setAttribute('aria-invalid', 'true');
    return;
  }

  setNicknameStatus('Comprobando disponibilidad y contenido…');
  input.setAttribute('aria-invalid', 'false');
  nicknameLookup?.schedule({ nick: validation.normalized }, {
    onResult(result) {
      nicknameAvailability = result.availability;
      if (result.availability === 'available') {
        setNicknameStatus('Nick disponible. Puedes añadirlo a tu cuenta.', 'success');
      } else if (result.availability === 'owned') {
        setNicknameStatus('Este nick ya pertenece a tu cuenta.', 'warning');
      } else if (result.availability === 'occupied') {
        setNicknameStatus('Este nick pertenece a otra cuenta.', 'error');
      } else if (result.availability.startsWith('invalid-')) {
        const reason = result.availability.slice('invalid-'.length);
        setNicknameStatus(window.Minuto106NicknamePolicy.nicknameErrorMessage(reason), 'error');
      } else {
        setNicknameStatus('No se pudo confirmar la disponibilidad.', 'error');
      }
      refreshNicknameButton();
    },
    onError(error) {
      nicknameAvailability = 'unknown';
      setNicknameStatus(error.message || 'No se pudo comprobar el nick.', 'error');
      refreshNicknameButton();
    },
  });
}

async function createNickname() {
  const input = document.querySelector('#accountNickInput');
  const validation = window.Minuto106NicknamePolicy.validateNickname(input.value);
  if (!validation.valid || nicknameAvailability !== 'available') {
    scheduleNicknameCheck();
    return;
  }
  const button = document.querySelector('#createAccountNick');
  button.disabled = true;
  setNicknameStatus('Creando nick…');
  try {
    window.Minuto106Access.getAccountToken(true);
    await accountRequest('link-account-player', { nick: validation.normalized });
    window.Minuto106Access.rememberAccountNick(validation.normalized);
    localStorage.setItem('minuto106:nick', validation.normalized);
    input.value = '';
    nicknameAvailability = 'unknown';
    setNicknameStatus('Nick creado y vinculado a tu cuenta.', 'success');
    refreshAccountKey();
    await loadPlayers();
  } catch (error) {
    setNicknameStatus(error.message || 'No se pudo crear el nick.', 'error');
  } finally {
    refreshNicknameButton();
  }
}

document.querySelector('#createAccountKey')?.addEventListener('click', async () => {
  window.Minuto106Access.getAccountToken(true);
  refreshAccountKey();
  await loadPlayers();
  await window.Minuto106UI?.success({
    title: 'Cuenta creada',
    message: 'Guarda la clave en un gestor de contraseñas. La necesitarás para recuperar todos tus nicks en otro dispositivo.',
  });
});
document.querySelector('#copyAccountKey')?.addEventListener('click', () => copyKey().catch((error) => showAccountError(error, 'No se pudo copiar la clave')));
document.querySelector('#showAccountKey')?.addEventListener('click', () => {
  keyIsVisible = !keyIsVisible;
  refreshAccountKey();
});
document.querySelector('#logoutAccount')?.addEventListener('click', async () => {
  const accepted = await window.Minuto106UI?.ask({
    title: 'Cerrar cuenta en este dispositivo',
    message: 'Se eliminará la clave privada de este navegador. Tus nicks seguirán guardados, pero necesitarás la clave o una cuenta en la nube para recuperarlos.',
    acceptLabel: 'Cerrar cuenta',
    cancelLabel: 'Cancelar',
  });
  if (!accepted) return;
  window.Minuto106Access.clearAccountToken();
  keyIsVisible = false;
  refreshAccountKey();
  await loadPlayers().catch(() => {});
});
document.querySelector('#importAccountButton')?.addEventListener('click', async () => {
  const input = document.querySelector('#importAccountKey');
  try {
    window.Minuto106Access.setAccountToken(input.value);
    input.value = '';
    keyIsVisible = false;
    refreshAccountKey();
    await loadPlayers();
    await window.Minuto106UI?.success({
      title: 'Cuenta recuperada',
      message: 'Los nicks vinculados ya están disponibles en este dispositivo.',
    });
  } catch (error) {
    await showAccountError(error, 'Clave no válida');
  }
});
document.querySelector('#accountNickInput')?.addEventListener('input', scheduleNicknameCheck);
document.querySelector('#createAccountNick')?.addEventListener('click', () => createNickname().catch((error) => showAccountError(error, 'No se pudo crear el nick')));
document.addEventListener('minuto106:account-updated', refreshAccountKey);
document.addEventListener('minuto106:cloud-account-synced', () => {
  refreshAccountKey();
  loadPlayers().catch((error) => showAccountError(error, 'No se pudo sincronizar la cuenta'));
});
refreshAccountKey();
refreshNicknameButton();
loadPlayers().catch((error) => {
  document.querySelector('#accountPlayersStatus').textContent = error.message;
  showAccountError(error, 'No se pudo sincronizar la cuenta');
});
