import { synchronizePlayerRadarModels } from './player-radar-model-files.mjs';

const check = process.argv.slice(2).includes('--check');
const drift = await synchronizePlayerRadarModels({ check });

if (drift.length > 0) {
  console.error('Player radar sources, cache revision or loaders are stale:');
  for (const path of drift) console.error(`  - ${path}`);
  console.error('Run `node scripts/sync-player-radar-model.mjs` and commit the generated files.');
  process.exitCode = 1;
} else {
  console.log(check
    ? 'Player radar sources, cache revision and loaders are synchronized.'
    : 'Player radar sources, cache revision and loaders updated.');
}
