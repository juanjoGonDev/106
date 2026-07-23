import process from 'node:process';
import { auditPublicAssets, formatAssetAudit } from './public-assets.mjs';

const report = auditPublicAssets(process.cwd());
const message = formatAssetAudit(report);

if (message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public asset audit passed (${report.publicMedia.length} media files).\n`);
}
