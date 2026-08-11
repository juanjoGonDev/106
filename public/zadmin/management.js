const config = window.__MINUTO106_CONFIG__ || {};
const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1';
const SESSION_STORAGE_KEY = 'minuto106.zadmin.session.v1';
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,80}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

let sessionToken = readSessionToken();
let activeInlineForm = null;
let activeInlineReturnFocus = null;
let activeView = 'restrictions';

function $(selector) {
  return document.querySelector(selector);
}

function all(selector) {
  return [...document.querySelectorAll(selector)];
}

function text(value) {
  return String(value ?? '');
}

function createElement(tag, { className = '', textContent = '', attributes = {} } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent !== '') element.textContent = textContent;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  return element;
}

function setStatus(element, message = '', tone = '') {
  if (!element) return;
  element.textContent = message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function readSessionToken() {
  try {
    const token = text(sessionStorage.getItem(SESSION_STORAGE_KEY)).trim().toLowerCase();
    if (SESSION_TOKEN_PATTERN.test(token)) return token;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Hardened browsers can reject sessionStorage. Access will fail closed.
  }
  return '';
}

function randomDeviceId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `za-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY) || '';
    if (DEVICE_ID_PATTERN.test(existing)) return existing;
    const generated = randomDeviceId();
    localStorage.setItem(DEVICE_STORAGE_KEY, generated);
    return generated;
  } catch {
    if (!window.__zadminManagementDeviceId) window.__zadminManagementDeviceId = randomDeviceId();
    return window.__zadminManagementDeviceId;
  }
}

function apiUrl() {
  try {
    const base = new URL(text(config.supabaseUrl));
    const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (base.protocol !== 'https:' && !local) return '';
    return `${base.origin}/functions/v1/zadmin-management`;
  } catch {
    return '';
  }
}

async function managementRequest(action, payload = {}) {
  const endpoint = apiUrl();
  if (!endpoint || !sessionToken) throw new Error('La sesión de administración no está disponible.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId(),
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && result.code === 'invalid_session') {
      try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* noop */ }
      sessionToken = '';
      showDenied();
    }
    const error = new Error(text(result.error) || `La operación falló (${response.status}).`);
    error.code = result.code;
    throw error;
  }
  return result;
}

function formatDate(value) {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

function shortValue(value, leading = 10, trailing = 8) {
  const source = text(value);
  if (!source) return '—';
  if (source.length <= leading + trailing + 1) return source;
  return `${source.slice(0, leading)}…${source.slice(-trailing)}`;
}

function scopeLabel(scope) {
  if (scope === 'account') return 'Cuenta';
  if (scope === 'device') return 'Dispositivo';
  if (scope === 'ip') return 'IP (huella)';
  return text(scope) || '—';
}

function statusLabel(status) {
  if (status === 'active') return 'Activa';
  if (status === 'lifted') return 'Levantada por admin';
  return 'Expirada';
}

function statusTone(status) {
  if (status === 'active') return 'danger';
  if (status === 'lifted') return 'success';
  return 'warning';
}

function badge(label, tone = '') {
  return createElement('span', {
    className: 'zadmin-management-badge',
    textContent: label,
    attributes: tone ? { 'data-tone': tone } : {},
  });
}

function detailCell(label, value, { code = false } = {}) {
  const container = createElement('div');
  container.append(createElement('span', { textContent: label }));
  container.append(createElement(code ? 'code' : 'strong', { textContent: text(value) || '—' }));
  return container;
}

function closeInlineForm({ restoreFocus = true } = {}) {
  if (!(activeInlineForm instanceof HTMLElement)) return;
  const returnFocus = activeInlineReturnFocus;
  activeInlineForm.remove();
  activeInlineForm = null;
  activeInlineReturnFocus = null;
  if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
}

function installEscapeCancellation(form) {
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeInlineForm();
  });
}

function actionForm({ title, explanation, fields = [], acceptLabel, danger = false, onSubmit }) {
  closeInlineForm({ restoreFocus: false });
  activeInlineReturnFocus = document.activeElement;
  const form = createElement('form', { className: 'zadmin-management-inline-form', attributes: { novalidate: '' } });
  const heading = createElement('div');
  heading.append(
    createElement('strong', { textContent: title }),
    createElement('p', { className: 'zadmin-muted', textContent: explanation }),
  );
  form.append(heading);

  for (const field of fields) {
    const label = createElement('label', { textContent: field.label });
    const control = createElement(field.multiline ? 'textarea' : 'input', {
      attributes: {
        name: field.name,
        minlength: field.minlength ?? null,
        maxlength: field.maxlength ?? null,
        rows: field.multiline ? (field.rows || 3) : null,
        autocomplete: 'off',
        placeholder: field.placeholder || null,
        required: '',
      },
    });
    label.append(control);
    form.append(label);
  }

  const status = createElement('p', { className: 'zadmin-status', attributes: { role: 'status', 'aria-live': 'polite' } });
  const actions = createElement('div', { className: 'zadmin-management-inline-form__actions' });
  const cancel = createElement('button', { className: 'ghost', textContent: 'Cancelar', attributes: { type: 'button' } });
  const accept = createElement('button', { className: danger ? 'zadmin-danger' : 'primary', textContent: acceptLabel, attributes: { type: 'submit' } });
  cancel.addEventListener('click', () => closeInlineForm());
  actions.append(cancel, accept);
  form.append(status, actions);
  installEscapeCancellation(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const reason = text(values.reason).trim();
    if (fields.some((field) => field.name === 'reason') && (reason.length < 3 || reason.length > 500)) {
      setStatus(status, 'El motivo debe tener entre 3 y 500 caracteres.', 'error');
      form.elements.namedItem('reason')?.focus();
      return;
    }
    accept.disabled = true;
    cancel.disabled = true;
    setStatus(status, 'Guardando…');
    try {
      await onSubmit(values);
      closeInlineForm();
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : 'No se pudo completar la acción.', 'error');
      accept.disabled = false;
      cancel.disabled = false;
    }
  });

  activeInlineForm = form;
  return form;
}

function restrictionCard(restriction) {
  const card = createElement('article', { className: 'zadmin-management-item' });
  const header = createElement('div', { className: 'zadmin-management-item__header' });
  const title = createElement('div', { className: 'zadmin-management-item__title' });
  const related = Array.isArray(restriction.relatedNicks) && restriction.relatedNicks.length
    ? restriction.relatedNicks.join(', ')
    : shortValue(restriction.target);
  title.append(
    createElement('strong', { textContent: related || 'Restricción automática' }),
    createElement('span', { className: 'zadmin-muted', textContent: `${scopeLabel(restriction.scope)} · ${shortValue(restriction.target)}` }),
  );
  const badges = createElement('div', { className: 'zadmin-management-badges' });
  badges.append(
    badge(statusLabel(restriction.status), statusTone(restriction.status)),
    badge(`Policy v${Number(restriction.policy_version) || 0}`),
  );
  title.append(badges);
  header.append(title);
  card.append(header);

  const details = createElement('details', { className: 'zadmin-management-disclosure' });
  details.append(createElement('summary', { textContent: 'Expandir detalle y evidencia' }));
  const grid = createElement('div', { className: 'zadmin-management-detail-grid' });
  grid.append(
    detailCell('ID de restricción', restriction.id, { code: true }),
    detailCell('Ámbito', scopeLabel(restriction.scope)),
    detailCell('Objetivo', restriction.target, { code: true }),
    detailCell('Intento origen', restriction.source_attempt_id, { code: true }),
    detailCell('Activada', formatDate(restriction.triggered_at)),
    detailCell('Expira', formatDate(restriction.expires_at)),
    detailCell('Motivo del motor', restriction.reason),
    detailCell('Última acción admin', restriction.adminAction?.action ? `${restriction.adminAction.action} · ${formatDate(restriction.adminAction.created_at)}` : 'Ninguna'),
  );
  details.append(grid);

  const evidenceTitle = createElement('strong', { textContent: 'Evidencia técnica' });
  const evidence = createElement('pre', {
    className: 'zadmin-management-evidence',
    textContent: JSON.stringify(restriction.evidence || {}, null, 2),
  });
  details.append(evidenceTitle, evidence);

  const actions = createElement('div', { className: 'zadmin-management-actions' });
  if (restriction.status === 'active') {
    const lift = createElement('button', { className: 'zadmin-danger', textContent: 'Quitar restricción', attributes: { type: 'button' } });
    lift.addEventListener('click', () => {
      const form = actionForm({
        title: 'Quitar restricción automática',
        explanation: 'El ban original y su evidencia permanecerán intactos. Esta excepción quedará auditada.',
        fields: [{ name: 'reason', label: 'Motivo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Explica por qué se levanta la restricción' }],
        acceptLabel: 'Quitar restricción',
        danger: true,
        onSubmit: async ({ reason }) => {
          await managementRequest('lift-integrity-restriction', { banId: restriction.id, reason: text(reason).trim() });
          await loadRestrictions('Restricción levantada.');
        },
      });
      details.append(form);
      form.querySelector('textarea')?.focus();
    });
    actions.append(lift);
  } else if (restriction.status === 'lifted' && new Date(restriction.expires_at).getTime() > Date.now()) {
    const reinstate = createElement('button', { className: 'secondary', textContent: 'Restaurar restricción', attributes: { type: 'button' } });
    reinstate.addEventListener('click', () => {
      const form = actionForm({
        title: 'Restaurar restricción automática',
        explanation: 'Volverá a aplicarse el ban original únicamente hasta su expiración original.',
        fields: [{ name: 'reason', label: 'Motivo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Explica por qué se restaura la restricción' }],
        acceptLabel: 'Restaurar restricción',
        onSubmit: async ({ reason }) => {
          await managementRequest('reinstate-integrity-restriction', { banId: restriction.id, reason: text(reason).trim() });
          await loadRestrictions('Restricción restaurada.');
        },
      });
      details.append(form);
      form.querySelector('textarea')?.focus();
    });
    actions.append(reinstate);
  }
  if (actions.childElementCount) details.append(actions);
  card.append(details);
  return card;
}

function playerCard(player) {
  const card = createElement('article', { className: 'zadmin-management-item' });
  const header = createElement('div', { className: 'zadmin-management-item__header' });
  const title = createElement('div', { className: 'zadmin-management-item__title' });
  title.append(
    createElement('strong', { textContent: text(player.nick) || 'Jugador' }),
    createElement('span', { className: 'zadmin-muted', textContent: `Player ID · ${shortValue(player.playerId)}` }),
  );
  const badges = createElement('div', { className: 'zadmin-management-badges' });
  if (player.renameRequired) badges.append(badge('Cambio de nick requerido', 'warning'));
  if (player.verifiedEmailAvailable) badges.append(badge('Email verificado disponible', 'success'));
  title.append(badges);
  header.append(title);
  card.append(header);

  const details = createElement('details', { className: 'zadmin-management-disclosure' });
  details.append(createElement('summary', { textContent: 'Expandir jugador y acciones' }));
  const grid = createElement('div', { className: 'zadmin-management-detail-grid' });
  grid.append(
    detailCell('Player ID', player.playerId, { code: true }),
    detailCell('Nick actual', player.nick),
    detailCell('Nick key', player.nickKey, { code: true }),
    detailCell('Cuenta', player.accountId || 'Sin cuenta vinculada', { code: Boolean(player.accountId) }),
    detailCell('Vinculado', formatDate(player.linkedAt)),
    detailCell('Aviso por email', player.verifiedEmailAvailable ? 'Contacto verificado disponible; este PR no envía correo transaccional.' : 'Sin contacto verificado'),
  );
  if (player.renameRequirement?.reason) {
    grid.append(detailCell('Motivo del cambio requerido', player.renameRequirement.reason));
  }
  details.append(grid);

  const actions = createElement('div', { className: 'zadmin-management-actions' });
  const rename = createElement('button', { className: 'secondary', textContent: 'Renombrar ahora', attributes: { type: 'button' } });
  rename.addEventListener('click', () => {
    const form = actionForm({
      title: 'Renombrar jugador',
      explanation: 'El player ID y la propiedad de la cuenta se conservan. Las referencias legacy se actualizan en la misma transacción.',
      fields: [
        { name: 'nick', label: 'Nuevo nick', minlength: 2, maxlength: 24, placeholder: 'Nuevo nombre' },
        { name: 'reason', label: 'Motivo administrativo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Explica por qué se cambia el nick' },
      ],
      acceptLabel: 'Guardar nuevo nick',
      onSubmit: async ({ nick, reason }) => {
        const normalizedNick = text(nick).trim();
        if (normalizedNick.length < 2 || normalizedNick.length > 24) throw new Error('El nick debe tener entre 2 y 24 caracteres.');
        await managementRequest('rename-player', { playerId: player.playerId, nick: normalizedNick, reason: text(reason).trim() });
        await loadPlayers('Nick actualizado.');
      },
    });
    details.append(form);
    form.querySelector('input[name="nick"]')?.focus();
  });

  const requireRename = createElement('button', { className: 'zadmin-danger', textContent: player.renameRequired ? 'Reiniciar cambio obligatorio' : 'Forzar cambio de nick', attributes: { type: 'button' } });
  requireRename.addEventListener('click', () => {
    const form = actionForm({
      title: 'Forzar cambio de nick',
      explanation: 'El nick público actual se sustituirá inmediatamente por uno temporal seguro. La cuenta no podrá autorizar juego normal hasta elegir un nick válido.',
      fields: [{ name: 'reason', label: 'Motivo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Describe la infracción o la razón de moderación' }],
      acceptLabel: 'Resetear y exigir cambio',
      danger: true,
      onSubmit: async ({ reason }) => {
        await managementRequest('require-player-rename', { playerId: player.playerId, reason: text(reason).trim() });
        await loadPlayers('Cambio obligatorio activado.');
      },
    });
    details.append(form);
    form.querySelector('textarea')?.focus();
  });

  actions.append(rename, requireRename);
  details.append(actions);
  card.append(details);
  return card;
}

async function loadRestrictions(successMessage = '') {
  closeInlineForm({ restoreFocus: false });
  const list = $('#restrictionList');
  const status = $('#restrictionStatus');
  list.replaceChildren();
  setStatus(status, successMessage || 'Cargando restricciones…', successMessage ? 'success' : '');
  try {
    const result = await managementRequest('restrictions', {
      status: $('#restrictionStatusFilter').value,
      scope: $('#restrictionScopeFilter').value,
      search: $('#restrictionSearch').value,
    });
    const restrictions = Array.isArray(result.restrictions) ? result.restrictions : [];
    if (!restrictions.length) {
      list.append(createElement('p', { className: 'zadmin-management-empty', textContent: 'No hay restricciones que coincidan con estos filtros.' }));
    } else {
      list.append(...restrictions.map(restrictionCard));
    }
    if (!successMessage) setStatus(status, `${restrictions.length} restricciones mostradas.`);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'No se pudieron cargar las restricciones.', 'error');
  }
}

async function loadPlayers(successMessage = '') {
  closeInlineForm({ restoreFocus: false });
  const list = $('#playerList');
  const status = $('#playerStatus');
  list.replaceChildren();
  setStatus(status, successMessage || 'Cargando jugadores…', successMessage ? 'success' : '');
  try {
    const result = await managementRequest('players', { search: $('#playerSearch').value });
    const players = Array.isArray(result.players) ? result.players : [];
    if (!players.length) {
      list.append(createElement('p', { className: 'zadmin-management-empty', textContent: 'No hay jugadores que coincidan con la búsqueda.' }));
    } else {
      list.append(...players.map(playerCard));
    }
    if (!successMessage) setStatus(status, `${players.length} jugadores mostrados.`);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'No se pudieron cargar los jugadores.', 'error');
  }
}

function selectView(view) {
  if (!['restrictions', 'players'].includes(view)) return;
  closeInlineForm();
  activeView = view;
  for (const button of all('[data-management-view]')) {
    const selected = button.dataset.managementView === view;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  for (const panel of all('[data-management-panel]')) panel.hidden = panel.dataset.managementPanel !== view;
  if (view === 'restrictions') loadRestrictions().catch(() => {});
  else loadPlayers().catch(() => {});
}

function showDenied() {
  $('#managementRestore').hidden = true;
  $('#managementDashboard').hidden = true;
  $('#managementDenied').hidden = false;
}

function showDashboard() {
  $('#managementRestore').hidden = true;
  $('#managementDenied').hidden = true;
  $('#managementDashboard').hidden = false;
}

let searchTimer = 0;
function debounce(callback) {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(callback, 300);
}

async function initialize() {
  if (!sessionToken) {
    showDenied();
    return;
  }
  try {
    await managementRequest('session-status');
  } catch {
    showDenied();
    return;
  }
  showDashboard();
  for (const button of all('[data-management-view]')) {
    button.addEventListener('click', () => selectView(button.dataset.managementView));
  }
  $('#reloadRestrictions').addEventListener('click', () => loadRestrictions().catch(() => {}));
  $('#restrictionStatusFilter').addEventListener('change', () => loadRestrictions().catch(() => {}));
  $('#restrictionScopeFilter').addEventListener('change', () => loadRestrictions().catch(() => {}));
  $('#restrictionSearch').addEventListener('input', () => debounce(() => loadRestrictions().catch(() => {})));
  $('#reloadPlayers').addEventListener('click', () => loadPlayers().catch(() => {}));
  $('#playerSearch').addEventListener('input', () => debounce(() => loadPlayers().catch(() => {})));
  await loadRestrictions();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch(showDenied), { once: true });
else initialize().catch(showDenied);
