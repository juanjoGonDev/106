import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: node scripts/compare-production-snapshots.mjs <before.json> <after.json>');
  process.exit(1);
}

const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));

const monotonicMetrics = [
  'attempts',
  'verifiedAttempts',
  'players',
  'referrals',
  'completedReferrals',
  'bonusAttempts',
  'duels',
  'completedDuels',
  'leagues',
  'leagueMembers',
  'accounts',
  'accountPlayers',
];

const regressions = [];
for (const metric of monotonicMetrics) {
  const previous = Number(before[metric] ?? 0);
  const current = Number(after[metric] ?? 0);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    regressions.push(`${metric}: invalid snapshot value`);
  } else if (current < previous) {
    regressions.push(`${metric}: ${previous} -> ${current}`);
  }
}

if (regressions.length > 0) {
  console.error('Production history regression detected after deployment:');
  for (const regression of regressions) console.error(`- ${regression}`);
  console.error('Stop further deployments and investigate using Supabase backups/PITR and game_deployment_snapshots.');
  process.exit(1);
}

console.log('Production history verification passed.');
for (const metric of monotonicMetrics) {
  console.log(`${metric}: ${before[metric] ?? 0} -> ${after[metric] ?? 0}`);
}