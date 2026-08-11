const SOURCES = new Set(['manual', 'integrity']);
const SCOPES = new Set(['account', 'nick', 'device', 'ip']);

function finiteTimestamp(value) {
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizePlayRestriction(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || value.active !== true) return null;
  const source = SOURCES.has(String(value.source)) ? String(value.source) : 'integrity';
  const scope = SCOPES.has(String(value.scope)) ? String(value.scope) : 'account';
  const permanent = value.permanent === true || value.expiresAt == null;
  const expiresAtMs = permanent ? null : finiteTimestamp(value.expiresAt);
  if (!permanent && (expiresAtMs === null || expiresAtMs <= now)) return null;
  return Object.freeze({
    active: true,
    source,
    scope,
    permanent,
    expiresAt: permanent ? null : new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    retryAfterSeconds: permanent
      ? null
      : Math.max(1, Math.ceil((expiresAtMs - now) / 1000)),
  });
}

export function restrictionRemainingSeconds(restriction, now = Date.now()) {
  if (!restriction?.active || restriction.permanent || !Number.isFinite(restriction.expiresAtMs)) return null;
  return Math.max(0, Math.ceil((restriction.expiresAtMs - now) / 1000));
}

export function formatRestrictionCountdown(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const clock = [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
  return days > 0 ? `${days} d ${clock}` : clock;
}

export function restrictionScopeLabel(scope) {
  if (scope === 'nick') return 'nick';
  if (scope === 'device') return 'dispositivo';
  if (scope === 'ip') return 'conexión';
  return 'cuenta';
}

export function restrictionSourceLabel(source) {
  return source === 'manual' ? 'Administración' : 'Integridad automática';
}

export function restrictionReasonText(restriction) {
  const scope = restrictionScopeLabel(restriction?.scope);
  if (restriction?.source === 'manual') {
    return `Hay una restricción manual activa asociada a esta ${scope}.`;
  }
  return `Los controles de integridad han bloqueado temporalmente el juego competitivo para este ${scope}.`;
}

export function restrictionEndText(restriction) {
  if (!restriction?.active) return '';
  if (restriction.permanent) return 'Sin fecha de finalización.';
  const date = new Date(restriction.expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return `Finaliza el ${new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)}.`;
}
