import { pathToFileURL } from 'node:url';

const LOCAL_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function normalizeHttpOrigin(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return '';

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid allowed origin URL: ${candidate}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Allowed origins must use HTTP or HTTPS: ${candidate}`);
  }
  if (url.username || url.password) {
    throw new Error(`Allowed origins cannot contain credentials: ${candidate}`);
  }

  return url.origin;
}

function githubPagesOrigin(owner) {
  const normalizedOwner = String(owner ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(normalizedOwner)) return '';
  return `https://${normalizedOwner}.github.io`;
}

export function buildAllowedOrigins(environment = process.env) {
  const origins = new Set(LOCAL_ORIGINS);
  const pagesOrigin = githubPagesOrigin(environment.GITHUB_REPOSITORY_OWNER);
  if (pagesOrigin) origins.add(pagesOrigin);

  const publicSiteOrigin = normalizeHttpOrigin(environment.PUBLIC_SITE_URL);
  if (publicSiteOrigin) origins.add(publicSiteOrigin);

  for (const configuredOrigin of String(environment.ALLOWED_ORIGINS ?? '').split(',')) {
    const normalizedOrigin = normalizeHttpOrigin(configuredOrigin);
    if (normalizedOrigin) origins.add(normalizedOrigin);
  }

  return [...origins].join(',');
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPoint) process.stdout.write(buildAllowedOrigins());
