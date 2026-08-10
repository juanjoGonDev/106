const config = window.__MINUTO106_CONFIG__ || {};
const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1';
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,80}$/;
const SCOPES = new Set(['account', 'nick', 'ip']);
const RISK_BUCKETS = ['0-19', '20-39', '40-59', '60-79', '80-100'];

let sessionToken = '';
let sessionExpiresAt = 0;
let sessionTimer = null;
let currentScope = 'account';
let currentTarget = '';
let currentDetail = null;

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
  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error('La API devolvió una respuesta no válida.');
  }

  if (!response.ok) {
    if (response.status === 401 && result.code === 'invalid_session') clearSession('La sesión ha caducado. Vuelve a iniciar sesión.');
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

function showLogin(message = '') {
  $('#adminLoginPanel').hidden = false;
  $('#adminDashboard').hidden = true;
  if (message) setStatus($('#adminLoginStatus'), message, 'warning');
}

function showDashboard() {
  $('#adminLoginPanel').hidden = true;
  $('#adminDashboard').hidden = false;
}

function updateSessionClock() {
  if (!sessionToken || !sessionExpiresAt) return;
  const remainingMs = sessionExpiresAt - Date.now();
  if (remainingMs <= 0) {
    clearSession('La sesión ha caducado. Vuelve a iniciar sesión.');
    return;
  }
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  $('#adminSessionStatus').textContent = `Caduca en ${minutes}:${String(seconds).padStart(2, '0')}. El token solo vive en memoria.`;
}

function startSessionClock() {
  if (sessionTimer) window.clearInterval(sessionTimer);
  updateSessionClock();
  sessionTimer = window.setInterval(updateSessionClock, 1_000);
}

function clearSession(message = '') {
  sessionToken = '';
  sessionExpiresAt = 0;
  currentTarget = '';
  currentDetail = null;
  if (sessionTimer) window.clearInterval(sessionTimer);
  sessionTimer = null;
  showLogin(message);
  $('#adminPassword').value = '';
}

function renderSummary(summary = {}) {
  replaceChildren($('#adminSummary'), [
    metric('Intentos', boundedNumber(summary.attempts)),
    metric('Watch', boundedNumber(summary.watchAttempts)),
    metric('Excluidos', boundedNumber(summary.excludedAttempts)),
    metric('Bans manuales activos', boundedNumber(summary.activeManualBans)),
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

async function loadOverview() {
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
    if (currentTarget) resetDetail();
  } catch (error) {
    setStatus(status, error.message, 'error');
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

function banItem(ban, { allowRevoke = true } = {}) {
  const item = createElement('article', { className: 'zadmin-ban-item' });
  const header = document.createElement('header');
  const heading = document.createElement('div');
  heading.append(
    createElement('strong', { textContent: `${scopeLabel(ban.scope)} · ${shortHash(ban.target || banTargetFromRecord(ban))}` }),
    createElement('p', { className: 'zadmin-code', textContent: text(ban.target || banTargetFromRecord(ban)) }),
  );
  const state = createElement('span', {
    className: 'zadmin-state',
    textContent: banStateLabel(ban),
    attributes: { 'data-state': banState(ban) },
  });
  header.append(heading, state);
  item.append(
    header,
    createElement('p', { textContent: text(ban.reason) }),
    createElement('p', { className: 'zadmin-muted', textContent: `Creado: ${formatDate(ban.created_at)} · Expira: ${ban.expires_at ? formatDate(ban.expires_at) : 'Nunca'}` }),
  );
  if (ban.revoked_reason) item.append(createElement('p', { className: 'zadmin-muted', textContent: `Revocación: ${text(ban.revoked_reason)}` }));
  if (allowRevoke && ban.active === true && ban.id) {
    const button = createElement('button', { className: 'zadmin-inline-button', textContent: 'Revocar ban', attributes: { type: 'button' } });
    button.addEventListener('click', () => revokeBan(text(ban.id)));
    item.append(button);
  }
  return item;
}

function banTargetFromRecord(ban) {
  if (ban.scope === 'account') return text(ban.account_id);
  if (ban.scope === 'nick') return text(ban.nick_key);
  return text(ban.ip_hash);
}

function renderEntityBans(bans = []) {
  const items = (Array.isArray(bans) ? bans : []).map((ban) => banItem({ ...ban, target: currentTarget }));
  replaceChildren($('#adminEntityBans'), items.length ? items : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay bans manuales registrados para esta entidad.' })]);
}

function attemptItem(attempt) {
  const item = createElement('article', { className: 'zadmin-attempt' });
  const header = document.createElement('header');
  const title = document.createElement('div');
  title.append(
    createElement('strong', { textContent: `${text(attempt.nick) || text(attempt.nick_key) || 'Intento'} · ${boundedNumber(attempt.difference_ms)} ms` }),
    createElement('p', { className: 'zadmin-muted', textContent: formatDate(attempt.created_at) }),
  );
  const stateName = ['eligible', 'watch', 'excluded'].includes(attempt.integrity_status) ? attempt.integrity_status : 'eligible';
  const state = createElement('span', {
    className: 'zadmin-state',
    textContent: `${stateName} · ${boundedNumber(attempt.risk_score, 0, 100)}/100`,
    attributes: { 'data-state': stateName },
  });
  header.append(title, state);
  item.append(header);

  const reasons = [...new Set([...(attempt.risk_reasons || []), ...(attempt.verification_reasons || [])].map(text).filter(Boolean))];
  item.append(createElement('p', {
    className: 'zadmin-muted',
    textContent: reasons.length ? `Razones: ${reasons.join(', ')}` : 'Sin razones de riesgo registradas.',
  }));

  const details = document.createElement('details');
  details.append(createElement('summary', { textContent: 'Evidencia técnica' }));
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify({
    integrityEvidence: attempt.integrity_evidence || {},
    policyVersion: attempt.integrity_policy_version,
    evaluatedAt: attempt.integrity_evaluated_at,
    account: attempt.account_id,
    ip: attempt.ip_hash,
    device: attempt.device_hash,
  }, null, 2);
  details.append(pre);
  item.append(details);
  return item;
}

function renderAttempts(attempts = []) {
  const items = (Array.isArray(attempts) ? attempts : []).map(attemptItem);
  replaceChildren($('#adminAttemptList'), items.length ? items : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay intentos recientes para esta entidad.' })]);
}

function resetDetail() {
  currentTarget = '';
  currentDetail = null;
  $('#adminDetailPlaceholder').hidden = false;
  $('#adminDetailContent').hidden = true;
}

async function loadDetail(scope, target) {
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
    renderEntityBans(result.bans);
    renderAttempts(result.attempts);
    setStatus($('#adminBanStatus'));
    setStatus($('#adminOverviewStatus'), 'Detalle actualizado.', 'success');
    $('#adminDetailPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  if (!window.confirm(`¿Banear ${scopeLabel(currentScope).toLowerCase()} ${currentScope === 'nick' ? currentTarget : shortHash(currentTarget)} ${label}?\n\nMotivo: ${reason}`)) return;

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
    setStatus(status, 'Ban aplicado y registrado en auditoría.', 'success');
    await Promise.all([loadDetail(currentScope, currentTarget), loadOverview()]);
  } catch (error) {
    setStatus(status, error.message, 'error');
  } finally {
    $('#adminBanButton').disabled = false;
  }
}

async function revokeBan(banId) {
  const reason = window.prompt('Motivo de la revocación (mínimo 3 caracteres):', 'Revisión manual');
  if (reason === null) return;
  const normalized = reason.trim();
  if (normalized.length < 3) {
    setStatus($('#adminBanStatus'), 'El motivo de revocación debe tener al menos 3 caracteres.', 'error');
    return;
  }
  if (!window.confirm('¿Revocar este ban? La acción quedará registrada y el historial no se borrará.')) return;
  try {
    await adminRequest('revoke-ban', { banId, reason: normalized });
    setStatus($('#adminBanStatus'), 'Ban revocado y conservado en auditoría.', 'success');
    const tasks = [loadBans(), loadOverview()];
    if (currentTarget) tasks.push(loadDetail(currentScope, currentTarget));
    await Promise.all(tasks);
  } catch (error) {
    setStatus($('#adminBanStatus'), error.message, 'error');
    setStatus($('#adminBansStatus'), error.message, 'error');
  }
}

async function loadBans() {
  const status = $('#adminBansStatus');
  setStatus(status, 'Cargando bans…');
  try {
    const result = await adminRequest('bans');
    const bans = Array.isArray(result.bans) ? result.bans : [];
    replaceChildren($('#adminBansList'), bans.length
      ? bans.map((ban) => banItem(ban))
      : [createElement('p', { className: 'zadmin-muted', textContent: 'No hay bans manuales registrados.' })]);
    setStatus(status, `${bans.length} registros cargados.`, 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

function auditItem(event) {
  const item = createElement('article', { className: 'zadmin-audit-item' });
  const header = document.createElement('header');
  header.append(
    createElement('strong', { textContent: event.action === 'revoke' ? 'Ban revocado' : 'Ban aplicado' }),
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
    if (!/^[a-f0-9]{64}$/i.test(text(result.token))) throw new Error('La API no devolvió una sesión válida.');
    const expiresAt = Date.parse(text(result.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('La sesión recibida ya ha caducado.');
    sessionToken = text(result.token).toLowerCase();
    sessionExpiresAt = expiresAt;
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
    // Local session teardown remains authoritative for this browser instance.
  } finally {
    $('#adminLogoutButton').disabled = false;
    clearSession('Sesión cerrada.');
    $('#adminUsername').focus();
  }
}

function setView(name) {
  const target = ['investigation', 'bans', 'audit'].includes(name) ? name : 'investigation';
  for (const button of all('[data-admin-view]')) {
    const active = button.dataset.adminView === target;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const panel of all('[data-admin-panel]')) panel.hidden = panel.dataset.adminPanel !== target;
  if (target === 'bans') loadBans();
  if (target === 'audit') loadAudit();
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
  for (const button of all('[data-admin-view]')) button.addEventListener('click', () => setView(button.dataset.adminView));
}

populateBanDurations();
bindEvents();
showLogin();
