import { basename } from 'node:path';

export const REQUIRED_PLATFORM_SNAPSHOTS = Object.freeze([
  'account-actions',
  'achievement-unlock',
  'browser-surface',
  'cookies-page',
  'daily-awards-after-finish',
  'daily-limit-countdown',
  'duel-target',
  'game-countdown',
  'game-readiness',
  'home-awards',
  'home-competition-selector',
  'home-ranking',
  'home-stats-synchronization',
  'human-check-completed',
  'human-check-initial',
  'human-check-selected',
  'league-detail-active',
  'league-detail-scheduled',
  'league-directory',
  'league-waiting',
  'legal-page',
  'player-achievements',
  'player-collections',
  'player-honours-progress',
  'player-navigation',
  'player-overview',
  'player-profile-context',
  'player-profile-fallback',
  'player-reliability',
  'player-trophies',
  'privacy-page',
  'privacy-settings',
  'public-league',
  'ranking-achievements',
  'ranking-precision',
  'ranking-tiebreak',
  'ranking-trophies',
  'shared-result',
  'zadmin-dashboard',
  'zadmin-login',
]);

export const REQUIRED_PLATFORM_INTERACTIONS = Object.freeze([
  'achievement-unlock',
  'cookies-page',
  'daily-awards-after-finish',
  'daily-limit-countdown',
  'human-check-progress',
  'league-detail-active',
  'league-detail-scheduled',
  'league-directory',
  'player-collections',
  'player-reliability',
]);

const DEVICES = Object.freeze(['desktop', 'mobile']);
const INTERACTION_FORMATS = Object.freeze(['webm', 'gif']);
const EVIDENCE_FILE_PATTERN = /^(.*)-(desktop|mobile)\.(png|webm|gif)$/i;

function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function emptyDevices(factory) {
  return Object.fromEntries(DEVICES.map((device) => [device, factory()]));
}

function sortedEntries(mapper) {
  return [...mapper.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
}

export function parseEvidenceFile(path) {
  const normalized = normalizePath(path);
  if (!normalized || normalized.split('/').includes('recordings')) return null;
  const match = basename(normalized).match(EVIDENCE_FILE_PATTERN);
  if (!match || !match[1]) return null;
  return {
    area: match[1].toLowerCase(),
    device: match[2].toLowerCase(),
    format: match[3].toLowerCase(),
    path: normalized,
  };
}

export function inventoryPlatformEvidence(paths) {
  const snapshots = new Map();
  const interactions = new Map();
  const files = [...new Set((paths ?? []).map(normalizePath).filter(Boolean))].sort();

  for (const path of files) {
    const evidence = parseEvidenceFile(path);
    if (!evidence) continue;
    if (evidence.format === 'png') {
      const devices = snapshots.get(evidence.area) ?? emptyDevices(() => []);
      devices[evidence.device].push(evidence.path);
      snapshots.set(evidence.area, devices);
      continue;
    }
    const devices = interactions.get(evidence.area) ?? emptyDevices(() => ({ webm: [], gif: [] }));
    devices[evidence.device][evidence.format].push(evidence.path);
    interactions.set(evidence.area, devices);
  }

  return {
    files,
    snapshots: Object.fromEntries(sortedEntries(snapshots)),
    interactions: Object.fromEntries(sortedEntries(interactions)),
  };
}

function requireExactlyOne(errors, values, description) {
  if (values.length === 0) errors.push(`${description}: missing.`);
  if (values.length > 1) errors.push(`${description}: duplicate files.`);
}

export function validatePlatformEvidence(
  paths,
  {
    requiredSnapshots = REQUIRED_PLATFORM_SNAPSHOTS,
    requiredInteractions = REQUIRED_PLATFORM_INTERACTIONS,
  } = {},
) {
  const inventory = inventoryPlatformEvidence(paths);
  const errors = [];

  for (const area of requiredSnapshots) {
    const devices = inventory.snapshots[area] ?? emptyDevices(() => []);
    for (const device of DEVICES) requireExactlyOne(errors, devices[device], `${area} · ${device} PNG`);
  }

  for (const area of requiredInteractions) {
    const devices = inventory.interactions[area] ?? emptyDevices(() => ({ webm: [], gif: [] }));
    for (const device of DEVICES) {
      for (const format of INTERACTION_FORMATS) {
        requireExactlyOne(errors, devices[device][format], `${area} · ${device} ${format.toUpperCase()}`);
      }
    }
  }

  return { inventory, errors: [...new Set(errors)] };
}

export function createPlatformEvidenceManifest({ paths, generatedAt, commitSha, files = [] }) {
  const validation = validatePlatformEvidence(paths);
  return {
    schemaVersion: 1,
    generatedAt: String(generatedAt || ''),
    commitSha: String(commitSha || ''),
    summary: {
      files: validation.inventory.files.length,
      snapshotAreas: Object.keys(validation.inventory.snapshots).length,
      interactionAreas: Object.keys(validation.inventory.interactions).length,
    },
    snapshots: validation.inventory.snapshots,
    interactions: validation.inventory.interactions,
    files: [...files].sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}
