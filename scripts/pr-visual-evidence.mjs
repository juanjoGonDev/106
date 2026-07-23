const FRONTEND_EXTENSIONS = new Set(['.css', '.gif', '.html', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const FRONTEND_PREFIXES = ['public/', 'supabase/functions/player-share/'];
const FRONTEND_ROOT_FILES = new Set(['index.html', 'playwright.config.js']);
const DEVICE_SUFFIXES = Object.freeze([
  { label: 'desktop', device: 'desktop' },
  { label: 'escritorio', device: 'desktop' },
  { label: 'mobile', device: 'mobile' },
  { label: 'móvil', device: 'mobile' },
  { label: 'movil', device: 'mobile' },
]);
const SUMMARY_SEPARATORS = new Set(['·', '—', '-']);
const START_MARKER = '<!-- visual-evidence:start -->';
const END_MARKER = '<!-- visual-evidence:end -->';
const PLACEHOLDER_PATTERN = /(?:paste|pega|replace|placeholder|todo|example\.com|github\.com\/OWNER)/i;

function stringValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function extension(path) {
  const normalized = stringValue(path).toLowerCase();
  for (const candidate of FRONTEND_EXTENSIONS) {
    if (normalized.endsWith(candidate)) return candidate;
  }
  return '';
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
  const lower = normalized.toLocaleLowerCase('es');
  for (const suffix of DEVICE_SUFFIXES) {
    if (!lower.endsWith(suffix.label)) continue;
    const prefix = normalized.slice(0, normalized.length - suffix.label.length).trimEnd();
    const separator = prefix.at(-1);
    if (!SUMMARY_SEPARATORS.has(separator)) continue;
    const area = prefix.slice(0, -1).trim();
    if (!area) return null;
    return { area, device: suffix.device };
  }
  return null;
}

function markdownImage(detailsBody) {
  const text = String(detailsBody);
  const imageStart = text.indexOf('![');
  if (imageStart < 0) return '';
  const destinationStart = text.indexOf('](', imageStart + 2);
  if (destinationStart < 0) return '';
  const valueStart = destinationStart + 2;
  const destinationEnd = text.indexOf(')', valueStart);
  if (destinationEnd < 0) return '';
  const destination = text.slice(valueStart, destinationEnd).trim();
  if (!destination) return '';
  const titleSeparator = destination.indexOf(' ');
  return titleSeparator < 0 ? destination : destination.slice(0, titleSeparator).trim();
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

function detailsBlocks(region) {
  const blocks = [];
  let cursor = 0;
  while (cursor < region.length) {
    const detailsStart = region.indexOf('<details', cursor);
    if (detailsStart < 0) break;
    const openingEnd = region.indexOf('>', detailsStart);
    if (openingEnd < 0) break;
    const summaryStart = region.indexOf('<summary>', openingEnd + 1);
    if (summaryStart < 0) break;
    const summaryEnd = region.indexOf('</summary>', summaryStart + 9);
    if (summaryEnd < 0) break;
    const detailsEnd = region.indexOf('</details>', summaryEnd + 10);
    if (detailsEnd < 0) break;
    blocks.push({
      summary: region.slice(summaryStart + 9, summaryEnd),
      body: region.slice(summaryEnd + 10, detailsEnd),
    });
    cursor = detailsEnd + 10;
  }
  return blocks;
}

export function parseVisualEvidence(body) {
  const region = evidenceRegion(body);
  if (region === null) return { hasMarkers: false, entries: [] };
  const entries = [];
  for (const block of detailsBlocks(region)) {
    const parsed = parseSummary(block.summary);
    if (!parsed) continue;
    entries.push({ ...parsed, image: markdownImage(block.body), summary: normalizeSummary(block.summary) });
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
