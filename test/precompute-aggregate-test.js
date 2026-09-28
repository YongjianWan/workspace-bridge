#!/usr/bin/env node
// @fast
// @contract — Precomputed aggregate cache hit and invalidation behavior

/**
 * Precomputed aggregate cache tests (P2)
 */
const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

function buildMockGraph() {
  const root = '/fake/root';
  const cache = new WorkspaceCache(root);
  const dg = DependencyGraph.fromSchema(root, {
    '/fake/root/src/a.js': {
      imports: ['/fake/root/src/b.js'],
      exports: ['foo', 'bar'],
      importRecords: [{ source: './b', resolved: '/fake/root/src/b.js', imported: ['foo'] }],
      exportRecords: [{ name: 'foo' }, { name: 'bar' }],
      parseMode: 'ast',
    },
    '/fake/root/src/b.js': {
      imports: [],
      exports: ['foo'],
      importRecords: [],
      exportRecords: [{ name: 'foo' }],
      parseMode: 'ast',
    }
  }, {
    cache,
    projectContext: {
      classifyFile: () => ({ isMainline: true, fileRole: 'library' }),
      summarizeFiles: () => ({ entryFiles: [] }),
    }
  });
  return dg;
}

function testCacheHit() {
  const dg = buildMockGraph();
  const analyzer = dg.analyzer;

  // First call should compute and cache
  const stats1 = analyzer.getStats();
  assert.strictEqual(stats1.files, 2, 'stats should see 2 files');

  // Second call should return cached result without recomputing cycles
  const stats2 = analyzer.getStats();
  assert.strictEqual(stats2.files, 2, 'cached stats should still be 2');

  // deadExports
  const dead1 = analyzer.findDeadExports();
  const dead2 = analyzer.findDeadExports();
  assert.strictEqual(dead1.length, dead2.length, 'deadExports cache should be stable');

  // unresolved
  const unres1 = analyzer.findUnresolvedImports();
  const unres2 = analyzer.findUnresolvedImports();
  assert.strictEqual(unres1.length, unres2.length, 'unresolved cache should be stable');
}

function testCacheInvalidation() {
  const dg = buildMockGraph();
  const analyzer = dg.analyzer;

  analyzer.precomputeAggregates();
  assert(analyzer._aggregateCache, 'aggregate cache should exist after precompute');

  // Simulate graph change
  analyzer._bumpAggregateCache();
  assert.strictEqual(analyzer._aggregateCache, null, 'aggregate cache should be cleared on bump');

  const stats = analyzer.getStats();
  assert.strictEqual(stats.files, 2, 'stats should recompute after invalidation');
}

function main() {
  testCacheHit();
  testCacheInvalidation();
  console.log('precompute-aggregate-test.js: all passed');
}

main();
