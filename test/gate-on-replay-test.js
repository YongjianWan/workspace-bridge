// @semantic @slow — spawns the CLI once for the exit-code path
// L2-15: snapshot freshness decides whether a replay is honest; gates then
// need no special case.
//
// The 'overview' snapshot used to be deliberately coarse-grained (git head +
// file count + config), so it stayed "fresh" across uncommitted edits — which
// is exactly when a replayed verdict lies. The first fix refused to run gates
// on any replay, but that punished the common case too: on an UNCHANGED tree
// the replay is byte-for-byte what a cold build would produce, so refusing was
// a false alarm that broke `--save` on every warm cache.
//
// The freshness check now also asks cache.checkFileChanges() (mtime+size, with
// a SHA-256 fallback on drift — the same probe getStaleness already runs). A
// replay therefore only happens when the tree genuinely has not moved, which
// makes the replay trustworthy for reports AND gates alike. No refusal branch,
// no special exit code: one honest freshness judgement replaces the whole
// special case.
//
// Contract locked here:
//   1. Unchanged tree: replay is served, carries a `replayedFrom` marker, and
//      gates (--save / --check-regression) run normally on it.
//   2. Edited tree (git head, file count and config all unchanged): NO replay.
//      The stale snapshot must not be served to anyone.
//   3. Invalid gate commands still report their own cause (a missing baseline
//      is "Baseline file not found", never something about replays).
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

  // Phase 2 — warm container over the same cache, tree untouched.
  const warm = new ServiceContainer({ quiet: true, cacheDir });
  await warm.initialize(root, 60000, { watch: false });

  // (1) Report path: replay served, marker present.
  const report = await buildProjectOverview({ cwd: root }, warm);
  assert.strictEqual(report.ok, true, 'report path may consume the replay');
  assert.ok(report.replayedFrom, 'replayed response must carry replayedFrom');
  assert.strictEqual(typeof report.replayedFrom.computedAt, 'number', 'marker names when the data was computed');
  assert.ok(report.replayedFrom.fileCount > 0, 'marker names the file count the data describes');

  // (2) A gate command whose PRECONDITION fails must report that cause — not
  // anything about replays. (No baseline file exists yet.)
  let preconditionErr = null;
  try {
    await buildProjectOverview({ cwd: root, checkRegression: true }, warm);
  } catch (e) {
    preconditionErr = e;
  }
  assert.ok(preconditionErr, '--check-regression with no baseline must fail');
  assert.match(
    preconditionErr.message,
    /Baseline file not found/,
    `the error must name the missing baseline; got: ${preconditionErr && preconditionErr.message}`
  );

  // (3) --save on an UNCHANGED tree: allowed, and it must really write. The
  // replay is identical to what a cold build would produce, so refusing here
  // was a false alarm (it broke every repeated `--save` on a warm cache).
  const baselinePath = path.join(root, 'baseline.json');
  const saveAttempt = await buildProjectOverview({ cwd: root, save: 'baseline.json' }, warm);
  assert.strictEqual(saveAttempt.ok, true, `--save on an unchanged tree must succeed, got: ${saveAttempt.error}`);
  assert.ok(fs.existsSync(baselinePath), '--save must actually write the baseline file');

  // (4) --check-regression on an unchanged tree with a valid baseline: runs.
  const regressionAttempt = await buildProjectOverview(
    { cwd: root, checkRegression: true, baseline: 'baseline.json' },
    warm
  );
  assert.strictEqual(regressionAttempt.ok, true, `--check-regression must run on an unchanged tree, got: ${regressionAttempt.error}`);
  assert.ok(regressionAttempt.regression, 'a regression verdict must be produced');

  await warm.shutdown();

  // Phase 3 — the case the coarse check missed: edit a file IN PLACE. Git head
  // is unchanged (nothing committed), file count is unchanged (no file added),
  // config is unchanged. Only the content moved — and that must kill the replay.
  fs.writeFileSync(
    path.join(root, 'src', 'b.js'),
    'module.exports = { helper: () => 1, extra: () => 2 };\n'
  );

  const edited = new ServiceContainer({ quiet: true, cacheDir });
  await edited.initialize(root, 60000, { watch: false });
  const afterEdit = await buildProjectOverview({ cwd: root }, edited);
  assert.strictEqual(afterEdit.ok, true, 'overview after an edit must succeed');
  assert.ok(
    !afterEdit.replayedFrom,
    'an edited tree must NOT be served the stale snapshot — freshness has to see content changes'
  );
  await edited.shutdown();

  // Phase 4 — the exit-code path through the real CLI: a gate on a warm cache
  // is now an ordinary run, not a refusal.
  const cli = spawnSync(
    process.execPath,
    [CLI_PATH, 'audit-summary', '--cwd', root, '--cache-dir', cacheDir, '--quiet', '--json', '--fail-on-findings'],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
  );
  assert.ok(
    cli.status === 0 || cli.status === 1,
    `a gate on a warm cache must produce an ordinary verdict (0 or 1), got ${cli.status}: ${cli.stderr.slice(0, 300)}`
  );
  assert.doesNotMatch(cli.stderr, /gate_on_replay/, 'the refusal branch must be gone');

  cleanupTempDir(root);
  console.log('gate-on-replay-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
