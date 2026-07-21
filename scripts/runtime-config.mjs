const PLACEHOLDER_API_URL = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/game-api';

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

export function buildRuntimeConfig(environment = process.env) {
  const explicitApiUrl = normalizedUrl(environment.SUPABASE_FUNCTIONS_URL);
  const projectRef = normalizedProjectRef(
    environment.SUPABASE_PROJECT_ID || environment.PROJECT_ID,
  );
  const apiBaseUrl = explicitApiUrl
    || (projectRef ? `https://${projectRef}.supabase.co/functions/v1/game-api` : PLACEHOLDER_API_URL);

  const publicSiteUrl = normalizedUrl(environment.PUBLIC_SITE_URL)
    || normalizedUrl(environment.GITHUB_PAGES_URL)
    || repositoryPagesUrl(environment.GITHUB_REPOSITORY, environment.GITHUB_REPOSITORY_OWNER);

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
  if (!config.apiBaseUrl || config.apiBaseUrl.includes('YOUR_PROJECT_REF')) {
    errors.push('Set SUPABASE_FUNCTIONS_URL or SUPABASE_PROJECT_ID.');
  }
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co\/functions\/v1\/game-api$/i.test(config.apiBaseUrl)) {
    errors.push('The generated Supabase Edge Function URL is invalid.');
  }
  if (!config.publicSiteUrl || !/^https:\/\//i.test(config.publicSiteUrl)) {
    errors.push('The public GitHub Pages URL could not be derived.');
  }
  return errors;
}

export { PLACEHOLDER_API_URL };
