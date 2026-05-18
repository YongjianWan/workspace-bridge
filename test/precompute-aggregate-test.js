#!/usr/bin/env node
/**
 * Precomputed aggregate cache tests (P2)
 */
const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

function buildMockGraph() {
  const root = '/fake/root';
  const cache = new WorkspaceCache(root);
  const dg = new DependencyGraph(root, cache, {
    projectContext: {
      classifyFile: () => ({ isMainline: true, fileRole: 'library' }),
      summarizeFiles: () => ({ entryFiles: [] }),
    },
  });
  // Manually populate graph
  dg.graph.set('/fake/root/src/a.js', {
    imports: ['/fake/root/src/b.js'],
    exports: ['foo', 'bar'],
    importRecords: [{ source: './b', resolved: '/fake/root/src/b.js', imported: ['foo'] }],
    exportRecords: [{ name: 'foo' }, { name: 'bar' }],
    parseMode: 'ast',
  });
  dg.graph.set('/fake/root/src/b.js', {
    imports: [],
    exports: ['foo'],
    importRecords: [],
    exportRecords: [{ name: 'foo' }],
    parseMode: 'ast',
  });
  // Build reverse graph manually so getDependents works
  dg.reverseGraph.set('/fake/root/src/b.js', ['/fake/root/src/a.js']);
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

function testPersistentRoundTrip() {
  const root = '/fake/root2';
  const cache = new WorkspaceCache(root);
  const dg = new DependencyGraph(root, cache, {
    projectContext: {
      classifyFile: () => ({ isMainline: true, fileRole: 'library' }),
      summarizeFiles: () => ({ entryFiles: [] }),
    },
  });
  dg.graph.set('/fake/root2/src/x.js', { imports: [], exports: ['x'], importRecords: [], exportRecords: [{ name: 'x' }], parseMode: 'ast' });

  dg.analyzer.precomputeAggregates();
  const before = dg.analyzer._aggregateCache;
  assert(before, 'should have aggregate before save');

  cache.saveAggregateSummary(before);
  const loaded = cache.loadAggregateSummary();
  assert(loaded, 'should load aggregate from cache');
  assert.strictEqual(loaded.stats.files, before.stats.files, 'loaded stats should match');
  assert.strictEqual(loaded.deadExports.length, before.deadExports.length, 'loaded deadExports should match');
}

function main() {
  testCacheHit();
  testCacheInvalidation();
  testPersistentRoundTrip();
  console.log('precompute-aggregate-test.js: all passed');
}

main();
