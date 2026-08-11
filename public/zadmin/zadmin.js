const config = window.__MINUTO106_CONFIG__ || {};
const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1';
const SESSION_STORAGE_KEY = 'minuto106.zadmin.session.v1';
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,80}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const SCOPES = new Set(['account', 'nick', 'ip']);
const RISK_BUCKETS = ['0-19', '20-39', '40-59', '60-79', '80-100'];

let sessionToken = readSessionToken();
let currentScope = 'account';
let currentTarget = '';
let currentDetail = null;
let confirmResolver = null;
let confirmReturnFocus = null;
let revokeResolver = null;
let revokeReturnFocus = null;
let activeAttemptReviewForm = null;
let attemptReviewReturnFocus = null;

function $(selector) {
  return document.querySelector(selector);
}

function all(selector) {
  return [...document.querySelectorAll(selector)];
}

function text(value) {
  return String(value ?? '');
}

function boundedNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
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

function replaceChildren(element, children = []) {
  element.replaceChildren(...children.filter(Boolean));
}

function setStatus(element, message = '', tone = '') {
  element.textContent = message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function focusIfAvailable(element) {
  if (element instanceof HTMLElement && element.isConnected) element.focus();
}

function readSessionToken() {
  try {
    const token = text(sessionStorage.getItem(SESSION_STORAGE_KEY)).trim().toLowerCase();
    if (SESSION_TOKEN_PATTERN.test(token)) return token;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable in hardened/private browser contexts.
  }
  return '';
}

function persistSessionToken(token) {
  const normalized = text(token).trim().toLowerCase();
  if (!SESSION_TOKEN_PATTERN.test(normalized)) return false;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

function removePersistedSessionToken() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // The in-memory token is still cleared even when browser storage is unavailable.
  }
}

function settleConfirm(accepted) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  const returnFocus = confirmReturnFocus;
  confirmResolver = null;
  confirmReturnFocus = null;
  $('#adminBanConfirmComponent').hidden = true;
  focusIfAvailable(returnFocus);
  resolve(accepted === true);
}

function askAdmin({
  title = 'Confirma la acción',
  message = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
} = {}) {
  if (confirmResolver) return Promise.resolve(false);
  closeAttemptReview({ restoreFocus: false });
  $('#adminBanConfirmTitle').textContent = text(title);
  $('#adminBanConfirmMessage').textContent = text(message);
  $('#adminBanConfirmAccept').textContent = text(confirmLabel) || 'Confirmar';
  $('#adminBanConfirmCancel').textContent = text(cancelLabel) || 'Cancelar';
  confirmReturnFocus = document.activeElement;
  $('#adminBanConfirmComponent').hidden = false;
  window.requestAnimationFrame(() => $('#adminBanConfirmCancel').focus());
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function settleRevokeReason(value) {
  if (!revokeResolver) return;
  const resolve = revokeResolver;
  const returnFocus = revokeReturnFocus;
  revokeResolver = null;
  revokeReturnFocus = null;
  const component = $('#adminRevokeComponent');
  component.hidden = true;
  $('#adminActionComponentHost').append(component);
  focusIfAvailable(returnFocus);
  resolve(value);
}

function requestRevokeReason(anchor) {
  if (revokeResolver) return Promise.resolve(null);
  closeAttemptReview({ restoreFocus: false });
  $('#adminRevokeReason').value = '';
  setStatus($('#adminRevokeStatus'));
  revokeReturnFocus = document.activeElement;
  const component = $('#adminRevokeComponent');
  const destination = anchor instanceof HTMLElement ? anchor : $('#adminBansView');
  destination.append(component);
  component.hidden = false;
  window.requestAnimationFrame(() => $('#adminRevokeReason').focus());
  return new Promise((resolve) => {
    revokeResolver = resolve;
  });
}

function submitRevokeReason(event) {
  event.preventDefault();
  const reason = $('#adminRevokeReason').value.trim();
  if (reason.length < 3) {
    setStatus($('#adminRevokeStatus'), 'El motivo debe tener al menos 3 caracteres.', 'error');
    $('#adminRevokeReason').focus();
    return;
  }
  settleRevokeReason(reason);
}

function closeAttemptReview({ restoreFocus = true } = {}) {
  if (!(activeAttemptReviewForm instanceof HTMLElement)) return;
  const returnFocus = attemptReviewReturnFocus;
  activeAttemptReviewForm.remove();
  activeAttemptReviewForm = null;
  attemptReviewReturnFocus = null;
  if (restoreFocus) focusIfAvailable(returnFocus);
}

function apiUrl() {
  try {
    const base = new URL(text(config.supabaseUrl));
    const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (base.protocol !== 'https:' && !local) return '';
    return `${base.origin}/functions/v1/zadmin-api`;
  } catch {
    return '';
  }
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
    if (!window.__zadminEphemeralDeviceId) window.__zadminEphemeralDeviceId = randomDeviceId();
    return window.__zadminEphemeralDeviceId;
  }
}

async function adminRequest(action, payload = {}, { requireSession = true } = {}) {
  const endpoint = apiUrl();
  if (!endpoint) throw new Error('La API de administración no está configurada.');
  const headers = {
    'content-type': 'application/json',
    'x-device-id': deviceId(),
  };
  if (requireSession) {
    if (!sessionToken) throw new Error('La sesión de administración no está activa.');
    headers.authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20_000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('La API devolvió una respuesta no válida.');
  }

  if (!response.ok) {
    if (response.status === 401 && result.code === 'invalid_session') clearSession('La sesión ha caducado por inactividad o ha sido revocada. Vuelve a iniciar sesión.');
    const error = new Error(text(result.error) || `La operación falló (${response.status}).`);
    error.code = result.code;
    error.retryAfterSeconds = result.retryAfterSeconds;
    error.attemptsRemaining = result.attemptsRemaining;
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

function shortHash(value) {
  const source = text(value);
  if (source.length <= 22) return source || '—';
  return `${source.slice(0, 10)}…${source.slice(-8)}`;
}

function scopeLabel(scope) {
  if (scope === 'account') return 'Cuenta';
  if (scope === 'ip') return 'IP (huella)';
  if (scope === 'device') return 'Dispositivo';
  if (scope === 'attempt') return 'Intento';
  return 'Nick';
}

function riskLevel(score) {
  const value = boundedNumber(score, 0, 100);
  if (value >= 70) return 'high';
  if (value >= 35) return 'medium';
  return 'low';
}

function metric(label, value) {
  const container = createElement('div', { className: 'zadmin-metric' });
  container.append(
    createElement('strong', { textContent: text(value) }),
    createElement('span', { textContent: label }),
  );
  return container;
}

function removeRestorePanel() {
  $('#adminSessionRestore')?.remove();
}

function showRestoringSession() {
  $('#adminLoginPanel').hidden = true;
  $('#adminDashboard').hidden = true;
  if ($('#adminSessionRestore')) return;
  const stage = createElement('section', {
    className: 'zadmin-login-stage',
    attributes: { id: 'adminSessionRestore', 'aria-live': 'polite', 'aria-busy': 'true' },
  });
  const card = createElement('div', { className: 'zadmin-card zadmin-login-card' });
  card.append(
    createElement('p', { className: 'eyebrow', textContent: 'ADMINISTRACIÓN PRIVADA' }),
    createElement('h1', { textContent: 'Comprobando sesión' }),
    createElement('p', { className: 'zadmin-muted', textContent: 'Validando el acceso con el servidor…' }),
  );
  stage.append(card);
  $('.zadmin-shell').prepend(stage);
}

function showLogin(message = '') {
  removeRestorePanel();
  $('#adminLoginPanel').hidden = false;
  $('#adminDashboard').hidden = true;
  if (message) setStatus($('#adminLoginStatus'), message, 'warning');
}

function showDashboard() {
  removeRestorePanel();
  $('#adminLoginPanel').hidden = true;
  $('#adminDashboard').hidden = false;
}

function updateSessionClock() {
  if (!sessionToken) return;
  $('#adminSessionStatus').textContent = 'Sesión activa. Se conserva durante esta sesión del navegador, se renueva con cada uso y el servidor la cierra tras 12 h sin actividad.';
}

function startSessionClock() {
  updateSessionClock();
}

function clearSession(message = '') {
  if (confirmResolver) settleConfirm(false);
  if (revokeResolver) settleRevokeReason(null);
  closeAttemptReview({ restoreFocus: false });
  sessionToken = '';
  removePersistedSessionToken();
  currentTarget = '';
  currentDetail = null;
  showLogin(message);
  $('#adminPassword').value = '';
}

function renderSummary(summary = {}) {
  replaceChildren($('#adminSummary'), [
    metric('Intentos', boundedNumber(summary.attempts)),
    metric('Watch', boundedNumber(summary.watchAttempts)),
    metric('Excluidos', boundedNumber(summary.excludedAttempts)),
    metric('Bans manuales activos', boundedNumber(summary.activeManualBans)),
    metric('Restricciones automáticas', boundedNumber(summary.activeAutomaticRestrictions)),
    metric('Cuentas', boundedNumber(summary.distinctAccounts)),
    metric('Nicks', boundedNumber(summary.distinctNicks)),
    metric('Huellas IP', boundedNumber(summary.distinctIps)),
    metric('Verificados', boundedNumber(summary.verifiedAttempts)),
  ]);
}

function entityLabel(entity) {
  if (currentScope === 'nick') return text(entity.label) || text(entity.key);
  return shortHash(entity.key);
}

function renderEntities(entities = []) {
  const body = $('#adminEntityRows');
  const rows = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    const row = document.createElement('tr');
    const label = createElement('td', { textContent: entityLabel(entity) });
    label.title = text(entity.key);
    const attempts = createElement('td', { textContent: text(boundedNumber(entity.attempts)) });
    const risk = createElement('td', { textContent: `${boundedNumber(entity.maxRiskScore, 0, 100)} / 100` });
    const watch = createElement('td', { textContent: text(boundedNumber(entity.watchAttempts)) });
    const excluded = createElement('td', { textContent: text(boundedNumber(entity.excludedAttempts)) });
    const action = document.createElement('td');
    const button = createElement('button', {
      className: 'zadmin-review-button',
      textContent: 'Revisar',
      attributes: { type: 'button', 'aria-label': `Revisar ${scopeLabel(currentScope)} ${entityLabel(entity)}` },
    });
    button.addEventListener('click', () => loadDetail(currentScope, text(entity.key)));
    action.append(button);
    row.append(label, attempts, risk, watch, excluded, action);
    rows.push(row);
  }
  replaceChildren(body, rows);
  $('#adminEntitiesEmpty').hidden = rows.length > 0;
}

async function loadOverview({ preserveDetail = false } = {}) {
  const status = $('#adminOverviewStatus');
  setStatus(status, 'Cargando actividad…');
  $('#adminRefreshButton').disabled = true;
  try {
    currentScope = SCOPES.has($('#adminScope').value) ? $('#adminScope').value : 'account';
    const result = await adminRequest('overview', {
      scope: currentScope,
      rangeDays: Number($('#adminRangeDays').value),
      search: $('#adminSearch').value,
    });
    renderSummary(result.summary);
    renderEntities(result.entities);
    const note = result.truncated
      ? 'Vista limitada a los 2.000 intentos más recientes del periodo. Refina la búsqueda para investigar casos concretos.'
      : `${boundedNumber(result.summary?.attempts)} intentos analizados.`;
    setStatus(status, note, result.truncated ? 'warning' : 'success');
    if (currentTarget && !preserveDetail) resetDetail();
    return true;
  } catch (error) {
    setStatus(status, error.message, 'error');
    return false;
  } finally {
    $('#adminRefreshButton').disabled = false;
  }
}

function renderDetailSummary(summary = {}) {
  replaceChildren($('#adminDetailSummary'), [
    metric('Intentos', boundedNumber(summary.attempts)),
    metric('Riesgo máximo', `${boundedNumber(summary.maxRiskScore, 0, 100)} / 100`),
    metric('Watch', boundedNumber(summary.watchAttempts)),
    metric('Excluidos', boundedNumber(summary.excludedAttempts)),
    metric('Nicks asociados', boundedNumber(summary.distinctNicks)),
    metric('Cuentas asociadas', boundedNumber(summary.distinctAccounts)),
    metric('IP asociadas', boundedNumber(summary.distinctIps)),
    metric('Dispositivos', boundedNumber(summary.distinctDevices)),
  ]);
}

function renderRiskDistribution(distribution = {}) {
  const total = RISK_BUCKETS.reduce((sum, bucket) => sum + boundedNumber(distribution[bucket]), 0);
  const rows = RISK_BUCKETS.map((bucket) => {
    const count = boundedNumber(distribution[bucket]);
    const percent = total ? Math.round((count / total) * 100) : 0;
    const row = createElement('div', { className: 'zadmin-risk-row' });
    const label = createElement('span', { textContent: bucket });
    const track = createElement('div', {
      className: 'zadmin-risk-track',
      attributes: {
        role: 'img',
        'aria-label': `${bucket}: ${count} intentos, ${percent}%`,
      },
    });
    const fill = createElement('div', { className: 'zadmin-risk-fill' });
    fill.style.setProperty('--risk-width', `${boundedNumber(percent, 0, 100)}%`);
    track.append(fill);
    row.append(label, track, createElement('span', { textContent: text(count) }));
    return row;
  });
  replaceChildren($('#adminRiskDistribution'), rows);
}

function correlationGroup(label, values) {
  const section = createElement('div', { className: 'zadmin-correlation-group' });
  section.append(createElement('strong', { textContent: label }));
  const list = createElement('div', { className: 'zadmin-chip-list' });
  const items = Array.isArray(values) && values.length ? values : ['—'];
  for (const value of items) {
    const chip = createElement('span', { className: 'zadmin-chip', textContent: shortHash(value) });
    chip.title = text(value);
    list.append(chip);
  }
  section.append(list);
  return section;
}

function renderCorrelations(correlations = {}) {
  replaceChildren($('#adminCorrelations'), [
    correlationGroup('Cuentas', correlations.accounts),
    correlationGroup('Nicks', correlations.nicks),
    correlationGroup('Huellas IP', correlations.ips),
    correlationGroup('Dispositivos', correlations.devices),
  ]);
}

function banState(ban) {
  if (ban.active === true) return 'active';
  if (ban.revoked_at) return 'revoked';
  return 'expired';
}

function banStateLabel(ban) {
  const state = banState(ban);
  if (state === 'active') return 'Activo';
  if (state === 'revoked') return 'Revocado';
  return 'Caducado';
}

function isAutomaticRestriction(ban) {
  return ban.restriction_kind === 'integrity' || ban.read_only === true;
}

function banItem(ban, { allowRevoke = true } = {}) {
  const automatic = isAutomaticRestriction(ban);
  const item = createElement('article', { className: 'zadmin-ban-item' });
  if (automatic) item.dataset.restrictionKind = 'integrity';
  const header = document.createElement('header');
  const heading = document.createElement('div');
  heading.append(
    createElement('strong', { textContent: `${scopeLabel(ban.scope)} · ${shortHash(ban.target || banTargetFromRecord(ban))}` }),
    createElement('p', { className: 'zadmin-code', textContent: text(ban.target || banTargetFromRecord(ban)) }),
  );
  const state = createElement('span', {
    className: 'zadmin-state',
    textContent: automatic ? `Automático · ${banStateLabel(ban)}` : banStateLabel(ban),
    attributes: { 'data-state': banState(ban) },
  });
  header.append(heading, state);
  item.append(
    header,
    createElement('p', { textContent: text(ban.reason) }),
    createElement('p', {
      className: 'zadmin-muted',
      textContent: `${automatic ? 'Detectado' : 'Creado'}: ${formatDate(ban.created_at)} · Expira: ${ban.expires_at ? formatDate(ban.expires_at) : 'Nunca'}`,
    }),
  );
  if (automatic) {
    item.append(createElement('p', {
      className: 'zadmin-muted',
      textContent: `Política v${boundedNumber(ban.policy_version, 0)} · Intento origen: ${shortHash(ban.source_attempt_id)}`,
    }));
    const details = document.createElement('details');
    details.append(createElement('summary', { textContent: 'Evidencia de la restricción automática' }));
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({
      policyVersion: ban.policy_version,
      sourceAttemptId: ban.source_attempt_id,
      evidence: ban.evidence || {},
    }, null, 2);
    details.append(pre);
    item.append(details);
  }
  if (ban.revoked_reason) item.append(createElement('p', { className: 'zadmin-muted', textContent: `Revocación: ${text(ban.revoked_reason)}` }));
  if (!automatic && allowRevoke && ban.active === true && ban.id) {
    const button = createElement('button', { className: 'zadmin-inline-button', textContent: 'Revocar ban', attributes: { type: 'button' } });
    button.addEventListener('click', () => revokeBan(text(ban.id), item));
    item.append(button);
  }
  return item;
}

function banTargetFromRecord(ban) {
  if (ban.scope === 'account') return text(ban.account_id);
  if (ban.scope === 'nick') return text(ban.nick_key);
  if (ban.scope === 'device') return text(ban.device_hash);
  return text(ban.ip_hash);
}

function renderEntityBans(bans = [], automaticRestrictions = []) {
  const manual = (Array.isArray(bans) ? bans : []).map((ban) => banItem({ ...ban, target: ban.target || currentTarget }));
  const automatic = (Array.isArray(automaticRestrictions) ? automaticRestrictions : []).map((ban) => banItem(ban, { allowRevoke: false }));
  const items = [];
  if (manual.length) {
    items.push(createElement('p', { className: 'eyebrow', textContent: 'MANUALES' }), ...manual);
  }
  if (automatic.length) {
    items.push(createElement('p', { className: 'eyebrow', textContent: 'AUTOMÁTICAS · SOLO LECTURA' }), ...automatic);
  }
  replaceChildren($('#adminEntityBans'), items.length
    ? items
    : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay restricciones manuales ni automáticas registradas para esta entidad.' })]);
}

async function submitAttemptReview(event, attempt, form, status, actionButton) {
  event.preventDefault();
  const textarea = form.querySelector('textarea');
  const reason = textarea?.value.trim() || '';
  if (reason.length < 3) {
    setStatus(status, 'El motivo debe tener al menos 3 caracteres.', 'error');
    textarea?.focus();
    return;
  }

  const invalidating = attempt.manual_invalidated !== true;
  const attemptId = text(attempt.id);
  const scope = currentScope;
  const target = currentTarget;
  actionButton.disabled = true;
  setStatus(status, invalidating ? 'Invalidando tiempo…' : 'Restaurando tiempo…');
  try {
    await adminRequest(invalidating ? 'invalidate-attempt' : 'restore-attempt', { attemptId, reason });
    closeAttemptReview({ restoreFocus: false });
    await Promise.all([loadDetail(scope, target), loadOverview({ preserveDetail: true })]);
    const nextButton = document.querySelector(`[data-attempt-review-id="${attemptId}"]`);
    focusIfAvailable(nextButton);
    setStatus(
      $('#adminOverviewStatus'),
      invalidating
        ? 'Tiempo invalidado. El intento bruto se conserva y las proyecciones se han reconciliado.'
        : 'Anulación retirada. La política de integridad ha reevaluado el intento.',
      'success',
    );
  } catch (error) {
    setStatus(status, error.message, 'error');
    actionButton.disabled = false;
  }
}

function openAttemptReview(attempt, item, trigger) {
  if (!attempt?.id || !(item instanceof HTMLElement)) return;
  if (confirmResolver) settleConfirm(false);
  if (revokeResolver) settleRevokeReason(null);
  closeAttemptReview({ restoreFocus: false });

  const invalidating = attempt.manual_invalidated !== true;
  const form = createElement('form', {
    className: 'zadmin-ban-form',
    attributes: { novalidate: '', 'data-attempt-review-form': text(attempt.id) },
  });
  const label = document.createElement('label');
  label.append(document.createTextNode('Motivo'));
  const textarea = createElement('textarea', {
    attributes: {
      maxlength: '500',
      rows: '3',
      placeholder: invalidating
        ? 'Describe por qué este tiempo debe dejar de contar.'
        : 'Describe por qué retiras la anulación manual.',
    },
  });
  const status = createElement('p', {
    className: 'zadmin-status',
    attributes: { role: 'status', 'aria-live': 'polite' },
  });
  label.append(textarea, status);

  const cancelButton = createElement('button', {
    className: 'zadmin-inline-button',
    textContent: 'Cancelar',
    attributes: { type: 'button' },
  });
  const actionButton = createElement('button', {
    className: invalidating ? 'zadmin-danger' : 'zadmin-inline-button',
    textContent: invalidating ? 'Invalidar tiempo' : 'Restaurar tiempo',
    attributes: { type: 'submit' },
  });
  cancelButton.addEventListener('click', () => closeAttemptReview());
  form.addEventListener('submit', (event) => submitAttemptReview(event, attempt, form, status, actionButton));
  form.append(label, cancelButton, actionButton);

  attemptReviewReturnFocus = trigger;
  activeAttemptReviewForm = form;
  item.append(form);
  window.requestAnimationFrame(() => textarea.focus());
}

function attemptItem(attempt) {
  const item = createElement('article', { className: 'zadmin-attempt' });
  const header = document.createElement('header');
  const title = document.createElement('div');
  title.append(
    createElement('strong', { textContent: `${text(attempt.nick) || text(attempt.nick_key) || 'Intento'} · ${boundedNumber(attempt.difference_ms)} ms` }),
    createElement('p', { className: 'zadmin-muted', textContent: formatDate(attempt.created_at) }),
  );
  const manualInvalidated = attempt.manual_invalidated === true;
  const stateName = ['eligible', 'watch', 'excluded'].includes(attempt.integrity_status) ? attempt.integrity_status : 'eligible';
  const state = createElement('span', {
    className: 'zadmin-state',
    textContent: manualInvalidated
      ? `manual · ${boundedNumber(attempt.risk_score, 0, 100)}/100`
      : `${stateName} · ${boundedNumber(attempt.risk_score, 0, 100)}/100`,
    attributes: { 'data-state': manualInvalidated ? 'excluded' : stateName },
  });
  header.append(title, state);
  item.append(header);

  const reasons = [...new Set([...(attempt.risk_reasons || []), ...(attempt.verification_reasons || [])].map(text).filter(Boolean))];
  item.append(createElement('p', {
    className: 'zadmin-muted',
    textContent: reasons.length ? `Razones: ${reasons.join(', ')}` : 'Sin razones de riesgo registradas.',
  }));

  if (attempt.manual_action === 'invalidate') {
    item.append(createElement('p', {
      className: 'zadmin-muted',
      textContent: `Invalidación manual: ${text(attempt.manual_action_reason) || '—'} · ${formatDate(attempt.manual_action_at)}. El score técnico se conserva sin alteraciones.`,
    }));
  } else if (attempt.manual_action === 'restore') {
    item.append(createElement('p', {
      className: 'zadmin-muted',
      textContent: `Última revisión manual: restaurado · ${text(attempt.manual_action_reason) || '—'} · ${formatDate(attempt.manual_action_at)}.`,
    }));
  }

  const details = document.createElement('details');
  details.append(createElement('summary', { textContent: 'Evidencia técnica' }));
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify({
    integrityEvidence: attempt.integrity_evidence || {},
    policyVersion: attempt.integrity_policy_version,
    evaluatedAt: attempt.integrity_evaluated_at,
    manualReview: {
      invalidated: manualInvalidated,
      action: attempt.manual_action || null,
      reason: attempt.manual_action_reason || null,
      at: attempt.manual_action_at || null,
    },
    account: attempt.account_id,
    ip: attempt.ip_hash,
    device: attempt.device_hash,
  }, null, 2);
  details.append(pre);
  item.append(details);

  if (attempt.id) {
    const actionButton = createElement('button', {
      className: manualInvalidated ? 'zadmin-inline-button' : 'zadmin-danger',
      textContent: manualInvalidated ? 'Restaurar tiempo' : 'Invalidar tiempo',
      attributes: {
        type: 'button',
        'data-attempt-review-id': text(attempt.id),
        'aria-label': `${manualInvalidated ? 'Restaurar' : 'Invalidar'} tiempo de ${text(attempt.nick) || 'este intento'}: ${boundedNumber(attempt.difference_ms)} ms`,
      },
    });
    actionButton.addEventListener('click', () => openAttemptReview(attempt, item, actionButton));
    item.append(actionButton);
  }
  return item;
}

function renderAttempts(attempts = []) {
  const items = (Array.isArray(attempts) ? attempts : []).map(attemptItem);
  replaceChildren($('#adminAttemptList'), items.length ? items : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay intentos recientes para esta entidad.' })]);
}

function resetDetail() {
  if (confirmResolver) settleConfirm(false);
  if (revokeResolver) settleRevokeReason(null);
  closeAttemptReview({ restoreFocus: false });
  currentTarget = '';
  currentDetail = null;
  $('#adminDetailPlaceholder').hidden = false;
  $('#adminDetailContent').hidden = true;
}

async function loadDetail(scope, target) {
  if (confirmResolver) settleConfirm(false);
  if (revokeResolver) settleRevokeReason(null);
  closeAttemptReview({ restoreFocus: false });
  currentScope = SCOPES.has(scope) ? scope : 'nick';
  currentTarget = text(target);
  setStatus($('#adminOverviewStatus'), `Cargando detalle de ${scopeLabel(currentScope).toLowerCase()}…`);
  try {
    const result = await adminRequest('detail', { scope: currentScope, target: currentTarget });
    currentDetail = result;
    $('#adminDetailPlaceholder').hidden = true;
    $('#adminDetailContent').hidden = false;
    $('#adminDetailHeading').textContent = currentScope === 'nick' ? currentTarget : shortHash(currentTarget);
    $('#adminDetailHeading').title = currentTarget;
    $('#adminDetailMeta').textContent = `${scopeLabel(currentScope)} · ${boundedNumber(result.summary?.attempts)} intentos recientes`;
    const maxRisk = boundedNumber(result.summary?.maxRiskScore, 0, 100);
    $('#adminRiskBadge').textContent = `${maxRisk}/100`;
    $('#adminRiskBadge').dataset.level = riskLevel(maxRisk);
    renderDetailSummary(result.summary);
    renderRiskDistribution(result.distribution);
    renderCorrelations(result.correlations);
    renderEntityBans(result.bans, result.automaticRestrictions);
    renderAttempts(result.attempts);
    setStatus($('#adminBanStatus'));
    setStatus($('#adminOverviewStatus'), 'Detalle actualizado.', 'success');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    $('#adminDetailPanel').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  } catch (error) {
    setStatus($('#adminOverviewStatus'), error.message, 'error');
  }
}

function durationLabel(minutes) {
  if (minutes === null) return 'Para siempre';
  if (minutes === 10_080) return '1 semana';
  const hours = minutes / 60;
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

function populateBanDurations() {
  const options = [];
  for (let hour = 1; hour <= 24; hour += 1) {
    options.push({ value: String(hour * 60), label: durationLabel(hour * 60) });
  }
  options.push({ value: '10080', label: '1 semana' }, { value: 'permanent', label: 'Para siempre' });
  replaceChildren($('#adminBanDuration'), options.map((option) => createElement('option', {
    textContent: option.label,
    attributes: { value: option.value },
  })));
}

async function applyBan(event) {
  event.preventDefault();
  closeAttemptReview({ restoreFocus: false });
  const status = $('#adminBanStatus');
  const reason = $('#adminBanReason').value.trim();
  if (!currentTarget || !currentDetail) {
    setStatus(status, 'Selecciona primero una entidad.', 'error');
    return;
  }
  if (reason.length < 3) {
    setStatus(status, 'Describe el motivo con al menos 3 caracteres.', 'error');
    $('#adminBanReason').focus();
    return;
  }
  const duration = $('#adminBanDuration').value;
  const label = duration === 'permanent' ? 'para siempre' : durationLabel(Number(duration)).toLowerCase();
  const approved = await askAdmin({
    title: 'Aplicar restricción manual',
    message: `Se bloqueará ${scopeLabel(currentScope).toLowerCase()} ${currentScope === 'nick' ? currentTarget : shortHash(currentTarget)} ${label}. Motivo: ${reason}`,
    confirmLabel: 'Aplicar ban',
    cancelLabel: 'Cancelar',
  });
  if (!approved) return;

  $('#adminBanButton').disabled = true;
  setStatus(status, 'Aplicando restricción…');
  try {
    await adminRequest('ban', {
      scope: currentScope,
      target: currentTarget,
      duration: duration === 'permanent' ? 'permanent' : Number(duration),
      reason,
    });
    $('#adminBanReason').value = '';
    await Promise.all([loadDetail(currentScope, currentTarget), loadOverview({ preserveDetail: true })]);
    setStatus(status, 'Ban aplicado y registrado en auditoría.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    $('#adminBanButton').disabled = false;
  }
}

async function revokeBan(banId, anchor) {
  const reason = await requestRevokeReason(anchor);
  if (!reason) return;
  try {
    await adminRequest('revoke-ban', { banId, reason });
    const tasks = [loadBans(), loadOverview({ preserveDetail: true })];
    if (currentTarget) tasks.push(loadDetail(currentScope, currentTarget));
    await Promise.all(tasks);
    setStatus($('#adminBanStatus'), 'Ban revocado y conservado en auditoría.', 'success');
    setStatus($('#adminBansStatus'), 'Ban revocado y conservado en auditoría.', 'success');
  } catch (error) {
    setStatus($('#adminBanStatus'), error.message, 'error');
    setStatus($('#adminBansStatus'), error.message, 'error');
  }
}

async function loadBans() {
  const status = $('#adminBansStatus');
  setStatus(status, 'Cargando restricciones…');
  try {
    const result = await adminRequest('bans');
    const bans = Array.isArray(result.bans) ? result.bans : [];
    replaceChildren($('#adminBansList'), bans.length
      ? bans.map((ban) => banItem(ban, { allowRevoke: !isAutomaticRestriction(ban) }))
      : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay restricciones manuales ni automáticas registradas.' })]);
    setStatus(status, `${bans.length} restricciones cargadas.`, 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

function auditActionLabel(action) {
  if (action === 'revoke') return 'Ban revocado';
  if (action === 'invalidate_attempt') return 'Tiempo invalidado';
  if (action === 'restore_attempt') return 'Tiempo restaurado';
  return 'Ban aplicado';
}

function auditItem(event) {
  const item = createElement('article', { className: 'zadmin-audit-item' });
  const header = document.createElement('header');
  header.append(
    createElement('strong', { textContent: auditActionLabel(event.action) }),
    createElement('span', { className: 'zadmin-state', textContent: scopeLabel(event.target_scope) }),
  );
  item.append(
    header,
    createElement('p', { className: 'zadmin-code', textContent: text(event.target_key) }),
    createElement('p', { className: 'zadmin-muted', textContent: formatDate(event.created_at) }),
  );
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (metadata.reason) item.append(createElement('p', { textContent: `Motivo: ${text(metadata.reason)}` }));
  return item;
}

async function loadAudit() {
  const status = $('#adminAuditStatus');
  setStatus(status, 'Cargando auditoría…');
  try {
    const result = await adminRequest('audit');
    const events = Array.isArray(result.events) ? result.events : [];
    replaceChildren($('#adminAuditList'), events.length
      ? events.map(auditItem)
      : [createElement('p', { className: 'zadmin-muted', textContent: 'Todavía no hay acciones manuales registradas.' })]);
    setStatus(status, `${events.length} eventos cargados.`, 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function login(event) {
  event.preventDefault();
  const status = $('#adminLoginStatus');
  const username = $('#adminUsername').value;
  const password = $('#adminPassword').value;
  if (!username || !password) {
    setStatus(status, 'Introduce usuario y contraseña.', 'error');
    return;
  }
  $('#adminLoginButton').disabled = true;
  setStatus(status, 'Verificando acceso…');
  try {
    const result = await adminRequest('login', { username, password }, { requireSession: false });
    if (!SESSION_TOKEN_PATTERN.test(text(result.token))) throw new Error('La API no devolvió una sesión válida.');
    const expiresAt = Date.parse(text(result.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('La sesión recibida ya ha caducado.');
    sessionToken = text(result.token).toLowerCase();
    persistSessionToken(sessionToken);
    $('#adminPassword').value = '';
    setStatus(status);
    showDashboard();
    startSessionClock();
    await loadOverview();
  } catch (error) {
    const suffix = Number.isFinite(Number(error.attemptsRemaining))
      ? ` Intentos restantes: ${boundedNumber(error.attemptsRemaining, 0, 3)}.`
      : '';
    setStatus(status, `${error.message}${suffix}`, error.code === 'login_rate_limited' ? 'warning' : 'error');
  } finally {
    $('#adminLoginButton').disabled = false;
  }
}

async function logout() {
  $('#adminLogoutButton').disabled = true;
  try {
    if (sessionToken) await adminRequest('logout');
  } catch {
    // Server revocation may fail with the network, but this browser session must still forget the token.
  } finally {
    $('#adminLogoutButton').disabled = false;
    clearSession('Sesión cerrada.');
    $('#adminUsername').focus();
  }
}

async function restoreAdminSession() {
  if (!sessionToken) {
    showLogin();
    return;
  }
  showRestoringSession();
  try {
    await adminRequest('session-status');
    if (!sessionToken) return;
    showDashboard();
    startSessionClock();
    await loadOverview();
  } catch (error) {
    if (sessionToken) {
      showLogin(`No se pudo validar la sesión guardada. ${error.message}`);
    }
  }
}

function setView(name) {
  const target = ['investigation', 'bans', 'audit'].includes(name) ? name : 'investigation';
  if (confirmResolver && target !== 'investigation') settleConfirm(false);
  if (revokeResolver) settleRevokeReason(null);
  closeAttemptReview({ restoreFocus: false });
  for (const button of all('[data-admin-view]')) {
    const active = button.dataset.adminView === target;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const panel of all('[data-admin-panel]')) panel.hidden = panel.dataset.adminPanel !== target;
  if (target === 'bans') loadBans();
  if (target === 'audit') loadAudit();
}

function cancelActionComponent(event) {
  if (event.key !== 'Escape') return;
  if (confirmResolver) {
    event.preventDefault();
    settleConfirm(false);
    return;
  }
  if (revokeResolver) {
    event.preventDefault();
    settleRevokeReason(null);
    return;
  }
  if (activeAttemptReviewForm) {
    event.preventDefault();
    closeAttemptReview();
  }
}

function updateRestrictionLabels() {
  const bansTab = document.querySelector('[data-admin-view="bans"]');
  if (bansTab) bansTab.textContent = 'Restricciones';
  if ($('#adminBansTitle')) $('#adminBansTitle').textContent = 'Historial de restricciones';
  const bansCopy = $('#adminBansView .zadmin-muted');
  if (bansCopy) bansCopy.textContent = 'Los bans manuales son revocables. Las restricciones automáticas del motor de integridad se muestran en modo solo lectura.';
  const detailTitle = $('#adminActiveBansTitle');
  if (detailTitle) detailTitle.textContent = 'Restricciones de esta entidad';
  const loginCopy = $('#adminLoginPanel .zadmin-login-content .zadmin-muted');
  if (loginCopy) loginCopy.textContent = 'La sesión se conserva al recargar esta pestaña y caduca en el servidor tras 12 horas sin actividad.';
}

function bindEvents() {
  $('#adminLoginForm').addEventListener('submit', login);
  $('#adminLogoutButton').addEventListener('click', logout);
  $('#adminRefreshButton').addEventListener('click', loadOverview);
  $('#adminScope').addEventListener('change', loadOverview);
  $('#adminRangeDays').addEventListener('change', loadOverview);
  $('#adminSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadOverview();
  });
  $('#adminBanForm').addEventListener('submit', applyBan);
  $('#adminReloadBans').addEventListener('click', loadBans);
  $('#adminReloadAudit').addEventListener('click', loadAudit);
  $('#adminBanConfirmCancel').addEventListener('click', () => settleConfirm(false));
  $('#adminBanConfirmAccept').addEventListener('click', () => settleConfirm(true));
  $('#adminRevokeCancel').addEventListener('click', () => settleRevokeReason(null));
  $('#adminRevokeForm').addEventListener('submit', submitRevokeReason);
  document.addEventListener('keydown', cancelActionComponent);
  for (const button of all('[data-admin-view]')) button.addEventListener('click', () => setView(button.dataset.adminView));
}

populateBanDurations();
updateRestrictionLabels();
bindEvents();
restoreAdminSession();