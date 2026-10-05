#!/usr/bin/env node
// @slow
// @semantic — graph-state warnings come from the ledger and follow the graph (no stale entries),
// the overview history signal reaches the graph through the read-only view, and warnings built
// outside a run still use whitelisted codes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { DependencyGraphView } = require('../src/models/workspace-snapshot');
const { buildHotspots } = require('../src/tools/overview-assembler');
const { warningOf } = require('../src/services/ledger');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

function testWarningOfValidatesCode() {
  assert.deepStrictEqual(warningOf('missing-target', { message: 'm' }), { type: 'missing-target', severity: 'high', message: 'm' });
  assert.throws(() => warningOf('missing-targt', {}), /Unknown ledger reason code/);
}

async function testGraphStateWarningsFollowTheGraph(root, cache) {
  const a = path.join(root, 'a.js');
  const b = path.join(root, 'b.js');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","version":"1.0.0"}');
  fs.writeFileSync(a, 'module.exports = 1;\n');
  fs.writeFileSync(b, 'module.exports = 2;\n');
  const graph = new DependencyGraph(root, cache, { quiet: true });
  await graph.build([a, b]);
  const empty = graph.buildWarnings().filter((w) => w.type === 'empty-graph');
  assert.strictEqual(empty.length, 1, 'two files with no edges are reported once');
  assert.strictEqual(empty[0].severity, 'high');

  fs.writeFileSync(b, 'module.exports = require("./a");\n');
  await graph.updateFiles([b]);
  assert.ok(!graph.buildWarnings().some((w) => w.type === 'empty-graph'), 'an edge now exists, so the warning must be gone');

  fs.writeFileSync(b, 'const a = require("./a");\nconst gone = require("my-local-helper");\nmodule.exports = { a, gone };\n');
  await graph.updateFiles([b]);
  const dropped = graph.buildWarnings().find((w) => w.type === 'unresolved-dropped');
  assert.ok(dropped, 'a local-looking import that cannot be resolved is reported');
  assert.strictEqual(dropped.severity, 'medium', 'the ratio-scaled severity overrides the code default');
}

async function testHistorySignalReachesGraphThroughView(root, cache) {
  const a = path.join(root, 'a.js');
  const graph = new DependencyGraph(root, cache, { quiet: true });
  await graph.build([a]);
  const failures = [];
  await buildHotspots(root, new DependencyGraphView(graph), [a], async () => ({ ok: false, error: 'git failed' }), failures);
  assert.ok(failures.length > 0, 'precondition: history reads failed');
  const warning = graph.buildWarnings().find((w) => w.type === 'history-unavailable');
  assert.ok(warning, 'the signal set through the view must be visible on the graph');
  assert.strictEqual(warning.files, failures.length);
}

async function testIgnoredOptionIsAnObjectWarning() {
  const result = await runCliInProcess(['audit-overview', '--cwd', path.join(__dirname, '..'), '--token-budget', '100', '--json', '--quiet']);
  const warning = result.warnings.find((w) => w.message && w.message.includes('--token-budget'));
  assert.deepStrictEqual(warning, { type: 'ignored-option', severity: 'low', message: '--token-budget only applies to --format ai; ignored here' });
  assert.ok(result.warnings.every((w) => typeof w === 'object' && w.type), 'no bare-string warnings');
}

async function main() {
  testWarningOfValidatesCode();
  const root = makeTempDir('wb-ledger-migration-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    await testGraphStateWarningsFollowTheGraph(root, cache);
    await testHistorySignalReachesGraphThroughView(root, cache);
  } finally {
    cache.close();
    cleanupTempDir(root);
  }
  await testIgnoredOptionIsAnObjectWarning();
  console.log('ledger-migration-test: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
