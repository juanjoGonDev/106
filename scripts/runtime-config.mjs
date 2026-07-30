import {
  normalizeAuthEmailOtpExpirySeconds,
  normalizeAuthEmailOtpLength,
} from '../public/auth-account-state.js';
import { SUPABASE_AUTH_EMAIL_POLICY } from './supabase-auth-email-policy.mjs';

const DEFAULT_SUPABASE_PROJECT_ID = 'imtitjwgiemlaabpioed';
const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT_ID}.supabase.co`;
const DEFAULT_API_URL = `${DEFAULT_SUPABASE_URL}/functions/v1/game-api`;

function normalizedUrl(value) {
  return String(value ?? '').trim().replace(/\/$/, '');
}

function normalizedProjectRef(value) {
  const projectRef = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(projectRef) ? projectRef : '';
}

function normalizedPublishableKey(value) {
  const key = String(value ?? '').trim();
  return /^sb_publishable_[a-zA-Z0-9_-]{20,}$/.test(key)
    || /^eyJ[a-zA-Z0-9._-]{20,}$/.test(key)
    ? key
    : '';
}

function repositoryPagesUrl(repository, owner) {
  const repositoryName = String(repository ?? '').split('/').pop()?.trim();
  const repositoryOwner = String(owner ?? '').trim();
  if (!repositoryName || !repositoryOwner) return '';

  const normalizedRepository = repositoryName.toLowerCase();
  const normalizedOwner = repositoryOwner.toLowerCase();
  return normalizedRepository === `${normalizedOwner}.github.io`
    ? `https://${normalizedOwner}.github.io`
    : `https://${normalizedOwner}.github.io/${repositoryName}`;
}

function isLocalUrl(url) {
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
}

function validPublicUrl(value, expectedPath = null, allowLocal = false) {
  try {
    const url = new URL(value);
    const validProtocol = url.protocol === 'https:' || (allowLocal && isLocalUrl(url));
    return validProtocol && (!expectedPath || url.pathname.replace(/\/$/, '') === expectedPath);
  } catch {
    return false;
  }
}

function supabaseUrlFromApi(apiBaseUrl, projectRef) {
  try {
    const url = new URL(apiBaseUrl);
    if ((url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')) || isLocalUrl(url)) {
      return `${url.protocol}//${url.host}`;
    }
  } catch {
    // Fall back to the validated project reference.
  }
  return `https://${projectRef}.supabase.co`;
}

function normalizedSupabaseUrl(value) {
  const url = normalizedUrl(value);
  return validPublicUrl(url, null, true) ? url : '';
}

export function buildRuntimeConfig(environment = process.env, authEmailPolicy = SUPABASE_AUTH_EMAIL_POLICY) {
  const explicitApiUrl = normalizedUrl(environment.SUPABASE_FUNCTIONS_URL);
  const configuredProjectRef = normalizedProjectRef(
    environment.SUPABASE_PROJECT_ID || environment.PROJECT_ID,
  );
  const projectRef = configuredProjectRef || DEFAULT_SUPABASE_PROJECT_ID;
  const explicitSupabaseUrl = normalizedSupabaseUrl(environment.SUPABASE_URL);
  const apiBaseUrl = explicitApiUrl
    || (explicitSupabaseUrl ? `${explicitSupabaseUrl}/functions/v1/game-api` : '')
    || `https://${projectRef}.supabase.co/functions/v1/game-api`;
  const supabaseUrl = explicitSupabaseUrl || supabaseUrlFromApi(apiBaseUrl, projectRef);

  const publicSiteUrl = normalizedUrl(environment.PUBLIC_SITE_URL)
    || normalizedUrl(environment.GITHUB_PAGES_URL)
    || repositoryPagesUrl(environment.GITHUB_REPOSITORY, environment.GITHUB_REPOSITORY_OWNER)
    || 'https://juanjogondev.github.io/106';

  return {
    apiBaseUrl,
    accountAuthApiUrl: `${supabaseUrl}/functions/v1/account-auth`,
    supabaseUrl,
    supabasePublishableKey: normalizedPublishableKey(environment.SUPABASE_PUBLISHABLE_KEY),
    authEmailOtpLength: authEmailPolicy.otpLength,
    authEmailOtpExpirySeconds: authEmailPolicy.otpExpirySeconds,
    turnstileSiteKey: String(environment.TURNSTILE_SITE_KEY ?? '').trim(),
    googleAnalyticsId: String(environment.GOOGLE_ANALYTICS_ID ?? '').trim(),
    adSenseClient: String(environment.ADSENSE_CLIENT ?? '').trim(),
    publicSiteUrl,
  };
}

export function validateRuntimeConfig(config, options = {}) {
  const errors = [];
  const allowLocal = options.allowLocal === true;
  if (!validPublicUrl(config.apiBaseUrl, '/functions/v1/game-api', allowLocal)) {
    errors.push('The generated Supabase Edge Function URL is invalid.');
  }
  if (!validPublicUrl(config.accountAuthApiUrl, '/functions/v1/account-auth', allowLocal)) {
    errors.push('The generated account-auth Edge Function URL is invalid.');
  }
  if (!validPublicUrl(config.supabaseUrl, null, allowLocal)) {
    errors.push('The generated Supabase project URL is invalid.');
  }
  if (!validPublicUrl(config.publicSiteUrl, null, allowLocal)) {
    errors.push('The public GitHub Pages URL could not be derived.');
  }
  if (!normalizeAuthEmailOtpLength(config.authEmailOtpLength)) {
    errors.push('The generated email OTP length is invalid.');
  }
  if (!normalizeAuthEmailOtpExpirySeconds(config.authEmailOtpExpirySeconds)) {
    errors.push('The generated email OTP expiry is invalid.');
  }
  if (options.requireAuth === true && !config.supabasePublishableKey) {
    errors.push('SUPABASE_PUBLISHABLE_KEY is required for the production authentication UI.');
  }
  return errors;
}

export {
  DEFAULT_API_URL,
  DEFAULT_SUPABASE_PROJECT_ID,
  DEFAULT_SUPABASE_URL,
};
