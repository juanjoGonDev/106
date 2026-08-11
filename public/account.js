const accountConfig = window.__MINUTO106_CONFIG__ ?? {};
const accountApiUrl = String(accountConfig.apiBaseUrl ?? '').replace(/\/$/u, '');
const accountDeviceKey = 'minuto106:device-id';
const accountDeviceId = localStorage.getItem(accountDeviceKey) || crypto.randomUUID();
localStorage.setItem(accountDeviceKey, accountDeviceId);
let keyIsVisible = false;
let createNicknameController = null;
let activeRenameForm = null;
let activeRenameController = null;
let cooldownTimer = null;

function playerNameApiUrl() {
  try {
    const base = new URL(String(accountConfig.supabaseUrl || ''));
    const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (base.protocol !== 'https:' && !local) return '';
    return `${base.origin}/functions/v1/player-name-management`;
  } catch { return ''; }
}

async function accountRequest(action, payload = {}) {
  const response = await fetch(accountApiUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': accountDeviceId }, body: JSON.stringify({ action, ...payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || 'No se pudo cargar la cuenta.'); error.code = String(body.code || 'account_error'); throw error; }
  return body;
}

async function playerNameRequest(action, payload = {}) {
  const endpoint = playerNameApiUrl(); const token = window.Minuto106Access?.getAccountToken?.(false) || '';
  if (!endpoint || !token) throw new Error('Necesitas una cuenta activa.');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-account-token': token }, body: JSON.stringify({ action, ...payload }),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error || 'No se pudo cambiar el nick.'); error.code = result.code; error.nextRenameAt = result.nextRenameAt; error.retryAfterSeconds = result.retryAfterSeconds; throw error; }
  return result;
}

function showAccountError(error, title = 'No se pudo completar') {
  return window.Minuto106UI?.error({ title, message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.') }) ?? Promise.resolve();
}
function formatDifference(value) { return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : 'Sin marca'; }
function formatDate(value) { const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000)); const days = Math.floor(total / 86400); const hours = Math.floor((total % 86400) / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
  return days > 0 ? `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function refreshAccountKey() {
  const access = window.Minuto106Access; const token = access?.getAccountToken(false) || ''; const preview = document.querySelector('#accountKeyPreview'); const status = document.querySelector('#accountKeyStatus'); const createButton = document.querySelector('#createAccountKey'); const copyButton = document.querySelector('#copyAccountKey'); const showButton = document.querySelector('#showAccountKey'); const logoutButton = document.querySelector('#logoutAccount');
  if (!token) { preview.textContent = 'No hay una cuenta activa en este dispositivo.'; status.textContent = 'Crea una clave nueva o inicia sesión para generar una cuenta recuperable.'; createButton.hidden = false; copyButton.hidden = true; showButton.hidden = true; logoutButton.hidden = true; return; }
  preview.textContent = keyIsVisible ? token : `${token.slice(0, 8)}••••••••••••••••••••••••••••••••${token.slice(-8)}`; status.textContent = 'Cuenta activa en este dispositivo.'; createButton.hidden = true; copyButton.hidden = false; showButton.hidden = false; showButton.textContent = keyIsVisible ? 'Ocultar' : 'Mostrar'; logoutButton.hidden = false;
}

function closeRenameForm({ restoreFocus = true } = {}) {
  activeRenameController?.destroy?.(); activeRenameController = null;
  if (!(activeRenameForm instanceof HTMLElement)) return;
  const trigger = activeRenameForm.__returnFocus; activeRenameForm.remove(); activeRenameForm = null; if (restoreFocus && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
}

function cooldownProjection(state) {
  const next = Date.parse(String(state?.cooldown?.nextRenameAt || ''));
  const canRename = state?.cooldown?.canRename !== false && (!Number.isFinite(next) || next <= Date.now());
  return { canRename, nextRenameAt: Number.isFinite(next) ? next : null };
}

function updateCooldowns() {
  let pending = false;
  for (const element of document.querySelectorAll('[data-nickname-cooldown]')) {
    const next = Number(element.dataset.nextRenameAt || 0); const buttonId = element.dataset.renameButton; const button = buttonId ? document.getElementById(buttonId) : null;
    if (!next || next <= Date.now()) { element.textContent = 'Puedes volver a cambiar este nick ahora.'; element.dataset.state = 'ready'; if (button && button.dataset.renameRequired !== 'true') button.disabled = false; }
    else { pending = true; element.textContent = `Disponible ${formatDate(next)} · ${formatCountdown(next - Date.now())}`; element.dataset.state = 'cooldown'; if (button) button.disabled = true; }
  }
  if (!pending && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
}
function ensureCooldownTimer() { updateCooldowns(); if (!cooldownTimer && document.querySelector('[data-nickname-cooldown][data-state="cooldown"]')) cooldownTimer = setInterval(updateCooldowns, 1000); }

function openRenameForm(player, nameState, item, trigger) {
  closeRenameForm({ restoreFocus: false });
  const form = document.createElement('form'); form.className = 'account-player-rename-form'; form.noValidate = true; form.__returnFocus = trigger;
  const heading = document.createElement('strong'); heading.textContent = `Cambiar “${player.nick}”`;
  const label = document.createElement('label'); label.textContent = 'Nuevo nick'; const input = document.createElement('input'); input.type = 'text'; input.minLength = 3; input.maxLength = 24; input.autocomplete = 'nickname'; input.spellcheck = false; input.required = true; label.append(input);
  const status = document.createElement('p'); status.className = 'account-nick-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'account-player-actions'; const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ghost compact'; cancel.textContent = 'Cancelar'; const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary compact'; submit.textContent = 'Guardar nick'; submit.disabled = true; actions.append(cancel, submit); form.append(heading, label, status, actions);
  cancel.addEventListener('click', () => closeRenameForm()); form.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); closeRenameForm(); } });
  const controllerOwner = window.Minuto106NicknameFieldController;
  if (controllerOwner) activeRenameController = controllerOwner.create({ input, status, submitButton: submit, checkFn: ({ nick }) => playerNameRequest('check', { playerId: nameState.playerId, nick }), readyMessage: 'Nick válido y disponible. Puedes guardar el cambio.' });
  else status.textContent = 'No se pudo cargar la validación de nicks. Recarga la página.';
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!activeRenameController?.isReady?.()) { activeRenameController?.refresh?.(); input.focus(); return; }
    submit.disabled = true; cancel.disabled = true; status.textContent = 'Guardando cambio…'; delete status.dataset.tone;
    try {
      const oldNick = player.nick; const result = await playerNameRequest('rename', { playerId: nameState.playerId, nick: activeRenameController.normalizedValue() }); const newNick = String(result.newNick || activeRenameController.normalizedValue());
      window.Minuto106Access?.replaceRememberedNick?.(oldNick, newNick); closeRenameForm({ restoreFocus: false }); await loadPlayers(); document.dispatchEvent(new CustomEvent('minuto106:account-updated', { detail: { reason: 'nickname-renamed', nick: newNick } }));
    } catch (error) {
      status.textContent = error.message || 'No se pudo cambiar el nick.'; status.dataset.tone = error.code === 'nickname_cooldown' ? 'warning' : 'error'; submit.disabled = !activeRenameController?.isReady?.(); cancel.disabled = false;
      if (error.code === 'nickname_cooldown') await loadPlayers().catch(() => {}); else input.focus();
    }
  });
  activeRenameForm = form; item.append(form); requestAnimationFrame(() => input.focus());
}

function createPlayerItem(player, nameState) {
  const item = document.createElement('li'); item.className = 'account-player'; const information = document.createElement('div'); const name = document.createElement('strong'); name.textContent = player.nick; const details = document.createElement('small'); const team = player.team === 'spain' ? 'España' : player.team === 'argentina' ? 'Argentina' : 'Sin selección'; details.textContent = `${team} · ${formatDifference(player.bestDifferenceMs)} · ${player.attemptsLeft ?? 0} intentos disponibles`; information.append(name, details);
  if (nameState?.renameRequired) { const warning = document.createElement('small'); warning.className = 'account-player-rename-warning'; warning.textContent = `Cambio obligatorio pendiente${nameState.originalNick ? ` · anterior: ${nameState.originalNick}` : ''}`; information.append(warning); }
  const cooldown = cooldownProjection(nameState || {}); if (nameState?.playerId) { const cooldownText = document.createElement('small'); cooldownText.dataset.nicknameCooldown = 'true'; cooldownText.dataset.nextRenameAt = String(cooldown.nextRenameAt || 0); cooldownText.dataset.renameButton = `rename-${nameState.playerId}`; information.append(cooldownText); }
  const actions = document.createElement('div'); actions.className = 'account-player-actions'; const useButton = document.createElement('button'); useButton.type = 'button'; useButton.className = 'secondary compact'; useButton.textContent = 'Usar'; useButton.addEventListener('click', () => { localStorage.setItem('minuto106:nick', player.nick); location.href = './'; }); const profileLink = document.createElement('a'); profileLink.className = 'ghost compact'; profileLink.href = window.Minuto106PlayerUI?.playerShellUrl(player.nick) || `./player.html?nick=${encodeURIComponent(player.nick)}`; profileLink.textContent = 'Perfil'; actions.append(useButton, profileLink);
  if (nameState?.playerId) { const rename = document.createElement('button'); rename.id = `rename-${nameState.playerId}`; rename.type = 'button'; rename.className = 'ghost compact'; rename.textContent = 'Cambiar nick'; rename.dataset.renameRequired = String(nameState.renameRequired === true); rename.disabled = !cooldown.canRename || nameState.renameRequired === true; rename.title = nameState.renameRequired ? 'Completa primero el cambio obligatorio indicado por moderación.' : ''; rename.addEventListener('click', () => openRenameForm(player, nameState, item, rename)); actions.append(rename); }
  item.append(information, actions); return item;
}

async function linkLegacyNicks() {
  const access = window.Minuto106Access; if (!access?.getAccountToken(false)) return;
  for (const nick of access.getLegacyLocalNicks()) { try { await accountRequest('link-account-player', { nick }); access.forgetLegacyPlayerKey(nick); } catch {} }
}

async function loadPlayers() {
  closeRenameForm({ restoreFocus: false }); const list = document.querySelector('#accountPlayers'); const status = document.querySelector('#accountPlayersStatus'); list.replaceChildren(); const access = window.Minuto106Access;
  if (!access?.getAccountToken(false)) { status.textContent = 'Crea una cuenta local, inicia sesión o vincula un proveedor para añadir nicks.'; const empty = document.createElement('li'); empty.className = 'account-empty'; empty.textContent = 'Todavía no hay una cuenta activa.'; list.append(empty); return; }
  status.textContent = 'Sincronizando nicks vinculados…'; await linkLegacyNicks(); const [account, nameResult] = await Promise.all([accountRequest('account-players'), playerNameRequest('list')]); const players = Array.isArray(account.players) ? account.players : []; const nameStates = Array.isArray(nameResult.players) ? nameResult.players : []; const statesByKey = new Map(nameStates.map((state) => [window.Minuto106Access.normalizeAccessNick(state.nick), state]));
  status.textContent = players.length ? `${players.length} ${players.length === 1 ? 'nick vinculado' : 'nicks vinculados'}. Cada nick puede cambiarse una vez cada 7 días de forma independiente.` : 'La cuenta todavía no tiene nicks. Puedes crear el primero desde esta página.';
  if (!players.length) { const empty = document.createElement('li'); empty.className = 'account-empty'; empty.textContent = 'Escribe un nick arriba para añadirlo a la cuenta.'; list.append(empty); return; }
  for (const player of players) list.append(createPlayerItem(player, statesByKey.get(window.Minuto106Access.normalizeAccessNick(player.nick)))); ensureCooldownTimer();
}

async function copyKey() { const token = window.Minuto106Access.getAccountToken(true); await navigator.clipboard.writeText(token); const button = document.querySelector('#copyAccountKey'); const original = button.textContent; button.textContent = 'Copiada'; setTimeout(() => { button.textContent = original; }, 1500); refreshAccountKey(); }

function setupCreateNicknameController() {
  createNicknameController?.destroy?.(); const input = document.querySelector('#accountNickInput'); const status = document.querySelector('#accountNickStatus'); const button = document.querySelector('#createAccountNick'); const owner = window.Minuto106NicknameFieldController;
  if (!owner || !(input instanceof HTMLInputElement)) { button.disabled = true; status.textContent = 'No se pudo cargar la validación de nicks.'; return; }
  createNicknameController = owner.create({ input, status, submitButton: button, checkFn: ({ nick }) => window.Minuto106NicknameAvailability.check({ nick, apiBaseUrl: accountApiUrl }), readyMessage: 'Nick disponible. Puedes añadirlo a tu cuenta.' });
}
async function createNickname() {
  const input = document.querySelector('#accountNickInput'); if (!createNicknameController?.isReady?.()) { createNicknameController?.refresh?.(); input.focus(); return; }
  const button = document.querySelector('#createAccountNick'); button.disabled = true; const status = document.querySelector('#accountNickStatus'); status.textContent = 'Creando nick…';
  try { window.Minuto106Access.getAccountToken(true); const nick = createNicknameController.normalizedValue(); await accountRequest('link-account-player', { nick }); window.Minuto106Access.rememberAccountNick(nick); localStorage.setItem('minuto106:nick', nick); input.value = ''; createNicknameController.refresh(); status.textContent = 'Nick creado y vinculado a tu cuenta.'; status.dataset.tone = 'success'; refreshAccountKey(); await loadPlayers(); }
  catch (error) { status.textContent = error.message || 'No se pudo crear el nick.'; status.dataset.tone = 'error'; }
  finally { button.disabled = !createNicknameController?.isReady?.(); }
}

document.querySelector('#createAccountKey')?.addEventListener('click', async () => { window.Minuto106Access.getAccountToken(true); refreshAccountKey(); await loadPlayers(); await window.Minuto106UI?.success({ title: 'Cuenta creada', message: 'Guarda la clave en un gestor de contraseñas. La necesitarás para recuperar todos tus nicks en otro dispositivo.' }); });
document.querySelector('#copyAccountKey')?.addEventListener('click', () => copyKey().catch((error) => showAccountError(error, 'No se pudo copiar la clave')));
document.querySelector('#showAccountKey')?.addEventListener('click', () => { keyIsVisible = !keyIsVisible; refreshAccountKey(); });
document.querySelector('#logoutAccount')?.addEventListener('click', async () => { const accepted = await window.Minuto106UI?.ask({ title: 'Cerrar cuenta en este dispositivo', message: 'Se eliminará la clave privada de este navegador. Tus nicks seguirán guardados, pero necesitarás la clave o una cuenta en la nube para recuperarlos.', acceptLabel: 'Cerrar cuenta', cancelLabel: 'Cancelar' }); if (!accepted) return; window.Minuto106Access.clearAccountToken(); keyIsVisible = false; refreshAccountKey(); await loadPlayers().catch(() => {}); });
document.querySelector('#importAccountButton')?.addEventListener('click', async () => { const input = document.querySelector('#importAccountKey'); try { window.Minuto106Access.setAccountToken(input.value); input.value = ''; keyIsVisible = false; refreshAccountKey(); await loadPlayers(); await window.Minuto106UI?.success({ title: 'Cuenta recuperada', message: 'Los nicks vinculados ya están disponibles en este dispositivo.' }); } catch (error) { await showAccountError(error, 'Clave no válida'); } });
document.querySelector('#createAccountNick')?.addEventListener('click', () => createNickname().catch((error) => showAccountError(error, 'No se pudo crear el nick')));
document.addEventListener('minuto106:account-updated', refreshAccountKey);
document.addEventListener('minuto106:cloud-account-synced', () => { refreshAccountKey(); loadPlayers().catch((error) => showAccountError(error, 'No se pudo sincronizar la cuenta')); });

refreshAccountKey(); setupCreateNicknameController(); loadPlayers().catch((error) => { document.querySelector('#accountPlayersStatus').textContent = error.message; showAccountError(error, 'No se pudo sincronizar la cuenta'); });
