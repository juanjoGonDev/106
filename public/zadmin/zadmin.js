const config = window.__MINUTO106_CONFIG__ || {};
const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1';
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,80}$/;
const SCOPES = new Set(['account', 'nick', 'ip']);
const RISK_BUCKETS = ['0-19', '20-39', '40-59', '60-79', '80-100'];
const persistence = window.Minuto106ZadminSessionPersistence;

let sessionToken = String(persistence?.read?.() || '').trim().toLowerCase();
let currentScope = 'account';
let currentTarget = '';
let currentDetail = null;
let confirmResolver = null;
let confirmReturnFocus = null;
let revokeResolver = null;
let revokeReturnFocus = null;
let activeInlineForm = null;
let activeInlineReturnFocus = null;
const pages = {
  entities: { page: 1, pageSize: 25, pagination: null },
  attempts: { page: 1, pageSize: 25, pagination: null },
  bans: { page: 1, pageSize: 25, pagination: null },
  audit: { page: 1, pageSize: 25, pagination: null },
};

function $(selector) { return document.querySelector(selector); }
function all(selector) { return [...document.querySelectorAll(selector)]; }
function text(value) { return String(value ?? ''); }
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
function replaceChildren(element, children = []) { element.replaceChildren(...children.filter(Boolean)); }
function setStatus(element, message = '', tone = '') {
  if (!element) return;
  element.textContent = message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}
function focusIfAvailable(element) { if (element instanceof HTMLElement && element.isConnected) element.focus(); }

function apiUrl() {
  try {
    const base = new URL(text(config.supabaseUrl));
    const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (base.protocol !== 'https:' && !local) return '';
    return `${base.origin}/functions/v1/zadmin-api`;
  } catch { return ''; }
}
function randomDeviceId() {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  return `za-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY) || '';
    if (DEVICE_ID_PATTERN.test(existing)) return existing;
    const generated = randomDeviceId(); localStorage.setItem(DEVICE_STORAGE_KEY, generated); return generated;
  } catch {
    if (!window.__zadminEphemeralDeviceId) window.__zadminEphemeralDeviceId = randomDeviceId();
    return window.__zadminEphemeralDeviceId;
  }
}
async function adminRequest(action, payload = {}, { requireSession = true } = {}) {
  const endpoint = apiUrl();
  if (!endpoint) throw new Error('La API de administración no está configurada.');
  const headers = { 'content-type': 'application/json', 'x-device-id': deviceId() };
  if (requireSession) {
    if (!SESSION_TOKEN_PATTERN.test(sessionToken)) throw new Error('La sesión de administración no está activa.');
    headers.authorization = `Bearer ${sessionToken}`;
  }
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify({ action, ...payload }), cache: 'no-store',
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && result.code === 'invalid_session') clearSession('La sesión ha caducado por inactividad o ha sido revocada. Vuelve a iniciar sesión.');
    const error = new Error(text(result.error) || `La operación falló (${response.status}).`);
    error.code = result.code; error.retryAfterSeconds = result.retryAfterSeconds; error.attemptsRemaining = result.attemptsRemaining;
    throw error;
  }
  return result;
}

function formatDate(value) {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
function shortHash(value) {
  const source = text(value); if (source.length <= 22) return source || '—'; return `${source.slice(0, 10)}…${source.slice(-8)}`;
}
function scopeLabel(scope) {
  if (scope === 'account') return 'Cuenta'; if (scope === 'ip') return 'IP (huella)'; if (scope === 'device') return 'Dispositivo'; if (scope === 'attempt') return 'Intento'; if (scope === 'player') return 'Jugador'; return 'Nick';
}
function riskLevel(score) { const value = boundedNumber(score, 0, 100); return value >= 70 ? 'high' : value >= 35 ? 'medium' : 'low'; }
function metric(label, value) {
  const container = createElement('div', { className: 'zadmin-metric' });
  container.append(createElement('strong', { textContent: text(value) }), createElement('span', { textContent: label }));
  return container;
}

function removeRestorePanel() { $('#adminSessionRestore')?.remove(); }
function showRestoringSession() {
  $('#adminLoginPanel').hidden = true; $('#adminDashboard').hidden = true;
  if ($('#adminSessionRestore')) return;
  const stage = createElement('section', { className: 'zadmin-login-stage', attributes: { id: 'adminSessionRestore', 'aria-live': 'polite', 'aria-busy': 'true' } });
  const card = createElement('div', { className: 'zadmin-card zadmin-login-card' });
  card.append(createElement('p', { className: 'eyebrow', textContent: 'ADMINISTRACIÓN PRIVADA' }), createElement('h1', { textContent: 'Comprobando sesión' }), createElement('p', { className: 'zadmin-muted', textContent: 'Validando el acceso persistido con el servidor…' }));
  stage.append(card); $('.zadmin-shell').prepend(stage);
}
function showLogin(message = '') { removeRestorePanel(); $('#adminLoginPanel').hidden = false; $('#adminDashboard').hidden = true; if (message) setStatus($('#adminLoginStatus'), message, 'warning'); }
function showDashboard() { removeRestorePanel(); $('#adminLoginPanel').hidden = true; $('#adminDashboard').hidden = false; }
function startSessionClock() { $('#adminSessionStatus').textContent = 'Sesión activa y persistida en este navegador. Cada operación se revalida y el servidor la cierra tras 12 h sin actividad.'; }
function clearSession(message = '') {
  settleConfirm(false); settleRevokeReason(null); closeInlineForm({ restoreFocus: false });
  sessionToken = ''; persistence?.clear?.(); currentTarget = ''; currentDetail = null; showLogin(message); $('#adminPassword').value = '';
}

function settleConfirm(accepted) {
  if (!confirmResolver) return;
  const resolve = confirmResolver; const returnFocus = confirmReturnFocus;
  confirmResolver = null; confirmReturnFocus = null; $('#adminBanConfirmComponent').hidden = true; focusIfAvailable(returnFocus); resolve(accepted === true);
}
function askAdmin({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
  if (confirmResolver) return Promise.resolve(false);
  closeInlineForm({ restoreFocus: false });
  $('#adminBanConfirmTitle').textContent = title; $('#adminBanConfirmMessage').textContent = message;
  $('#adminBanConfirmAccept').textContent = confirmLabel; $('#adminBanConfirmCancel').textContent = cancelLabel;
  confirmReturnFocus = document.activeElement; $('#adminBanConfirmComponent').hidden = false;
  window.requestAnimationFrame(() => $('#adminBanConfirmCancel').focus());
  return new Promise((resolve) => { confirmResolver = resolve; });
}
function settleRevokeReason(value) {
  if (!revokeResolver) return;
  const resolve = revokeResolver; const returnFocus = revokeReturnFocus; revokeResolver = null; revokeReturnFocus = null;
  const component = $('#adminRevokeComponent'); component.hidden = true; $('#adminActionComponentHost').append(component); focusIfAvailable(returnFocus); resolve(value);
}
function requestRevokeReason(anchor) {
  if (revokeResolver) return Promise.resolve(null);
  closeInlineForm({ restoreFocus: false }); $('#adminRevokeReason').value = ''; setStatus($('#adminRevokeStatus'));
  revokeReturnFocus = document.activeElement; const component = $('#adminRevokeComponent'); (anchor instanceof HTMLElement ? anchor : $('#adminBansView')).append(component); component.hidden = false;
  window.requestAnimationFrame(() => $('#adminRevokeReason').focus()); return new Promise((resolve) => { revokeResolver = resolve; });
}
function submitRevokeReason(event) {
  event.preventDefault(); const reason = $('#adminRevokeReason').value.trim();
  if (reason.length < 3) { setStatus($('#adminRevokeStatus'), 'El motivo debe tener al menos 3 caracteres.', 'error'); $('#adminRevokeReason').focus(); return; }
  settleRevokeReason(reason);
}
function closeInlineForm({ restoreFocus = true } = {}) {
  if (!(activeInlineForm instanceof HTMLElement)) return;
  const returnFocus = activeInlineReturnFocus; activeInlineForm.remove(); activeInlineForm = null; activeInlineReturnFocus = null;
  if (restoreFocus) focusIfAvailable(returnFocus);
}

function renderSummary(summary = {}) {
  replaceChildren($('#adminSummary'), [metric('Intentos', boundedNumber(summary.attempts)), metric('Watch', boundedNumber(summary.watchAttempts)), metric('Excluidos', boundedNumber(summary.excludedAttempts)), metric('Bans manuales activos', boundedNumber(summary.activeManualBans)), metric('Restricciones automáticas', boundedNumber(summary.activeAutomaticRestrictions)), metric('Cuentas', boundedNumber(summary.distinctAccounts)), metric('Nicks', boundedNumber(summary.distinctNicks)), metric('Huellas IP', boundedNumber(summary.distinctIps)), metric('Verificados', boundedNumber(summary.verifiedAttempts))]);
}
function entityLabel(entity) { return currentScope === 'nick' ? text(entity.label) || text(entity.key) : shortHash(entity.key); }
function renderEntities(entities = []) {
  const rows = (Array.isArray(entities) ? entities : []).map((entity) => {
    const row = document.createElement('tr');
    const label = createElement('td', { textContent: entityLabel(entity) }); label.title = text(entity.key);
    const action = document.createElement('td'); const button = createElement('button', { className: 'zadmin-review-button', textContent: 'Revisar', attributes: { type: 'button', 'aria-label': `Revisar ${scopeLabel(currentScope)} ${entityLabel(entity)}` } });
    button.addEventListener('click', () => { pages.attempts.page = 1; loadDetail(currentScope, text(entity.key)); }); action.append(button);
    row.append(label, createElement('td', { textContent: text(boundedNumber(entity.attempts)) }), createElement('td', { textContent: `${boundedNumber(entity.maxRiskScore, 0, 100)} / 100` }), createElement('td', { textContent: text(boundedNumber(entity.watchAttempts)) }), createElement('td', { textContent: text(boundedNumber(entity.excludedAttempts)) }), action);
    return row;
  });
  replaceChildren($('#adminEntityRows'), rows); $('#adminEntitiesEmpty').hidden = rows.length > 0;
}

function renderPagination(kind, metadata) {
  const state = pages[kind]; state.pagination = metadata || state.pagination;
  const data = state.pagination || { page: state.page, pageSize: state.pageSize, total: 0, totalPages: 0, hasPrevious: false, hasNext: false };
  state.page = Number(data.page) || 1; state.pageSize = Number(data.pageSize) || state.pageSize;
  const names = { entities: 'adminEntities', attempts: 'adminAttempts', bans: 'adminBans', audit: 'adminAudit' };
  const prefix = names[kind];
  $(`#${prefix}Previous`).disabled = data.hasPrevious !== true; $(`#${prefix}Next`).disabled = data.hasNext !== true; $(`#${prefix}PageSize`).value = String(state.pageSize);
  $(`#${prefix}PageStatus`).textContent = data.totalPages ? `Página ${data.page} de ${data.totalPages} · ${data.total} resultados` : 'Sin resultados';
}

async function loadOverview({ preserveDetail = false } = {}) {
  const status = $('#adminOverviewStatus'); setStatus(status, 'Cargando actividad…'); $('#adminRefreshButton').disabled = true;
  try {
    currentScope = SCOPES.has($('#adminScope').value) ? $('#adminScope').value : 'account';
    const state = pages.entities;
    const result = await adminRequest('overview', { scope: currentScope, rangeDays: Number($('#adminRangeDays').value), search: $('#adminSearch').value, entitiesPage: state.page, entitiesPageSize: state.pageSize });
    renderSummary(result.summary); renderEntities(result.entities); renderPagination('entities', result.pagination);
    const note = result.truncated ? 'Análisis agregado limitado a los 2.000 intentos más recientes del periodo; la lista visible está paginada.' : `${boundedNumber(result.summary?.attempts)} intentos analizados.`;
    setStatus(status, note, result.truncated ? 'warning' : 'success');
    if (currentTarget && !preserveDetail) resetDetail(); return true;
  } catch (error) { setStatus(status, error.message, 'error'); return false; }
  finally { $('#adminRefreshButton').disabled = false; }
}

function renderDetailSummary(summary = {}) {
  replaceChildren($('#adminDetailSummary'), [metric('Intentos', boundedNumber(summary.attempts)), metric('Riesgo máximo', `${boundedNumber(summary.maxRiskScore, 0, 100)} / 100`), metric('Watch', boundedNumber(summary.watchAttempts)), metric('Excluidos', boundedNumber(summary.excludedAttempts)), metric('Nicks asociados', boundedNumber(summary.distinctNicks)), metric('Cuentas asociadas', boundedNumber(summary.distinctAccounts)), metric('IP asociadas', boundedNumber(summary.distinctIps)), metric('Dispositivos', boundedNumber(summary.distinctDevices))]);
}
function renderRiskDistribution(distribution = {}) {
  const total = RISK_BUCKETS.reduce((sum, bucket) => sum + boundedNumber(distribution[bucket]), 0);
  replaceChildren($('#adminRiskDistribution'), RISK_BUCKETS.map((bucket) => {
    const count = boundedNumber(distribution[bucket]); const percent = total ? Math.round((count / total) * 100) : 0; const row = createElement('div', { className: 'zadmin-risk-row' });
    const track = createElement('div', { className: 'zadmin-risk-track', attributes: { role: 'img', 'aria-label': `${bucket}: ${count} intentos, ${percent}%` } });
    const fill = createElement('div', { className: 'zadmin-risk-fill' }); fill.style.setProperty('--risk-width', `${boundedNumber(percent, 0, 100)}%`); track.append(fill); row.append(createElement('span', { textContent: bucket }), track, createElement('span', { textContent: text(count) })); return row;
  }));
}
function correlationGroup(label, values) {
  const section = createElement('div', { className: 'zadmin-correlation-group' }); section.append(createElement('strong', { textContent: label })); const list = createElement('div', { className: 'zadmin-chip-list' });
  for (const value of Array.isArray(values) && values.length ? values : ['—']) { const chip = createElement('span', { className: 'zadmin-chip', textContent: shortHash(value) }); chip.title = text(value); list.append(chip); }
  section.append(list); return section;
}
function renderCorrelations(correlations = {}) { replaceChildren($('#adminCorrelations'), [correlationGroup('Cuentas', correlations.accounts), correlationGroup('Nicks', correlations.nicks), correlationGroup('Huellas IP', correlations.ips), correlationGroup('Dispositivos', correlations.devices)]); }

function isAutomaticRestriction(ban) { return ban.source === 'integrity' || ban.restriction_kind === 'integrity'; }
function restrictionStatus(ban) {
  if (ban.status) return ban.status; if (ban.revoked_at) return 'revoked'; if (ban.active === true) return 'active'; return 'expired';
}
function restrictionStatusLabel(status) { return status === 'active' ? 'Activo' : status === 'lifted' ? 'Levantado' : status === 'revoked' ? 'Revocado' : 'Caducado'; }
function attemptReviewActionLabel(action) { return action === 'invalidate' ? 'Invalidación manual' : action === 'restore' ? 'Restauración manual' : text(action) || 'Revisión manual'; }
function banTargetFromRecord(ban) { if (ban.target) return text(ban.target); if (ban.scope === 'account') return text(ban.account_id); if (ban.scope === 'nick') return text(ban.nick_key); if (ban.scope === 'device') return text(ban.device_hash); return text(ban.ip_hash); }

function openAutomaticAction(ban, item, trigger) {
  closeInlineForm({ restoreFocus: false }); activeInlineReturnFocus = trigger;
  const statusName = restrictionStatus(ban); const lifting = statusName === 'active'; const action = lifting ? 'lift-integrity-restriction' : 'reinstate-integrity-restriction';
  const form = createElement('form', { className: 'zadmin-ban-form', attributes: { novalidate: '' } });
  const label = createElement('label', { textContent: 'Motivo' }); const textarea = createElement('textarea', { attributes: { rows: '3', minlength: '3', maxlength: '500', required: '', placeholder: lifting ? 'Explica por qué se levanta esta restricción automática.' : 'Explica por qué se restaura la restricción.' } }); label.append(textarea);
  const status = createElement('p', { className: 'zadmin-status', attributes: { role: 'status', 'aria-live': 'polite' } }); const cancel = createElement('button', { className: 'ghost', textContent: 'Cancelar', attributes: { type: 'button' } }); const submit = createElement('button', { className: lifting ? 'zadmin-danger' : 'secondary', textContent: lifting ? 'Quitar restricción' : 'Restaurar restricción', attributes: { type: 'submit' } });
  cancel.addEventListener('click', () => closeInlineForm()); form.addEventListener('submit', async (event) => {
    event.preventDefault(); const reason = textarea.value.trim(); if (reason.length < 3) { setStatus(status, 'El motivo debe tener al menos 3 caracteres.', 'error'); textarea.focus(); return; }
    submit.disabled = true; setStatus(status, 'Guardando…');
    try { await adminRequest(action, { banId: Number(ban.id), reason }); closeInlineForm({ restoreFocus: false }); const tasks = [loadBans(), loadOverview({ preserveDetail: true })]; if (currentTarget) tasks.push(loadDetail(currentScope, currentTarget)); await Promise.all(tasks); setStatus($('#adminBansStatus'), lifting ? 'Restricción automática levantada.' : 'Restricción automática restaurada.', 'success'); }
    catch (error) { setStatus(status, error.message, 'error'); submit.disabled = false; }
  });
  form.append(label, status, cancel, submit); activeInlineForm = form; item.append(form); window.requestAnimationFrame(() => textarea.focus());
}

function banItem(ban, { allowRevoke = true } = {}) {
  const automatic = isAutomaticRestriction(ban); const item = createElement('article', { className: 'zadmin-ban-item' }); const target = banTargetFromRecord(ban); const statusName = restrictionStatus(ban);
  const header = document.createElement('header'); const heading = document.createElement('div'); heading.append(createElement('strong', { textContent: `${scopeLabel(ban.scope)} · ${shortHash(target)}` }), createElement('p', { className: 'zadmin-code', textContent: target }));
  header.append(heading, createElement('span', { className: 'zadmin-state', textContent: `${automatic ? 'Automático · ' : ''}${restrictionStatusLabel(statusName)}`, attributes: { 'data-state': statusName === 'lifted' ? 'eligible' : statusName } })); item.append(header, createElement('p', { textContent: text(ban.reason) }), createElement('p', { className: 'zadmin-muted', textContent: `${automatic ? 'Detectado' : 'Creado'}: ${formatDate(ban.triggered_at || ban.created_at)} · Expira: ${ban.expires_at ? formatDate(ban.expires_at) : 'Nunca'}` }));
  if (automatic) {
    item.append(createElement('p', { className: 'zadmin-muted', textContent: `Política v${boundedNumber(ban.policy_version, 0)} · Intento origen: ${shortHash(ban.source_attempt_id)}` }));
    if (ban.adminAction?.action) item.append(createElement('p', { className: 'zadmin-muted', textContent: `Última acción admin: ${text(ban.adminAction.action)} · ${formatDate(ban.adminAction.created_at)} · ${text(ban.adminAction.reason)}` }));
    const details = document.createElement('details'); details.append(createElement('summary', { textContent: 'Evidencia de la restricción automática' })); const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ policyVersion: ban.policy_version, sourceAttemptId: ban.source_attempt_id, evidence: ban.evidence || {} }, null, 2); details.append(pre); item.append(details);
    if (statusName === 'active' || (statusName === 'lifted' && Date.parse(text(ban.expires_at)) > Date.now())) { const button = createElement('button', { className: statusName === 'active' ? 'zadmin-danger' : 'zadmin-inline-button', textContent: statusName === 'active' ? 'Quitar restricción' : 'Restaurar restricción', attributes: { type: 'button' } }); button.addEventListener('click', () => openAutomaticAction(ban, item, button)); item.append(button); }
  } else if (ban.revoked_reason) item.append(createElement('p', { className: 'zadmin-muted', textContent: `Revocación: ${text(ban.revoked_reason)}` }));
  if (!automatic && allowRevoke && statusName === 'active' && ban.id) { const button = createElement('button', { className: 'zadmin-inline-button', textContent: 'Revocar ban', attributes: { type: 'button' } }); button.addEventListener('click', () => revokeBan(text(ban.id), item)); item.append(button); }
  return item;
}
function renderEntityBans(bans = [], automaticRestrictions = []) {
  const manual = (Array.isArray(bans) ? bans : []).map((ban) => banItem(ban)); const automatic = (Array.isArray(automaticRestrictions) ? automaticRestrictions : []).map((ban) => banItem(ban)); const items = [];
  if (manual.length) items.push(createElement('p', { className: 'eyebrow', textContent: 'MANUALES' }), ...manual); if (automatic.length) items.push(createElement('p', { className: 'eyebrow', textContent: 'AUTOMÁTICAS' }), ...automatic);
  replaceChildren($('#adminEntityBans'), items.length ? items : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay restricciones manuales ni automáticas registradas para esta entidad.' })]);
}

function attemptItem(attempt) {
  const item = createElement('article', { className: 'zadmin-attempt' }); const header = document.createElement('header'); const title = document.createElement('div');
  title.append(createElement('strong', { textContent: `${text(attempt.nick) || text(attempt.nick_key) || 'Intento'} · ${boundedNumber(attempt.difference_ms)} ms` }), createElement('p', { className: 'zadmin-muted', textContent: formatDate(attempt.created_at) }));
  const invalidated = attempt.manual_invalidated === true; const stateName = ['eligible', 'watch', 'excluded'].includes(attempt.integrity_status) ? attempt.integrity_status : 'eligible';
  header.append(title, createElement('span', { className: 'zadmin-state', textContent: invalidated ? `manual · ${boundedNumber(attempt.risk_score, 0, 100)}/100` : `${stateName} · ${boundedNumber(attempt.risk_score, 0, 100)}/100`, attributes: { 'data-state': invalidated ? 'excluded' : stateName } })); item.append(header);
  const reasons = [...new Set([...(attempt.risk_reasons || []), ...(attempt.verification_reasons || [])].map(text).filter(Boolean))]; item.append(createElement('p', { className: 'zadmin-muted', textContent: reasons.length ? `Razones: ${reasons.join(', ')}` : 'Sin razones de riesgo registradas.' }));
  if (attempt.manual_action) item.append(createElement('p', { className: 'zadmin-muted', textContent: `Última revisión manual: ${attemptReviewActionLabel(attempt.manual_action)} · ${text(attempt.manual_action_reason) || '—'} · ${formatDate(attempt.manual_action_at)}.` }));
  const details = document.createElement('details'); details.append(createElement('summary', { textContent: 'Evidencia técnica' })); const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ integrityEvidence: attempt.integrity_evidence || {}, policyVersion: attempt.integrity_policy_version, evaluatedAt: attempt.integrity_evaluated_at, account: attempt.account_id, ip: attempt.ip_hash, device: attempt.device_hash }, null, 2); details.append(pre); item.append(details);
  if (attempt.id) { const button = createElement('button', { className: invalidated ? 'zadmin-inline-button' : 'zadmin-danger', textContent: invalidated ? 'Restaurar tiempo' : 'Invalidar tiempo', attributes: { type: 'button', 'data-attempt-review-id': text(attempt.id) } }); button.addEventListener('click', () => openAttemptReview(attempt, item, button)); item.append(button); }
  return item;
}
function openAttemptReview(attempt, item, trigger) {
  closeInlineForm({ restoreFocus: false }); activeInlineReturnFocus = trigger; const invalidating = attempt.manual_invalidated !== true;
  const form = createElement('form', { className: 'zadmin-ban-form', attributes: { novalidate: '' } }); const label = createElement('label', { textContent: 'Motivo' }); const textarea = createElement('textarea', { attributes: { maxlength: '500', rows: '3', placeholder: invalidating ? 'Describe por qué este tiempo debe dejar de contar.' : 'Describe por qué retiras la anulación manual.' } }); label.append(textarea); const status = createElement('p', { className: 'zadmin-status', attributes: { role: 'status', 'aria-live': 'polite' } }); const cancel = createElement('button', { className: 'zadmin-inline-button', textContent: 'Cancelar', attributes: { type: 'button' } }); const action = createElement('button', { className: invalidating ? 'zadmin-danger' : 'zadmin-inline-button', textContent: invalidating ? 'Invalidar tiempo' : 'Restaurar tiempo', attributes: { type: 'submit' } });
  cancel.addEventListener('click', () => closeInlineForm()); form.addEventListener('submit', async (event) => { event.preventDefault(); const reason = textarea.value.trim(); if (reason.length < 3) { setStatus(status, 'El motivo debe tener al menos 3 caracteres.', 'error'); textarea.focus(); return; } action.disabled = true; try { await adminRequest(invalidating ? 'invalidate-attempt' : 'restore-attempt', { attemptId: attempt.id, reason }); closeInlineForm({ restoreFocus: false }); await Promise.all([loadDetail(currentScope, currentTarget), loadOverview({ preserveDetail: true })]); } catch (error) { setStatus(status, error.message, 'error'); action.disabled = false; } }); form.append(label, status, cancel, action); activeInlineForm = form; item.append(form); window.requestAnimationFrame(() => textarea.focus());
}
function renderAttempts(attempts = []) { const items = (Array.isArray(attempts) ? attempts : []).map(attemptItem); replaceChildren($('#adminAttemptList'), items.length ? items : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay intentos recientes para esta entidad.' })]); }

function resetDetail() { closeInlineForm({ restoreFocus: false }); currentTarget = ''; currentDetail = null; $('#adminDetailPlaceholder').hidden = false; $('#adminDetailContent').hidden = true; }
async function loadDetail(scope, target) {
  closeInlineForm({ restoreFocus: false }); currentScope = SCOPES.has(scope) ? scope : 'nick'; currentTarget = text(target); setStatus($('#adminOverviewStatus'), `Cargando detalle de ${scopeLabel(currentScope).toLowerCase()}…`);
  try {
    const state = pages.attempts; const result = await adminRequest('detail', { scope: currentScope, target: currentTarget, attemptsPage: state.page, attemptsPageSize: state.pageSize }); currentDetail = result;
    $('#adminDetailPlaceholder').hidden = true; $('#adminDetailContent').hidden = false; $('#adminDetailHeading').textContent = currentScope === 'nick' ? currentTarget : shortHash(currentTarget); $('#adminDetailHeading').title = currentTarget; $('#adminDetailMeta').textContent = `${scopeLabel(currentScope)} · ${boundedNumber(result.summary?.attempts)} intentos`;
    const maxRisk = boundedNumber(result.summary?.maxRiskScore, 0, 100); $('#adminRiskBadge').textContent = `${maxRisk}/100`; $('#adminRiskBadge').dataset.level = riskLevel(maxRisk);
    renderDetailSummary(result.summary); renderRiskDistribution(result.distribution); renderCorrelations(result.correlations); renderEntityBans(result.bans, result.automaticRestrictions); renderAttempts(result.attempts); renderPagination('attempts', result.attemptPagination); setStatus($('#adminBanStatus')); setStatus($('#adminOverviewStatus'), 'Detalle actualizado.', 'success');
  } catch (error) { setStatus($('#adminOverviewStatus'), error.message, 'error'); }
}

function durationLabel(minutes) { if (minutes === null) return 'Para siempre'; if (minutes === 10_080) return '1 semana'; const hours = minutes / 60; return hours === 1 ? '1 hora' : `${hours} horas`; }
function populateBanDurations() { const options = []; for (let hour = 1; hour <= 24; hour += 1) options.push({ value: String(hour * 60), label: durationLabel(hour * 60) }); options.push({ value: '10080', label: '1 semana' }, { value: 'permanent', label: 'Para siempre' }); replaceChildren($('#adminBanDuration'), options.map((option) => createElement('option', { textContent: option.label, attributes: { value: option.value } }))); }
async function applyBan(event) {
  event.preventDefault(); const status = $('#adminBanStatus'); const reason = $('#adminBanReason').value.trim(); if (!currentTarget || !currentDetail) { setStatus(status, 'Selecciona primero una entidad.', 'error'); return; } if (reason.length < 3) { setStatus(status, 'Describe el motivo con al menos 3 caracteres.', 'error'); $('#adminBanReason').focus(); return; }
  const duration = $('#adminBanDuration').value; const label = duration === 'permanent' ? 'para siempre' : durationLabel(Number(duration)).toLowerCase(); const approved = await askAdmin({ title: 'Aplicar restricción manual', message: `Se bloqueará ${scopeLabel(currentScope).toLowerCase()} ${currentScope === 'nick' ? currentTarget : shortHash(currentTarget)} ${label}. Motivo: ${reason}`, confirmLabel: 'Aplicar ban', cancelLabel: 'Cancelar' }); if (!approved) return;
  $('#adminBanButton').disabled = true; try { await adminRequest('ban', { scope: currentScope, target: currentTarget, duration: duration === 'permanent' ? 'permanent' : Number(duration), reason }); $('#adminBanReason').value = ''; await Promise.all([loadDetail(currentScope, currentTarget), loadOverview({ preserveDetail: true })]); setStatus(status, 'Ban aplicado y registrado en auditoría.', 'success'); } catch (error) { setStatus(status, error.message, 'error'); } finally { $('#adminBanButton').disabled = false; }
}
async function revokeBan(banId, anchor) {
  const reason = await requestRevokeReason(anchor); if (!reason) return;
  try { await adminRequest('revoke-ban', { banId, reason }); await Promise.all([loadBans(), loadOverview({ preserveDetail: true }), currentTarget ? loadDetail(currentScope, currentTarget) : Promise.resolve()]); setStatus($('#adminBansStatus'), 'Ban revocado y conservado en auditoría.', 'success'); } catch (error) { setStatus($('#adminBansStatus'), error.message, 'error'); }
}
async function loadBans() {
  const status = $('#adminBansStatus'); setStatus(status, 'Cargando restricciones…');
  try { const state = pages.bans; const result = await adminRequest('bans', { bansPage: state.page, bansPageSize: state.pageSize }); const bans = Array.isArray(result.bans) ? result.bans : []; replaceChildren($('#adminBansList'), bans.length ? bans.map((ban) => banItem(ban)) : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay restricciones registradas.' })]); renderPagination('bans', result.pagination); setStatus(status, `${result.pagination?.total ?? bans.length} restricciones registradas.`, 'success'); } catch (error) { setStatus(status, error.message, 'error'); }
}
function auditActionLabel(action) {
  const labels = { ban: 'Ban aplicado', revoke: 'Ban revocado', invalidate_attempt: 'Tiempo invalidado', restore_attempt: 'Tiempo restaurado', lift_integrity: 'Restricción automática levantada', reinstate_integrity: 'Restricción automática restaurada', rename_nick: 'Nick renombrado', require_nick_change: 'Cambio de nick requerido' }; return labels[action] || text(action) || 'Acción';
}
function auditItem(event) {
  const item = createElement('article', { className: 'zadmin-audit-item' }); const header = document.createElement('header'); header.append(createElement('strong', { textContent: auditActionLabel(event.action) }), createElement('span', { className: 'zadmin-muted', textContent: formatDate(event.created_at) })); item.append(header, createElement('p', { textContent: `${scopeLabel(event.target_scope)} · ${shortHash(event.target_key)}` })); const details = document.createElement('details'); details.append(createElement('summary', { textContent: 'Metadatos' })); const pre = document.createElement('pre'); pre.textContent = JSON.stringify(event.metadata || {}, null, 2); details.append(pre); item.append(details); return item;
}
async function loadAudit() {
  const status = $('#adminAuditStatus'); setStatus(status, 'Cargando auditoría…');
  try { const state = pages.audit; const result = await adminRequest('audit', { auditPage: state.page, auditPageSize: state.pageSize }); const events = Array.isArray(result.events) ? result.events : []; replaceChildren($('#adminAuditList'), events.length ? events.map(auditItem) : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay eventos de auditoría.' })]); renderPagination('audit', result.pagination); setStatus(status, `${result.pagination?.total ?? events.length} eventos registrados.`, 'success'); } catch (error) { setStatus(status, error.message, 'error'); }
}

async function login(event) {
  event.preventDefault(); const status = $('#adminLoginStatus'); const username = $('#adminUsername').value.trim(); const password = $('#adminPassword').value; if (!username || !password) { setStatus(status, 'Introduce usuario y contraseña.', 'error'); return; }
  $('#adminLoginButton').disabled = true; setStatus(status, 'Comprobando acceso…');
  try {
    const result = await adminRequest('login', { username, password }, { requireSession: false });
    if (!SESSION_TOKEN_PATTERN.test(text(result.token))) throw new Error('La API no devolvió una sesión válida.');
    sessionToken = text(result.token).toLowerCase();
    const persisted = persistence?.store?.(sessionToken) === true;
    $('#adminPassword').value = '';
    setStatus(status, persisted ? '' : 'Sesión iniciada. Este navegador no permite conservarla después de cerrarlo.', persisted ? '' : 'warning');
    showDashboard(); startSessionClock(); await loadOverview();
  } catch (error) {
    const suffix = Number.isFinite(Number(error.attemptsRemaining)) ? ` Intentos restantes: ${boundedNumber(error.attemptsRemaining, 0, 3)}.` : '';
    setStatus(status, `${error.message}${suffix}`, error.code === 'login_rate_limited' ? 'warning' : 'error');
  } finally { $('#adminLoginButton').disabled = false; }
}
async function logout() {
  $('#adminLogoutButton').disabled = true;
  try {
    if (sessionToken) await adminRequest('logout');
  } catch (error) {
    setStatus($('#adminSessionStatus'), `No se pudo confirmar la revocación remota: ${error.message}`, 'warning');
  } finally {
    $('#adminLogoutButton').disabled = false; clearSession('Sesión cerrada.'); $('#adminUsername').focus();
  }
}
async function restoreAdminSession() {
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) { showLogin(); return; }
  showRestoringSession(); try { await adminRequest('session-status'); if (!sessionToken) return; showDashboard(); startSessionClock(); await loadOverview(); } catch (error) { if (sessionToken) showLogin(`No se pudo validar la sesión guardada. ${error.message}`); }
}
function setView(name) {
  const target = ['investigation', 'bans', 'audit'].includes(name) ? name : 'investigation'; settleConfirm(false); settleRevokeReason(null); closeInlineForm({ restoreFocus: false });
  for (const button of all('[data-admin-view]')) { const active = button.dataset.adminView === target; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }
  for (const panel of all('[data-admin-panel]')) panel.hidden = panel.dataset.adminPanel !== target; if (target === 'bans') loadBans(); if (target === 'audit') loadAudit();
}
function cancelActionComponent(event) { if (event.key !== 'Escape') return; if (confirmResolver) { event.preventDefault(); settleConfirm(false); } else if (revokeResolver) { event.preventDefault(); settleRevokeReason(null); } else if (activeInlineForm) { event.preventDefault(); closeInlineForm(); } }
function resetAndLoad(kind, loader) { pages[kind].page = 1; loader(); }
function bindPagination(kind, loader) {
  const names = { entities: 'adminEntities', attempts: 'adminAttempts', bans: 'adminBans', audit: 'adminAudit' }; const prefix = names[kind];
  $(`#${prefix}Previous`).addEventListener('click', () => { pages[kind].page = Math.max(1, pages[kind].page - 1); loader(); });
  $(`#${prefix}Next`).addEventListener('click', () => { pages[kind].page += 1; loader(); });
  $(`#${prefix}PageSize`).addEventListener('change', (event) => { pages[kind].pageSize = Number(event.target.value) || 25; pages[kind].page = 1; loader(); });
}
function bindEvents() {
  $('#adminLoginForm').addEventListener('submit', login); $('#adminLogoutButton').addEventListener('click', logout); $('#adminRefreshButton').addEventListener('click', () => resetAndLoad('entities', loadOverview));
  $('#adminScope').addEventListener('change', () => resetAndLoad('entities', loadOverview)); $('#adminRangeDays').addEventListener('change', () => resetAndLoad('entities', loadOverview)); $('#adminSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); resetAndLoad('entities', loadOverview); } });
  $('#adminBanForm').addEventListener('submit', applyBan); $('#adminReloadBans').addEventListener('click', loadBans); $('#adminReloadAudit').addEventListener('click', loadAudit); $('#adminBanConfirmCancel').addEventListener('click', () => settleConfirm(false)); $('#adminBanConfirmAccept').addEventListener('click', () => settleConfirm(true)); $('#adminRevokeCancel').addEventListener('click', () => settleRevokeReason(null)); $('#adminRevokeForm').addEventListener('submit', submitRevokeReason); document.addEventListener('keydown', cancelActionComponent);
  for (const button of all('[data-admin-view]')) button.addEventListener('click', () => setView(button.dataset.adminView));
  bindPagination('entities', () => loadOverview({ preserveDetail: true })); bindPagination('attempts', () => currentTarget && loadDetail(currentScope, currentTarget)); bindPagination('bans', loadBans); bindPagination('audit', loadAudit);
}

populateBanDurations(); bindEvents(); restoreAdminSession();