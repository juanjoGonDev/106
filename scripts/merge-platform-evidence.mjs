import { resolve } from 'node:path';

import { mergePlatformEvidenceFragments } from './platform-evidence-fragments.mjs';

const fragmentsDirectory = resolve(process.env.PLATFORM_EVIDENCE_FRAGMENTS_DIRECTORY || '.tmp/platform-evidence-fragments');
const outputDirectory = resolve(process.env.PLATFORM_EVIDENCE_DIRECTORY || '.tmp/pr-previews');
const paths = mergePlatformEvidenceFragments({ fragmentsDirectory, outputDirectory });
process.stdout.write(`Merged ${paths.length} evidence files from parallel browser fragments into ${outputDirectory}.\n`);
