const DEFAULT_SUPABASE_PROJECT_ID = 'imtitjwgiemlaabpioed';
const DEFAULT_API_URL = `https://${DEFAULT_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/game-api`;

function normalizedUrl(value) {
  return String(value ?? '').trim().replace(/\/$/, '');
}

function normalizedProjectRef(value) {
  const projectRef = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(projectRef) ? projectRef : '';
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

function validHttpsUrl(value, expectedPath = null) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (!expectedPath || url.pathname.replace(/\/$/, '') === expectedPath);
  } catch {
    return false;
  }
}

export function buildRuntimeConfig(environment = process.env) {
  const explicitApiUrl = normalizedUrl(environment.SUPABASE_FUNCTIONS_URL);
  const configuredProjectRef = normalizedProjectRef(
    environment.SUPABASE_PROJECT_ID || environment.PROJECT_ID,
  );
  const projectRef = configuredProjectRef || DEFAULT_SUPABASE_PROJECT_ID;
  const apiBaseUrl = explicitApiUrl
    || `https://${projectRef}.supabase.co/functions/v1/game-api`;

  const publicSiteUrl = normalizedUrl(environment.PUBLIC_SITE_URL)
    || normalizedUrl(environment.GITHUB_PAGES_URL)
    || repositoryPagesUrl(environment.GITHUB_REPOSITORY, environment.GITHUB_REPOSITORY_OWNER)
    || 'https://juanjogondev.github.io/106';

  return {
    apiBaseUrl,
    turnstileSiteKey: String(environment.TURNSTILE_SITE_KEY ?? '').trim(),
    googleAnalyticsId: String(environment.GOOGLE_ANALYTICS_ID ?? '').trim(),
    adSenseClient: String(environment.ADSENSE_CLIENT ?? '').trim(),
    publicSiteUrl,
  };
}

export function validateRuntimeConfig(config) {
  const errors = [];
  if (!validHttpsUrl(config.apiBaseUrl, '/functions/v1/game-api')) {
    errors.push('The generated Supabase Edge Function URL is invalid.');
  }
  if (!validHttpsUrl(config.publicSiteUrl)) {
    errors.push('The public GitHub Pages URL could not be derived.');
  }
  return errors;
}

export { DEFAULT_API_URL, DEFAULT_SUPABASE_PROJECT_ID };
