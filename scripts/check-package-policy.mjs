import { existsSync, readFileSync } from 'node:fs';

const EXPECTED_NODE = '22.13.0';
const EXPECTED_PNPM = '11.15.1';
const FORBIDDEN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
];
const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const FOREIGN_PACKAGE_MANAGER_COMMAND = /(^|[\s;&|])(npm|npx|yarn|bunx?|corepack\s+(?:npm|yarn))(?=$|[\s;&|])/;
const REQUIRED_PNPM_SETTINGS = [
  'nodeVersion: 22.13.0',
  'engineStrict: true',
  'pmOnFail: error',
  'lockfile: true',
  'preferFrozenLockfile: true',
  "savePrefix: ''",
  'verifyDepsBeforeRun: error',
  'resolutionMode: time-based',
  'strictPeerDependencies: true',
  'autoInstallPeers: false',
  'strictDepBuilds: true',
  'dangerouslyAllowAllBuilds: false',
  'allowBuilds: {}',
  'minimumReleaseAge: 10080',
  'minimumReleaseAgeStrict: true',
  'minimumReleaseAgeIgnoreMissingTime: false',
  'trustPolicy: no-downgrade',
  'trustLockfile: false',
  'blockExoticSubdeps: true',
  'sideEffectsCache: false',
];

function fail(message) {
  console.error(`Package policy violation: ${message}`);
  process.exitCode = 1;
}

function isNumericIdentifier(value) {
  if (value.length === 0 || (value.length > 1 && value.startsWith('0'))) return false;
  return [...value].every((character) => character >= '0' && character <= '9');
}

function isValidSemverIdentifier(value, allowLeadingZero) {
  if (value.length === 0) return false;

  const validCharacters = [...value].every((character) => (
    (character >= '0' && character <= '9')
    || (character >= 'A' && character <= 'Z')
    || (character >= 'a' && character <= 'z')
    || character === '-'
  ));

  if (!validCharacters) return false;
  if (!allowLeadingZero && [...value].every((character) => character >= '0' && character <= '9')) {
    return isNumericIdentifier(value);
  }
  return true;
}

function isExactSemver(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;

  const buildParts = value.split('+');
  if (buildParts.length > 2) return false;
  const [versionAndPrerelease, buildMetadata] = buildParts;

  const prereleaseSeparator = versionAndPrerelease.indexOf('-');
  const core = prereleaseSeparator === -1
    ? versionAndPrerelease
    : versionAndPrerelease.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1
    ? undefined
    : versionAndPrerelease.slice(prereleaseSeparator + 1);

  const coreParts = core.split('.');
  if (coreParts.length !== 3 || !coreParts.every(isNumericIdentifier)) return false;

  if (prerelease !== undefined) {
    const identifiers = prerelease.split('.');
    if (!identifiers.every((identifier) => isValidSemverIdentifier(identifier, false))) return false;
  }

  if (buildMetadata !== undefined) {
    const identifiers = buildMetadata.split('.');
    if (!identifiers.every((identifier) => isValidSemverIdentifier(identifier, true))) return false;
  }

  return true;
}

function lockfileContainsPackage(lockfile, name) {
  return [
    `${name}:`,
    `'${name}':`,
    `"${name}":`,
  ].some((key) => lockfile.includes(key));
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

if (manifest.packageManager !== `pnpm@${EXPECTED_PNPM}`) {
  fail(`packageManager must be pnpm@${EXPECTED_PNPM}`);
}
if (manifest.engines?.node !== EXPECTED_NODE) {
  fail(`engines.node must be exactly ${EXPECTED_NODE}`);
}
if (manifest.engines?.pnpm !== EXPECTED_PNPM) {
  fail(`engines.pnpm must be exactly ${EXPECTED_PNPM}`);
}
if (manifest.volta?.node !== EXPECTED_NODE || manifest.volta?.pnpm !== EXPECTED_PNPM) {
  fail('Volta must pin the same exact Node.js and pnpm versions');
}

for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(manifest[section] ?? {})) {
    if (!isExactSemver(version)) {
      fail(`${section}.${name} must use an exact semantic version, received ${version}`);
    }
  }
}

for (const scriptName of INSTALL_LIFECYCLE_SCRIPTS) {
  if (Object.hasOwn(manifest.scripts ?? {}, scriptName)) {
    fail(`install lifecycle script "${scriptName}" is forbidden`);
  }
}

for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
  if (FOREIGN_PACKAGE_MANAGER_COMMAND.test(command)) {
    fail(`script "${scriptName}" must use pnpm rather than another package manager`);
  }
}

for (const path of FORBIDDEN_LOCKFILES) {
  if (existsSync(path)) {
    fail(`${path} is forbidden; pnpm-lock.yaml is the only accepted lockfile`);
  }
}

if (!existsSync('pnpm-lock.yaml')) {
  fail('pnpm-lock.yaml must be committed');
} else {
  const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!lockfileContainsPackage(lockfile, name)) {
        fail(`pnpm-lock.yaml does not contain ${name}`);
      }
    }
  }
}

const pnpmSettings = readFileSync('pnpm-workspace.yaml', 'utf8');
for (const setting of REQUIRED_PNPM_SETTINGS) {
  if (!pnpmSettings.includes(setting)) {
    fail(`pnpm-workspace.yaml must include "${setting}"`);
  }
}

if (!process.exitCode) {
  console.log('pnpm package and supply-chain policy is valid.');
}
