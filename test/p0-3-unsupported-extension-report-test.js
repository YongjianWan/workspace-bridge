// @semantic
// P0-3: known source extensions that no parser claims must not be silently
// dropped at discovery (external review §4 P0-3 / repro UNSUPPORTED-SILENT).
//
// Before the fix, discovery filtered the tree against the active parser
// extension set, so `Player.cs` never entered the index — and every consumer
// (coverage, warnings) only ever saw indexed files: coverageRatio reported 1
// while an entire language was missing (L1-4). This locks both channels a
// consumer reads, through container.snapshot.graph (the DependencyGraphView,
// not the bare graph — a bare-graph assertion proves "computed", only the
// view proves "user gets it"):
//   1. warnings[] carries a high-severity entry naming extension(s)+count;
//   2. analysisCoverage puts dropped files in the denominator (< 1);
//   3. warm replay of the overview snapshot stays consistent with live
//      discovery — dropped files are invisible to the content signature, so
//      coverage must be recomputed from the live graph at replay exit.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { buildProjectOverview } = require('../src/tools/overview-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeUnsupportedFixture(root) {
  fs.mkdirSync(path.join(root, 'Assets', 'Scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Assets', 'Scripts', 'Player.cs'), 'public class Player {}\n');
  fs.writeFileSync(path.join(root, 'Assets', 'Scripts', 'Enemy.cs'), 'public class Enemy { Player p; }\n');
  fs.writeFileSync(path.join(root, 'Server', 'app.py'), 'print(1)\n');
}

function unsupportedWarning(warnings) {
  return warnings.find((w) => w.type === 'unsupported-source-files');
}

async function main() {
  const root = makeTempDir('wb-p03-unsupported-');
  writeUnsupportedFixture(root);
  const cacheDir = path.join(root, '.cache');

  // --- cold run: discovery must count and report what no parser claims ---
  const cold = new ServiceContainer({ quiet: true, cacheDir });
  await cold.initialize(root, 60000, { watch: false });
  const graph = cold.snapshot.graph; // view path — what consumers actually use

  const warnings = graph.buildWarnings();
  const warning = unsupportedWarning(warnings);
  assert.ok(
    warning,
    `view.buildWarnings must carry an unsupported-source-files entry, got types: ${warnings.map((w) => w.type).join(', ')}`
  );
  assert.strictEqual(warning.severity, 'high', 'silently dropping source files is a high-priority signal');
  assert.strictEqual(warning.files, 2, 'both .cs files must be counted at discovery time');
  assert.deepStrictEqual(warning.extensions, { '.cs': 2 }, 'warning must name the extension and its file count');
  assert.ok(warning.message.includes('.cs'), 'warning message must name the extension');

  const coldStats = graph.getStats();
  assert.strictEqual(coldStats.analysisCoverage.unsupportedFiles, 2, 'coverage must account the dropped files');
  assert.strictEqual(coldStats.analysisCoverage.totalFiles, 3, 'denominator = 1 indexed + 2 unsupported');
  assert.ok(
    coldStats.analysisCoverage.coverageRatio < 1,
    `coverageRatio must be < 1 when unsupported files exist, got ${coldStats.analysisCoverage.coverageRatio}`
  );

  const coldOverview = await buildProjectOverview({}, cold);
  assert.ok(coldOverview.analysisCoverage, 'audit-overview must expose analysisCoverage');
  assert.strictEqual(coldOverview.analysisCoverage.unsupportedFiles, 2, 'overview carries the unsupported count');
  assert.ok(coldOverview.analysisCoverage.coverageRatio < 1, 'overview coverageRatio < 1');
  await cold.shutdown();

  // --- warm run after an unsupported file appears (tree of *indexed* files
  // unchanged → snapshot replays): coverage must answer for THIS run, not
  // replay the previous count (L1-3: derived state stays consistent) ---
  fs.writeFileSync(path.join(root, 'Assets', 'Scripts', 'Tower.cs'), 'public class Tower {}\n');
  const warm = new ServiceContainer({ quiet: true, cacheDir });
  await warm.initialize(root, 60000, { watch: false });
  const warmGraph = warm.snapshot.graph;

  const warmWarning = unsupportedWarning(warmGraph.buildWarnings());
  assert.ok(warmWarning, 'warm discovery must still report the dropped files');
  assert.strictEqual(warmWarning.files, 3, 'live discovery counts the newly added .cs file');

  const warmOverview = await buildProjectOverview({}, warm);
  assert.ok(warmOverview.replayedFrom, 'precondition: this overview came from the cold snapshot replay');
  assert.strictEqual(
    warmOverview.analysisCoverage.unsupportedFiles,
    3,
    'replayed coverage must reflect the live graph, not the stale snapshot count'
  );
  assert.ok(warmOverview.analysisCoverage.coverageRatio < 1, 'replayed coverageRatio < 1');
  assert.strictEqual(
    warmOverview.summary.analysisCoverage.coverageRatio,
    warmOverview.analysisCoverage.coverageRatio,
    'summary.analysisCoverage must stay in sync with the top-level field'
  );
  await warm.shutdown();

  // --- control: a supported-only repo must stay clean (no false alarm) ---
  const clean = makeTempDir('wb-p03-clean-');
  fs.writeFileSync(path.join(clean, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  fs.writeFileSync(path.join(clean, 'b.js'), 'module.exports = { helper: () => 1 };\n');
  fs.writeFileSync(path.join(clean, 'a.js'), "const { helper } = require('./b');\nmodule.exports = { run: helper };\n");
  const cleanContainer = new ServiceContainer({ quiet: true, cacheDir: path.join(clean, '.cache') });
  await cleanContainer.initialize(clean, 60000, { watch: false });
  const cleanGraph = cleanContainer.snapshot.graph;
  assert.ok(
    !unsupportedWarning(cleanGraph.buildWarnings()),
    'a supported-only repo must not get an unsupported-source-files warning'
  );
  const cleanStats = cleanGraph.getStats();
  assert.strictEqual(cleanStats.analysisCoverage.unsupportedFiles, 0, 'no unsupported files in a clean repo');
  assert.strictEqual(cleanStats.analysisCoverage.coverageRatio, 1, 'clean repo keeps coverageRatio 1');
  await cleanContainer.shutdown();

  cleanupTempDir(root);
  cleanupTempDir(clean);
  console.log('p0-3-unsupported-extension-report-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
