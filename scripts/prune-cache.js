#!/usr/bin/env node
/**
 * Remove the project-isolated caches of workspaces that no longer exist.
 *
 *   node scripts/prune-cache.js            list what would be removed (changes nothing)
 *   node scripts/prune-cache.js --apply    remove it
 *   node scripts/prune-cache.js --json     machine-readable report
 *
 * Only caches whose recorded workspace is gone (on a drive that is still reachable) and that no
 * process holds are removed. See src/services/cache-prune.js.
 */
const { pruneDefaultCaches } = require('../src/services/cache-prune');

const BYTES_PER_MB = 1024 * 1024;
const LISTED_PER_BASE = 20;

const args = new Set(process.argv.slice(2));
const unknownArgs = [...args].filter((a) => !['--apply', '--json'].includes(a));
if (unknownArgs.length > 0) {
  console.error(`Unknown option(s): ${unknownArgs.join(', ')}. Usage: node scripts/prune-cache.js [--apply] [--json]`);
  process.exit(1);
}
const apply = args.has('--apply');
const reports = pruneDefaultCaches({ apply });

if (args.has('--json')) {
  console.log(JSON.stringify({ apply, reports }, null, 2));
} else {
  for (const report of reports) {
    const bytes = report.candidates.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(`${report.base}: ${report.scanned} cache dir(s), ${report.candidates.length} orphaned (${(bytes / BYTES_PER_MB).toFixed(1)} MB)`);
    for (const entry of report.candidates.slice(0, LISTED_PER_BASE)) {
      console.log(`  ${entry.dir}  <-  ${entry.workspaceRoot}`);
    }
    if (report.candidates.length > LISTED_PER_BASE) console.log(`  ... and ${report.candidates.length - LISTED_PER_BASE} more`);
    for (const entry of report.failed) console.error(`  could not remove ${entry.dir}: ${entry.error}`);
  }
  if (!apply && reports.some((r) => r.candidates.length > 0)) console.log('Nothing was removed. Run with --apply to remove the listed caches.');
}
process.exit(reports.some((r) => r.failed.length > 0) ? 1 : 0);
