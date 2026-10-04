#!/usr/bin/env node
// @semantic — the three ledger-backed warnings keep the shape consumers read, and the
// state-derived ones follow the graph when it changes (watch-mode updates).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const OVER_PARSER_LIMIT = 1024 * 1024 + 1;

async function main() {
  const root = makeTempDir('wb-ledger-warnings-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    const large = path.join(root, 'large.js');
    fs.writeFileSync(large, ' '.repeat(OVER_PARSER_LIMIT));
    const graph = new DependencyGraph(root, cache, { quiet: true });
    await graph.build([large]);

    const tooLarge = graph.buildWarnings().find((w) => w.type === 'file-too-large');
    assert.ok(tooLarge, 'oversize file is reported');
    assert.deepStrictEqual(Object.keys(tooLarge).sort(), ['files', 'message', 'severity', 'type']);
    assert.strictEqual(tooLarge.severity, 'high');
    assert.strictEqual(tooLarge.files, 1);
    assert.ok(tooLarge.message.startsWith('1 source file(s) were not parsed (file-too-large): '));
    assert.strictEqual(graph.buildWarnings().filter((w) => w.type === 'file-too-large').length, 1, 'asking twice does not duplicate');

    fs.writeFileSync(large, 'module.exports = 1;\n');
    await graph.updateFiles([large]);
    assert.ok(!graph.buildWarnings().some((w) => w.type === 'file-too-large'), 'a file now under the limit leaves no stale warning');

    graph.analyzer.precomputeAggregates = async () => { throw Error('injected analysis failure'); };
    await graph.build([large]);
    const failed = graph.buildWarnings().find((w) => w.type === 'analysis-stage-failed');
    assert.deepStrictEqual(failed, {
      type: 'analysis-stage-failed',
      severity: 'high',
      stage: 'graph:built',
      message: 'Analysis stage graph:built failed: injected analysis failure; results are incomplete',
    });
    console.log('ledger-warnings-test: OK');
  } finally {
    cache.close();
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
