const FRONTEND_EXTENSIONS = new Set(['.css', '.gif', '.html', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const FRONTEND_PREFIXES = ['public/', 'supabase/functions/player-share/'];
const FRONTEND_ROOT_FILES = new Set(['index.html', 'playwright.config.js']);
const START_MARKER = '<!-- visual-evidence:start -->';
const END_MARKER = '<!-- visual-evidence:end -->';
const PLACEHOLDER_PATTERN = /(?:paste|pega|replace|placeholder|todo|example\.com|github\.com\/OWNER)/i;

function stringValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function extension(path) {
  const match = stringValue(path).toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

export function isFrontendPath(path) {
  const normalized = stringValue(path).replaceAll('\\', '/');
  if (!normalized) return false;
  if (FRONTEND_ROOT_FILES.has(normalized)) return true;
  if (FRONTEND_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return FRONTEND_EXTENSIONS.has(extension(normalized));
}

function normalizeSummary(value) {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSummary(summary) {
  const normalized = normalizeSummary(summary);
  const match = normalized.match(/^(.*?)\s*(?:·|—|-)\s*(desktop|mobile|escritorio|m[oó]vil)$/i);
  if (!match) return null;
  const area = match[1].trim();
  if (!area) return null;
  const device = /^(?:desktop|escritorio)$/i.test(match[2]) ? 'desktop' : 'mobile';
  return { area, device };
}

function markdownImage(detailsBody) {
  const match = String(detailsBody).match(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
  return match ? match[1].trim() : '';
}

function evidenceRegion(body) {
  const text = stringValue(body);
  const start = text.indexOf(START_MARKER);
  if (start < 0) return null;
  const end = text.indexOf(END_MARKER);
  if (end < 0) return null;
  if (end <= start) return null;
  return text.slice(start + START_MARKER.length, end);
}

export function parseVisualEvidence(body) {
  const region = evidenceRegion(body);
  if (region === null) return { hasMarkers: false, entries: [] };
  const entries = [];
  const detailsPattern = /<details(?:\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  for (const match of region.matchAll(detailsPattern)) {
    const parsed = parseSummary(match[1]);
    if (!parsed) continue;
    entries.push({ ...parsed, image: markdownImage(match[2]), summary: normalizeSummary(match[1]) });
  }
  return { hasMarkers: true, entries };
}

export function validateVisualEvidence(body, changedFiles) {
  const files = changedFiles === null || changedFiles === undefined ? [] : changedFiles;
  const frontendFiles = [...new Set(files.map(String).filter(isFrontendPath))].sort();
  if (!frontendFiles.length) return { required: false, frontendFiles, errors: [] };

  const parsed = parseVisualEvidence(body);
  const errors = [];
  if (!parsed.hasMarkers) {
    errors.push('Missing visual evidence marker block. Use the repository pull request template.');
    return { required: true, frontendFiles, errors };
  }
  if (!parsed.entries.length) {
    errors.push('Add at least one paired Desktop/Mobile visual evidence area.');
    return { required: true, frontendFiles, errors };
  }

  const areas = new Map();
  for (const entry of parsed.entries) {
    const key = entry.area.toLocaleLowerCase('es');
    let area = areas.get(key);
    if (!area) {
      area = { label: entry.area, desktop: [], mobile: [] };
      areas.set(key, area);
    }
    area[entry.device].push(entry);
    if (!entry.image) errors.push(`${entry.summary}: missing Markdown image.`);
    else if (PLACEHOLDER_PATTERN.test(entry.image)) errors.push(`${entry.summary}: replace the placeholder image URL.`);
  }

  for (const area of areas.values()) {
    if (!area.desktop.length) errors.push(`${area.label}: missing Desktop evidence.`);
    if (!area.mobile.length) errors.push(`${area.label}: missing Mobile evidence.`);
    if (area.desktop.length > 1) errors.push(`${area.label}: duplicate Desktop evidence.`);
    if (area.mobile.length > 1) errors.push(`${area.label}: duplicate Mobile evidence.`);
  }

  return { required: true, frontendFiles, errors: [...new Set(errors)] };
}

export const VISUAL_EVIDENCE_MARKERS = Object.freeze({ start: START_MARKER, end: END_MARKER });
