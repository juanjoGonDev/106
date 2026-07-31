import { synchronizePlayerRadarModels } from './player-radar-model-files.mjs';

const check = process.argv.slice(2).includes('--check');
const drift = await synchronizePlayerRadarModels({ check });

if (drift.length > 0) {
  console.error('Generated player radar models are stale:');
  for (const path of drift) console.error(`  - ${path}`);
  console.error('Run `pnpm sync:player-radar-model` and commit the generated files.');
  process.exitCode = 1;
} else {
  console.log(check
    ? 'Generated player radar models are synchronized.'
    : 'Generated player radar models updated.');
}
