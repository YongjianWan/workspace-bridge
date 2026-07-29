// @semantic @slow — spawns the CLI once for the exit-code path
// L2-15 动作 0+1: reports may be replayed from the analysis snapshot;
// decision gates may not.
//
// The 'overview' snapshot is intentionally coarse-grained (git head + file
// count + config), so a replayed response can describe the LAST cold build.
// That is a speed trade-off for report paths — but three exits consume the
// same data as a *verdict*: --fail-on-findings (CI exit code), --save
// (baseline file), --check-regression (baseline comparison). A gate on
// replayed data is a bug, not a trade-off: fixing a cycle still exits 1,
// introducing one still exits 0.
//
// Contract locked here:
//   1. Report path: replay carries a `replayedFrom` marker (computedAt /
//      gitHead / fileCount) so consumers can tell "computed now" apart from
//      "replayed from an earlier cold build".
//   2. Gate paths: --save / --check-regression / --fail-on-findings on a
//      replayed response are REFUSED with an explicit reason — never
//      silently evaluated on stale numbers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ServiceContainer } = require('../src/services/container');
const { buildProjectOverview } = require('../src/tools/overview-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

function writeFixture(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'b.js'), 'module.exports = { helper: () => 1 };\n');
  fs.writeFileSync(path.join(src, 'a.js'), "const { helper } = require('./b');\nmodule.exports = { run: () => helper() };\n");
}

async function main() {
  const root = makeTempDir('wb-gate-on-replay-');
  writeFixture(root);
  const cacheDir = path.join(root, '.cache');

  // Phase 1 — cold run saves the 'overview' analysis snapshot.
  const cold = new ServiceContainer({ quiet: true, cacheDir });
  await cold.initialize(root, 60000, { watch: false });
  const coldResult = await buildProjectOverview({ cwd: root }, cold);
  assert.strictEqual(coldResult.ok, true, 'cold overview must succeed');
  assert.ok(!coldResult.replayedFrom, 'freshly computed result must NOT carry a replay marker');
  await cold.shutdown();

  // Phase 2 — warm container over the same cache dir replays the snapshot.
  const warm = new ServiceContainer({ quiet: true, cacheDir });
  await warm.initialize(root, 60000, { watch: false });

  // (1) Report path: allowed, but must carry the marker.
  const report = await buildProjectOverview({ cwd: root }, warm);
  assert.strictEqual(report.ok, true, 'report path may consume the replay');
  assert.ok(report.replayedFrom, 'replayed response must carry replayedFrom');
  assert.strictEqual(typeof report.replayedFrom.computedAt, 'number', 'marker names when the data was computed');
  assert.ok(report.replayedFrom.fileCount > 0, 'marker names the file count the data describes');

  // (2) --save on a replay: refuse, and must NOT write the baseline file.
  const baselinePath = path.join(root, 'baseline.json');
  const saveAttempt = await buildProjectOverview({ cwd: root, save: 'baseline.json' }, warm);
  assert.strictEqual(saveAttempt.ok, false, '--save on replayed data must be refused');
  assert.match(saveAttempt.error, /replay/i, 'refusal must name replay as the reason');
  assert.ok(!fs.existsSync(baselinePath), 'refused --save must not write a baseline file');

  // (3) --check-regression on a replay: refuse.
  const regressionAttempt = await buildProjectOverview({ cwd: root, checkRegression: true }, warm);
  assert.strictEqual(regressionAttempt.ok, false, '--check-regression on replayed data must be refused');
  assert.match(regressionAttempt.error, /replay/i, 'refusal must name replay as the reason');

  await warm.shutdown();

  // Phase 3 — the exit-code path, through the real CLI. The refusal is
  // identifiable ONLY by its stderr tag: exit 1 alone proves nothing
  // (hasFindings also exits 1) and stdout's replayedFrom marker would match
  // a naive /replay/ grep even without the refusal.
  const cli = spawnSync(
    process.execPath,
    [CLI_PATH, 'audit-summary', '--cwd', root, '--cache-dir', cacheDir, '--quiet', '--json', '--fail-on-findings'],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
  );
  assert.notStrictEqual(cli.status, 0, '--fail-on-findings on replayed data must not exit 0');
  assert.match(cli.stderr, /gate_on_replay/, 'CLI refusal must carry the gate_on_replay tag on stderr');

  // Sanity: the same warm cache WITHOUT a gate flag is a normal report run.
  const cliReport = spawnSync(
    process.execPath,
    [CLI_PATH, 'audit-summary', '--cwd', root, '--cache-dir', cacheDir, '--quiet', '--json'],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
  );
  assert.strictEqual(cliReport.status, 0, `report run must pass through, stderr: ${cli.stderr.slice(0, 300)}`);
  const reportJson = JSON.parse(cliReport.stdout);
  assert.ok(reportJson.replayedFrom, 'CLI report path must expose the replay marker');

  cleanupTempDir(root);
  console.log('gate-on-replay-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
