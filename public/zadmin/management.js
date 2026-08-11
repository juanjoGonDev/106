const config = window.__MINUTO106_CONFIG__ || {};
const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1';
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,80}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const persistence = window.Minuto106ZadminSessionPersistence;
const fieldController = window.Minuto106NicknameFieldController;

let sessionToken = String(persistence?.read?.() || '').trim().toLowerCase();
let activeInlineForm = null;
let activeInlineReturnFocus = null;
let activeNicknameController = null;
let activeView = 'restrictions';
const pages = {
  restrictions: { page: 1, pageSize: 25, pagination: null },
  players: { page: 1, pageSize: 25, pagination: null },
};

function $(selector) { return document.querySelector(selector); }
function all(selector) { return [...document.querySelectorAll(selector)]; }
function text(value) { return String(value ?? ''); }

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
  if (!endpoint || !SESSION_TOKEN_PATTERN.test(sessionToken)) throw new Error('La sesión de administración no está disponible.');
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
      persistence?.clear?.();
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
  if (!value) return 'Permanente';
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
  if (scope === 'nick') return 'Nick';
  if (scope === 'device') return 'Dispositivo';
  if (scope === 'ip') return 'IP (huella)';
  return text(scope) || '—';
}

function statusLabel(status) {
  if (status === 'active') return 'Activa';
  if (status === 'lifted') return 'Levantada por admin';
  if (status === 'revoked') return 'Revocada';
  return 'Expirada';
}

function statusTone(status) {
  if (status === 'active') return 'danger';
  if (status === 'lifted' || status === 'revoked') return 'success';
  return 'warning';
}

function sourceLabel(source) { return source === 'manual' ? 'Manual' : 'Integridad automática'; }

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
  activeNicknameController?.destroy?.();
  activeNicknameController = null;
  if (!(activeInlineForm instanceof HTMLElement)) return;
  const returnFocus = activeInlineReturnFocus;
  activeInlineForm.remove();
  activeInlineForm = null;
  activeInlineReturnFocus = null;
  if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
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
        autocomplete: field.autocomplete || 'off',
        spellcheck: field.spellcheck === false ? 'false' : null,
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
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeInlineForm();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const reason = text(values.reason).trim();
    if (fields.some((field) => field.name === 'reason') && (reason.length < 3 || reason.length > 500)) {
      setStatus(status, 'El motivo debe tener entre 3 y 500 caracteres.', 'error');
      form.elements.namedItem('reason')?.focus();
      return;
    }
    if (activeNicknameController && !activeNicknameController.isReady()) {
      activeNicknameController.refresh();
      form.elements.namedItem('nick')?.focus();
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
      accept.disabled = activeNicknameController ? !activeNicknameController.isReady() : false;
      cancel.disabled = false;
    }
  });
  activeInlineForm = form;
  return { form, status, accept };
}

function restrictionAction(details, restriction) {
  const actions = createElement('div', { className: 'zadmin-management-actions' });
  const automatic = restriction.source === 'integrity';
  let label = '';
  let action = '';
  let explanation = '';
  let success = '';
  if (!automatic && restriction.status === 'active') {
    label = 'Revocar restricción manual'; action = 'revoke-manual-restriction';
    explanation = 'El historial del ban permanecerá en auditoría.'; success = 'Restricción manual revocada.';
  } else if (automatic && restriction.status === 'active') {
    label = 'Quitar restricción'; action = 'lift-integrity-restriction';
    explanation = 'El ban original y su evidencia permanecerán intactos. La excepción quedará auditada.'; success = 'Restricción automática levantada.';
  } else if (automatic && restriction.status === 'lifted' && Date.parse(text(restriction.expires_at)) > Date.now()) {
    label = 'Restaurar restricción'; action = 'reinstate-integrity-restriction';
    explanation = 'Se vuelve a aplicar el ban original únicamente hasta su expiración original.'; success = 'Restricción automática restaurada.';
  }
  if (!action) return;

  const button = createElement('button', {
    className: action === 'reinstate-integrity-restriction' ? 'secondary' : 'zadmin-danger',
    textContent: label,
    attributes: { type: 'button' },
  });
  button.addEventListener('click', () => {
    const { form } = actionForm({
      title: label,
      explanation,
      fields: [{ name: 'reason', label: 'Motivo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Explica la decisión administrativa' }],
      acceptLabel: label,
      danger: action !== 'reinstate-integrity-restriction',
      onSubmit: async ({ reason }) => {
        await managementRequest(action, { banId: restriction.id, reason: text(reason).trim() });
        await loadRestrictions(success);
      },
    });
    details.append(form);
    form.querySelector('textarea')?.focus();
  });
  actions.append(button);
  details.append(actions);
}

function restrictionCard(restriction) {
  const card = createElement('article', { className: 'zadmin-management-item' });
  const title = createElement('div', { className: 'zadmin-management-item__title' });
  title.append(
    createElement('strong', { textContent: shortValue(restriction.target) || 'Restricción' }),
    createElement('span', { className: 'zadmin-muted', textContent: `${sourceLabel(restriction.source)} · ${scopeLabel(restriction.scope)} · ${shortValue(restriction.target)}` }),
  );
  const badges = createElement('div', { className: 'zadmin-management-badges' });
  badges.append(badge(statusLabel(restriction.status), statusTone(restriction.status)), badge(sourceLabel(restriction.source)));
  if (restriction.source === 'integrity') badges.append(badge(`Policy v${Number(restriction.policy_version) || 0}`));
  title.append(badges);
  card.append(title);

  const details = createElement('details', { className: 'zadmin-management-disclosure' });
  details.append(createElement('summary', { textContent: 'Expandir detalle y acciones' }));
  const grid = createElement('div', { className: 'zadmin-management-detail-grid' });
  grid.append(
    detailCell('ID de restricción', restriction.id, { code: true }),
    detailCell('Origen', sourceLabel(restriction.source)),
    detailCell('Ámbito', scopeLabel(restriction.scope)),
    detailCell('Objetivo', restriction.target, { code: true }),
    detailCell('Activada', formatDate(restriction.triggered_at)),
    detailCell('Expira', formatDate(restriction.expires_at)),
    detailCell('Motivo', restriction.reason),
    detailCell('Última acción admin', restriction.adminAction?.action ? `${restriction.adminAction.action} · ${formatDate(restriction.adminAction.created_at)}` : 'Ninguna'),
  );
  if (restriction.source === 'integrity') grid.append(detailCell('Intento origen', restriction.source_attempt_id, { code: true }));
  details.append(grid);
  if (restriction.source === 'integrity') {
    details.append(
      createElement('strong', { textContent: 'Evidencia técnica' }),
      createElement('pre', { className: 'zadmin-management-evidence', textContent: JSON.stringify(restriction.evidence || {}, null, 2) }),
    );
  }
  restrictionAction(details, restriction);
  card.append(details);
  return card;
}

function playerCard(player) {
  const card = createElement('article', { className: 'zadmin-management-item' });
  const title = createElement('div', { className: 'zadmin-management-item__title' });
  title.append(
    createElement('strong', { textContent: text(player.nick) || 'Jugador' }),
    createElement('span', { className: 'zadmin-muted', textContent: `Player ID · ${shortValue(player.playerId)}` }),
  );
  const badges = createElement('div', { className: 'zadmin-management-badges' });
  if (player.renameRequired) badges.append(badge('Cambio de nick requerido', 'warning'));
  if (player.verifiedEmailAvailable) badges.append(badge('Email verificado disponible', 'success'));
  title.append(badges);
  card.append(title);

  const details = createElement('details', { className: 'zadmin-management-disclosure' });
  details.append(createElement('summary', { textContent: 'Expandir jugador y acciones' }));
  const grid = createElement('div', { className: 'zadmin-management-detail-grid' });
  grid.append(
    detailCell('Player ID', player.playerId, { code: true }),
    detailCell('Nick actual', player.nick),
    detailCell('Nick key', player.nickKey, { code: true }),
    detailCell('Cuenta', player.accountId || 'Sin cuenta vinculada', { code: Boolean(player.accountId) }),
    detailCell('Vinculado', formatDate(player.linkedAt)),
  );
  if (player.renameRequirement?.originalNick) grid.append(detailCell('Nick anterior moderado', player.renameRequirement.originalNick));
  if (player.renameRequirement?.reason) grid.append(detailCell('Motivo del cambio requerido', player.renameRequirement.reason));
  details.append(grid);

  const actions = createElement('div', { className: 'zadmin-management-actions' });
  const rename = createElement('button', { className: 'secondary', textContent: 'Renombrar ahora', attributes: { type: 'button' } });
  rename.addEventListener('click', () => {
    const { form, status, accept } = actionForm({
      title: 'Renombrar jugador',
      explanation: 'El player ID, propiedad e historial se conservan. La validación es la misma que usa el resto de la aplicación.',
      fields: [
        { name: 'nick', label: 'Nuevo nick', minlength: 3, maxlength: 24, autocomplete: 'nickname', spellcheck: false, placeholder: 'Nuevo nombre' },
        { name: 'reason', label: 'Motivo administrativo', multiline: true, minlength: 3, maxlength: 500, placeholder: 'Explica por qué se cambia el nick' },
      ],
      acceptLabel: 'Guardar nuevo nick',
      onSubmit: async ({ nick, reason }) => {
        await managementRequest('rename-player', { playerId: player.playerId, nick: text(nick), reason: text(reason).trim() });
        await loadPlayers('Nick actualizado.');
      },
    });
    details.append(form);
    const input = form.querySelector('input[name="nick"]');
    if (fieldController && input) {
      activeNicknameController = fieldController.create({
        input,
        status,
        submitButton: accept,
        checkFn: ({ nick }) => managementRequest('check-nickname', { playerId: player.playerId, nick }),
        readyMessage: 'Nick válido y disponible. Puedes guardar el cambio.',
      });
    }
    input?.focus();
  });

  const requireRename = createElement('button', { className: 'zadmin-danger', textContent: player.renameRequired ? 'Reiniciar cambio obligatorio' : 'Forzar cambio de nick', attributes: { type: 'button' } });
  requireRename.disabled = !player.accountId;
  if (!player.accountId) requireRename.title = 'El jugador no tiene una cuenta vinculada capaz de completar el cambio obligatorio.';
  requireRename.addEventListener('click', () => {
    const { form } = actionForm({
      title: 'Forzar cambio de nick',
      explanation: `Se conservará el nombre anterior “${text(player.nick)}” en el estado de moderación y se asignará un alias temporal seguro.`,
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

function renderPagination(kind) {
  const state = pages[kind];
  const data = state.pagination || { page: state.page, pageSize: state.pageSize, total: 0, totalPages: 0, hasPrevious: false, hasNext: false };
  state.page = Number(data.page) || 1;
  state.pageSize = Number(data.pageSize) || state.pageSize;
  const prefix = kind === 'restrictions' ? 'restriction' : 'player';
  $(`#${prefix}Previous`).disabled = data.hasPrevious !== true;
  $(`#${prefix}Next`).disabled = data.hasNext !== true;
  $(`#${prefix}PageSize`).value = String(state.pageSize);
  $(`#${prefix}PageStatus`).textContent = data.totalPages
    ? `Página ${data.page} de ${data.totalPages} · ${data.total} resultados`
    : 'Sin resultados';
}

async function loadRestrictions(successMessage = '') {
  closeInlineForm({ restoreFocus: false });
  const list = $('#restrictionList');
  const status = $('#restrictionStatus');
  list.replaceChildren();
  setStatus(status, successMessage || 'Cargando restricciones…', successMessage ? 'success' : '');
  try {
    const state = pages.restrictions;
    const result = await managementRequest('restrictions', {
      status: $('#restrictionStatusFilter').value,
      scope: $('#restrictionScopeFilter').value,
      search: $('#restrictionSearch').value,
      page: state.page,
      pageSize: state.pageSize,
    });
    const restrictions = Array.isArray(result.items) ? result.items : Array.isArray(result.restrictions) ? result.restrictions : [];
    state.pagination = result.pagination;
    if (!restrictions.length) list.append(createElement('p', { className: 'zadmin-management-empty', textContent: 'No hay restricciones que coincidan con estos filtros.' }));
    else list.append(...restrictions.map(restrictionCard));
    renderPagination('restrictions');
    if (!successMessage) setStatus(status, `${result.pagination?.total ?? restrictions.length} restricciones encontradas.`);
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
    const state = pages.players;
    const result = await managementRequest('players', { search: $('#playerSearch').value, page: state.page, pageSize: state.pageSize });
    const players = Array.isArray(result.items) ? result.items : Array.isArray(result.players) ? result.players : [];
    state.pagination = result.pagination;
    if (!players.length) list.append(createElement('p', { className: 'zadmin-management-empty', textContent: 'No hay jugadores que coincidan con la búsqueda.' }));
    else list.append(...players.map(playerCard));
    renderPagination('players');
    if (!successMessage) setStatus(status, `${result.pagination?.total ?? players.length} jugadores encontrados.`);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'No se pudieron cargar los jugadores.', 'error');
  }
}

function resetPage(kind) { pages[kind].page = 1; }

function selectView(view) {
  if (!['restrictions', 'players'].includes(view) || activeView === view) return;
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
  closeInlineForm({ restoreFocus: false });
  $('#managementRestore').hidden = true;
  $('#managementDashboard').hidden = true;
  $('#managementDenied').hidden = false;
}

function showDashboard() {
  $('#managementRestore').hidden = true;
  $('#managementDenied').hidden = true;
  $('#managementDashboard').hidden = false;
}

async function restoreSession() {
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) { showDenied(); return; }
  try {
    await managementRequest('session-status');
    showDashboard();
    await loadRestrictions();
  } catch {
    showDenied();
  }
}

for (const button of all('[data-management-view]')) button.addEventListener('click', () => selectView(button.dataset.managementView));
$('#reloadRestrictions')?.addEventListener('click', () => loadRestrictions().catch(() => {}));
$('#reloadPlayers')?.addEventListener('click', () => loadPlayers().catch(() => {}));
for (const selector of ['#restrictionStatusFilter', '#restrictionScopeFilter']) {
  $(selector)?.addEventListener('change', () => { resetPage('restrictions'); loadRestrictions().catch(() => {}); });
}
$('#restrictionSearch')?.addEventListener('search', () => { resetPage('restrictions'); loadRestrictions().catch(() => {}); });
$('#restrictionSearch')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); resetPage('restrictions'); loadRestrictions().catch(() => {}); }
});
$('#playerSearch')?.addEventListener('search', () => { resetPage('players'); loadPlayers().catch(() => {}); });
$('#playerSearch')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); resetPage('players'); loadPlayers().catch(() => {}); }
});
$('#restrictionPrevious')?.addEventListener('click', () => { pages.restrictions.page = Math.max(1, pages.restrictions.page - 1); loadRestrictions().catch(() => {}); });
$('#restrictionNext')?.addEventListener('click', () => { pages.restrictions.page += 1; loadRestrictions().catch(() => {}); });
$('#playerPrevious')?.addEventListener('click', () => { pages.players.page = Math.max(1, pages.players.page - 1); loadPlayers().catch(() => {}); });
$('#playerNext')?.addEventListener('click', () => { pages.players.page += 1; loadPlayers().catch(() => {}); });
$('#restrictionPageSize')?.addEventListener('change', (event) => { pages.restrictions.pageSize = Number(event.target.value) || 25; resetPage('restrictions'); loadRestrictions().catch(() => {}); });
$('#playerPageSize')?.addEventListener('change', (event) => { pages.players.pageSize = Number(event.target.value) || 25; resetPage('players'); loadPlayers().catch(() => {}); });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeInlineForm) closeInlineForm();
});

restoreSession().catch(() => showDenied());
