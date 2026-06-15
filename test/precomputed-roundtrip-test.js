// @semantic
const assert = require('assert');
const { GraphDB } = require('../src/services/graph-db');
const { GraphAnalyzer } = require('../src/services/dep-graph/analyzer');
const path = require('path');
const os = require('os');
const fs = require('fs');

function tmpDbPath() {
  return path.join(os.tmpdir(), `wb-precomputed-test-${Date.now()}.db`);
}

// --- GraphDB precomputed tables ---

function testGraphDBPrecomputedAggregates() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  const rows = [
    { key: 'deadExports', data: JSON.stringify([{ file: 'a.js', exports: ['x'] }]), version: 1, fileCount: 3 },
    { key: 'stats', data: JSON.stringify({ files: 3 }), version: 1, fileCount: 3 },
  ];

  assert.strictEqual(db.savePrecomputedAggregates(rows), true);
  const loaded = db.loadPrecomputedAggregates();
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].key, 'deadExports');
  assert.strictEqual(loaded[0].version, 1);
  assert.strictEqual(loaded[0].fileCount, 3);
  assert.deepStrictEqual(JSON.parse(loaded[0].data), [{ file: 'a.js', exports: ['x'] }]);

  db.close();
  fs.unlinkSync(dbPath);
}

function testGraphDBPrecomputedImpact() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  const impactRadiusData = [{ file: 'b.js', level: 1, via: ['a.js'], reason: 'direct-import' }];
  const records = [
    { file: 'a.js', directDeps: 1, transitiveDeps: 2, directDependents: 3, transitiveDependents: 4, affectedTests: JSON.stringify([{ file: 't.js', distance: 1 }]), impactRadius: JSON.stringify(impactRadiusData), version: 1 },
    { file: 'b.js', directDeps: 0, transitiveDeps: 0, directDependents: 0, transitiveDependents: 0, affectedTests: null, impactRadius: null, version: 1 },
  ];

  assert.strictEqual(db.savePrecomputedImpact(records), true);
  const loaded = db.loadPrecomputedImpact();
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].file, 'a.js');
  assert.strictEqual(loaded[0].directDeps, 1);
  assert.strictEqual(loaded[0].transitiveDependents, 4);
  assert.deepStrictEqual(JSON.parse(loaded[0].affectedTests), [{ file: 't.js', distance: 1 }]);
  // Wave 9-1: verify impactRadius round-trip
  assert.ok(loaded[0].impactRadius, 'impactRadius should be persisted');
  assert.deepStrictEqual(JSON.parse(loaded[0].impactRadius), impactRadiusData);
  assert.strictEqual(loaded[1].impactRadius, null, 'null impactRadius should remain null');

  // Delete one row
  assert.strictEqual(db.deletePrecomputedImpact(['a.js']), true);
  const afterDelete = db.loadPrecomputedImpact();
  assert.strictEqual(afterDelete.length, 1);
  assert.strictEqual(afterDelete[0].file, 'b.js');

  db.close();
  fs.unlinkSync(dbPath);
}

// --- GraphAnalyzer precompute + inject ---

function mockDepGraph(graphData) {
  const graph = new Map(graphData);
  const reverseGraph = new Map();
  // Build reverse graph
  for (const [file, info] of graph) {
    for (const imp of info.imports || []) {
      if (!reverseGraph.has(imp)) reverseGraph.set(imp, []);
      reverseGraph.get(imp).push(file);
    }
  }
  return {
    graph,
    reverseGraph,
    normalizeFilePath: (f) => f,
    bus: { emit: () => {}, on: () => {} },
    getDependencies: (f) => graph.get(f)?.imports || [],
    getDependents: (f) => reverseGraph.get(f) || [],
    shouldExcludeCli: () => false,
    isTestLikeFile: (f) => f.includes('test'),
    isKnownEntryFile: () => false,
    _displayPath: (f) => f,
    cache: { getStats: () => ({ totalLines: 0 }) },
  };
}

function testAnalyzerPrecomputeImpact() {
  const dg = mockDepGraph([
    ['a.js', { imports: ['b.js'], exports: ['foo'] }],
    ['b.js', { imports: ['c.js'], exports: ['bar'] }],
    ['c.js', { imports: [], exports: ['baz'] }],
    ['a.test.js', { imports: ['a.js'], exports: [] }],
  ]);

  const analyzer = new GraphAnalyzer(dg);
  analyzer.precomputeImpact();

  const aImpact = analyzer.getPrecomputedImpact('a.js');
  assert.ok(aImpact);
  assert.strictEqual(aImpact.directDeps, 1, 'a.js direct deps should be 1 (b.js)');
  assert.strictEqual(aImpact.directDependents, 1, 'a.js direct dependents should be 1 (a.test.js)');
  assert.ok(aImpact.transitiveDeps >= 1, 'a.js should have transitive deps');
  assert.ok(aImpact.transitiveDependents >= 1, 'a.js should have transitive dependents');
  assert.ok(Array.isArray(aImpact.affectedTests), 'affectedTests should be array');

  const cImpact = analyzer.getPrecomputedImpact('c.js');
  assert.ok(cImpact);
  assert.strictEqual(cImpact.directDeps, 0, 'c.js has no deps');
  assert.strictEqual(cImpact.directDependents, 1, 'c.js direct dependents should be 1 (b.js)');
}

function testAnalyzerInjectPrecomputed() {
  const dg = mockDepGraph([
    ['a.js', { imports: ['b.js'], exports: ['foo'] }],
    ['b.js', { imports: [], exports: ['bar'] }],
  ]);

  const analyzer = new GraphAnalyzer(dg);

  // Inject aggregates
  const aggregateRows = [
    { key: 'deadExports', data: JSON.stringify([]), version: 0, fileCount: 2 },
    { key: 'stats', data: JSON.stringify({ files: 2 }), version: 0, fileCount: 2 },
  ];
  const okAgg = analyzer.injectPrecomputedAggregates(aggregateRows, 2);
  assert.strictEqual(okAgg, true);
  assert.ok(analyzer._aggregateCache);
  assert.deepStrictEqual(analyzer._aggregateCache.deadExports, []);

  // Inject impact (with impactRadius)
  const impactRadiusA = [{ file: 'b.js', level: 1, via: ['a.js'], reason: 'direct-import' }];
  const impactRows = [
    { file: 'a.js', directDeps: 1, transitiveDeps: 1, directDependents: 0, transitiveDependents: 0, affectedTests: JSON.stringify([]), impactRadius: JSON.stringify(impactRadiusA), version: 1 },
  ];
  const okImp = analyzer.injectPrecomputedImpact(impactRows, 2);
  assert.strictEqual(okImp, true);
  const cached = analyzer.getPrecomputedImpact('a.js');
  assert.ok(cached);
  assert.strictEqual(cached.directDeps, 1);
  // Wave 9-1: verify impactRadius restored
  assert.ok(cached.impactRadius, 'impactRadius should be restored from injection');
  assert.deepStrictEqual(cached.impactRadius, impactRadiusA);

  // Reject stale aggregates (wrong fileCount)
  const staleAgg = analyzer.injectPrecomputedAggregates([{ key: 'stats', data: '{}', version: 0, fileCount: 99 }], 2);
  assert.strictEqual(staleAgg, false);

  // Reject stale impact (row count mismatch)
  const staleImp = analyzer.injectPrecomputedImpact([], 2);
  assert.strictEqual(staleImp, false);
}

function testAnalyzerInjectPrecomputedCorruptedRow() {
  const dg = mockDepGraph([['a.js', { imports: [], exports: [] }]]);
  const analyzer = new GraphAnalyzer(dg);

  const rows = [
    { key: 'deadExports', data: 'not-json', version: 0, fileCount: 1 },
    { key: 'stats', data: JSON.stringify({ files: 1 }), version: 0, fileCount: 1 },
  ];
  // Should survive corrupted row and still inject valid ones
  const ok = analyzer.injectPrecomputedAggregates(rows, 1);
  assert.strictEqual(ok, true);
  assert.ok(analyzer._aggregateCache);
  assert.deepStrictEqual(analyzer._aggregateCache.stats, { files: 1 });
}

function testAnalyzerRestoreAggregateCache() {
  const dg = mockDepGraph([
    ['a.js', { imports: ['b.js'], exports: ['foo'] }],
    ['b.js', { imports: [], exports: ['bar'] }],
  ]);

  const analyzer = new GraphAnalyzer(dg);
  const ok = analyzer.restoreAggregateCache({
    version: 7,
    deadExports: [{ file: 'a.js', exports: ['foo'] }],
    unresolved: [{ file: 'b.js', import: 'c.js' }],
    cycles: [['a.js', 'b.js']],
    stats: { files: 2 },
    hotspots: [{ file: 'a.js', score: 10 }],
    stability: [{ file: 'b.js', score: 5 }],
  });
  assert.strictEqual(ok, true);
  assert.ok(analyzer._aggregateCache);
  assert.strictEqual(analyzer._aggregateCache.version, 7);
  assert.deepStrictEqual(analyzer._aggregateCache.deadExports, [{ file: 'a.js', exports: ['foo'] }]);
  assert.deepStrictEqual(analyzer._aggregateCache.unresolved, [{ file: 'b.js', import: 'c.js' }]);
  assert.deepStrictEqual(analyzer._aggregateCache.stats, { files: 2 });
  assert.deepStrictEqual(analyzer._aggregateCache.hotspots, [{ file: 'a.js', score: 10 }]);
  assert.deepStrictEqual(analyzer._aggregateCache.stability, [{ file: 'b.js', score: 5 }]);
  // Cycle cache must stay in sync after restore
  assert.deepStrictEqual(analyzer._cachedCycles, [['a.js', 'b.js']]);
  assert.strictEqual(analyzer._cycleCount, 1);

  // Invalid input should be rejected gracefully
  assert.strictEqual(analyzer.restoreAggregateCache(null), false);
  assert.strictEqual(analyzer.restoreAggregateCache('string'), false);
}

function testAnalyzerSetOverviewData() {
  const dg = mockDepGraph([['a.js', { imports: [], exports: [] }]]);
  const analyzer = new GraphAnalyzer(dg);

  // When no aggregate cache exists, setOverviewData creates a skeleton
  analyzer.setOverviewData({ hotspots: [{ file: 'a.js', score: 5 }], stability: [{ file: 'a.js', score: 3 }] });
  assert.ok(analyzer._aggregateCache);
  assert.strictEqual(analyzer._aggregateCache.version, analyzer._aggregateVersion);
  assert.deepStrictEqual(analyzer._aggregateCache.hotspots, [{ file: 'a.js', score: 5 }]);
  assert.deepStrictEqual(analyzer._aggregateCache.stability, [{ file: 'a.js', score: 3 }]);
  assert.deepStrictEqual(analyzer._aggregateCache.deadExports, []);
  assert.deepStrictEqual(analyzer._aggregateCache.cycles, []);

  // When cache exists, only overview fields are updated
  analyzer._aggregateCache = { version: 3, deadExports: ['x'], unresolved: [], cycles: [], stats: {}, hotspots: null, stability: null };
  analyzer.setOverviewData({ hotspots: [{ file: 'b.js', score: 9 }] });
  assert.deepStrictEqual(analyzer._aggregateCache.hotspots, [{ file: 'b.js', score: 9 }]);
  assert.strictEqual(analyzer._aggregateCache.stability, null);
  assert.deepStrictEqual(analyzer._aggregateCache.deadExports, ['x']); // preserved
}

function testFindDeadExportsClearsScanContentCache() {
  const dg = mockDepGraph([
    ['a.js', { imports: [], exports: ['foo'] }],
  ]);
  const analyzer = new GraphAnalyzer(dg);
  // Pre-fill the cache as if a prior scan had loaded content
  analyzer._scanContentCache.set('a.js', 'export const foo = 1;');
  assert.strictEqual(analyzer._scanContentCache.size, 1);

  // Force recomputation so the loop runs
  analyzer.findDeadExports({ skipCache: true });

  // Cache must be cleared after findDeadExports returns
  assert.strictEqual(analyzer._scanContentCache.size, 0, '_scanContentCache should be cleared after findDeadExports');
}

function testGraphDBPrecomputedMetrics() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  const metrics = [
    { file: 'a.js', dimension: 'pagerank', value: 0.15 },
    { file: 'b.js', dimension: 'hotspot', value: 25.5 }
  ];

  assert.strictEqual(db.saveMetrics(metrics), true);
  const loaded = db.loadMetrics();
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, 2);
  // SQLite order isn't guaranteed, sort to be safe
  loaded.sort((x, y) => x.file.localeCompare(y.file));
  assert.strictEqual(loaded[0].file, 'a.js');
  assert.strictEqual(loaded[0].dimension, 'pagerank');
  assert.strictEqual(loaded[0].value, 0.15);

  const loadedForFiles = db.loadMetricsForFiles(['b.js']);
  assert.strictEqual(loadedForFiles.length, 1);
  assert.strictEqual(loadedForFiles[0].file, 'b.js');
  assert.strictEqual(loadedForFiles[0].dimension, 'hotspot');
  assert.strictEqual(loadedForFiles[0].value, 25.5);

  db.close();
  fs.unlinkSync(dbPath);
}

function testGraphDBPrecomputedTestMap() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  const testMaps = [
    { source: 'a.js', testFile: 'a.test.js', signal: 'import', distance: 1 },
    { source: 'b.js', testFile: 'b.test.js', signal: 'heuristic', distance: 2 }
  ];

  assert.strictEqual(db.saveTestMap(testMaps), true);
  const loaded = db.loadTestMap();
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, 2);
  loaded.sort((x, y) => x.source.localeCompare(y.source));
  assert.strictEqual(loaded[0].source, 'a.js');
  assert.strictEqual(loaded[0].testFile, 'a.test.js');
  assert.strictEqual(loaded[0].signal, 'import');
  assert.strictEqual(loaded[0].distance, 1);

  const loadedForFiles = db.loadTestMapForFiles(['b.js']);
  assert.strictEqual(loadedForFiles.length, 1);
  assert.strictEqual(loadedForFiles[0].source, 'b.js');
  assert.strictEqual(loadedForFiles[0].testFile, 'b.test.js');
  assert.strictEqual(loadedForFiles[0].signal, 'heuristic');
  assert.strictEqual(loadedForFiles[0].distance, 2);

  db.close();
  fs.unlinkSync(dbPath);
}

function testAnalyzerInjectPrecomputedMetrics() {
  const dg = mockDepGraph([['a.js', { imports: [], exports: [] }]]);
  const analyzer = new GraphAnalyzer(dg);

  const metricsRows = [
    { file: 'a.js', dimension: 'pagerank', value: 0.85 },
    { file: 'b.js', dimension: 'hotspot', value: 12.0 },
  ];

  assert.strictEqual(analyzer.injectPrecomputedMetrics(metricsRows), true);
  assert.strictEqual(analyzer.getPageRank('a.js'), 0.85);
  // b.js pagerank was injected but is it retrieved via getPageRank? 
  // Let's verify getPageRank returns 0 for non-existent or 0.
}

function testAnalyzerInjectPrecomputedTestMap() {
  const dg = mockDepGraph([
    ['a.js', { imports: [], exports: [] }],
    ['b.js', { imports: [], exports: [] }],
    ['a.test.js', { imports: [], exports: [] }],
  ]);
  const analyzer = new GraphAnalyzer(dg);

  const testMapRows = [
    { source: 'a.js', testFile: 'a.test.js', signal: 'import', distance: 1 },
    { source: 'a.js', testFile: 'b.test.js', signal: 'heuristic', distance: 2 },
  ];

  assert.strictEqual(analyzer.injectPrecomputedTestMap(testMapRows), true);

  const resultsMax1 = analyzer.findAffectedTests('a.js', 1);
  assert.strictEqual(resultsMax1.length, 1);
  assert.strictEqual(resultsMax1[0].file, 'a.test.js');
  assert.strictEqual(resultsMax1[0].distance, 1);
  assert.strictEqual(resultsMax1[0].source, 'graph');

  const resultsMax2 = analyzer.findAffectedTests('a.js', 2);
  assert.strictEqual(resultsMax2.length, 2);
  resultsMax2.sort((x, y) => x.file.localeCompare(y.file));
  assert.strictEqual(resultsMax2[0].file, 'a.test.js');
  assert.strictEqual(resultsMax2[0].distance, 1);
  assert.strictEqual(resultsMax2[0].source, 'graph');
  assert.strictEqual(resultsMax2[1].file, 'b.test.js');
  assert.strictEqual(resultsMax2[1].distance, 2);
  assert.strictEqual(resultsMax2[1].source, 'heuristic');
}

// --- Run all ---

const tests = [
  testGraphDBPrecomputedAggregates,
  testGraphDBPrecomputedImpact,
  testAnalyzerPrecomputeImpact,
  testAnalyzerInjectPrecomputed,
  testAnalyzerInjectPrecomputedCorruptedRow,
  testAnalyzerRestoreAggregateCache,
  testAnalyzerSetOverviewData,
  testFindDeadExportsClearsScanContentCache,
  testGraphDBPrecomputedMetrics,
  testGraphDBPrecomputedTestMap,
  testAnalyzerInjectPrecomputedMetrics,
  testAnalyzerInjectPrecomputedTestMap,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
    passed++;
    console.log(`  PASS: ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${t.name} —`, e.message);
  }
}

console.log(`\n${passed}/${tests.length} passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);

