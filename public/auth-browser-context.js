import { AUTH_PENDING_CONFIRMATION_STORAGE_KEY, normalizeAuthConfig } from './auth-account-state.js';
import {
  authRouteUrl,
  localAccountActive,
  normalizeAuthRoute,
  resolveAuthExperience,
} from './auth-experience-state.js';

export function localAccountSnapshot(access) {
  const source = access && typeof access === 'object' ? access : {};
  const accountToken = typeof source.getAccountToken === 'function' ? source.getAccountToken(false) : '';
  const rememberedNicks = typeof source.getRememberedNicks === 'function' ? source.getRememberedNicks() : [];
  const legacyNicks = typeof source.getLegacyLocalNicks === 'function' ? source.getLegacyLocalNicks() : [];
  return Object.freeze({
    accountToken,
    rememberedNicks: Object.freeze(Array.isArray(rememberedNicks) ? [...rememberedNicks] : []),
    legacyNicks: Object.freeze(Array.isArray(legacyNicks) ? [...legacyNicks] : []),
  });
}

export function pendingConfirmationEmail(storage) {
  return String(storage?.getItem?.(AUTH_PENDING_CONFIRMATION_STORAGE_KEY) ?? '');
}

export async function browserAuthExperience({
  client,
  config: configValue,
  access,
  storage = window.localStorage,
  location = window.location,
} = {}) {
  const config = normalizeAuthConfig(configValue);
  const session = client ? await client.currentSession() : null;
  const local = localAccountSnapshot(access);
  return resolveAuthExperience({
    route: normalizeAuthRoute(location?.pathname),
    session,
    hasLocalAccount: localAccountActive(local),
    pendingEmail: pendingConfirmationEmail(storage),
  });
}

export function redirectToAuthRoute(experience, configValue, location = window.location) {
  if (!experience?.redirect) return false;
  const config = normalizeAuthConfig(configValue);
  const target = authRouteUrl(config.publicSiteUrl, experience.redirect);
  const current = new URL(location.href);
  const destination = new URL(target, current);
  if (destination.pathname === current.pathname && destination.search === current.search) return false;
  location.replace(destination.toString());
  return true;
}
