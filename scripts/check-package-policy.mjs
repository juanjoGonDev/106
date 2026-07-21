import { existsSync, readFileSync } from 'node:fs';

const EXPECTED_NODE = '22.13.0';
const EXPECTED_PNPM = '11.15.1';
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
];
const INSTALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const REQUIRED_PNPM_SETTINGS = [
  'nodeVersion: 22.13.0',
  'engineStrict: true',
  'pmOnFail: error',
  'preferFrozenLockfile: true',
  "savePrefix: ''",
  'verifyDepsBeforeRun: error',
  'strictPeerDependencies: true',
  'autoInstallPeers: false',
  'strictDepBuilds: true',
  'dangerouslyAllowAllBuilds: false',
  'minimumReleaseAge: 10080',
  'minimumReleaseAgeStrict: true',
  'minimumReleaseAgeIgnoreMissingTime: false',
  'trustPolicy: no-downgrade',
  'trustLockfile: false',
  'blockExoticSubdeps: true',
];

function fail(message) {
  console.error(`Package policy violation: ${message}`);
  process.exitCode = 1;
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
    if (!EXACT_SEMVER.test(version)) {
      fail(`${section}.${name} must use an exact semantic version, received ${version}`);
    }
  }
}

for (const scriptName of INSTALL_LIFECYCLE_SCRIPTS) {
  if (Object.hasOwn(manifest.scripts ?? {}, scriptName)) {
    fail(`install lifecycle script "${scriptName}" is forbidden`);
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
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    if (!lockfile.includes(`${name}:`)) {
      fail(`pnpm-lock.yaml does not contain ${name}`);
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
