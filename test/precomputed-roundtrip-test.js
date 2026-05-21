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

  const records = [
    { file: 'a.js', directDeps: 1, transitiveDeps: 2, directDependents: 3, transitiveDependents: 4, affectedTests: JSON.stringify([{ file: 't.js', distance: 1 }]), version: 1 },
    { file: 'b.js', directDeps: 0, transitiveDeps: 0, directDependents: 0, transitiveDependents: 0, affectedTests: null, version: 1 },
  ];

  assert.strictEqual(db.savePrecomputedImpact(records), true);
  const loaded = db.loadPrecomputedImpact();
  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].file, 'a.js');
  assert.strictEqual(loaded[0].directDeps, 1);
  assert.strictEqual(loaded[0].transitiveDependents, 4);
  assert.deepStrictEqual(JSON.parse(loaded[0].affectedTests), [{ file: 't.js', distance: 1 }]);

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

  // Inject impact
  const impactRows = [
    { file: 'a.js', directDeps: 1, transitiveDeps: 1, directDependents: 0, transitiveDependents: 0, affectedTests: JSON.stringify([]), version: 1 },
  ];
  const okImp = analyzer.injectPrecomputedImpact(impactRows, 2);
  assert.strictEqual(okImp, true);
  const cached = analyzer.getPrecomputedImpact('a.js');
  assert.ok(cached);
  assert.strictEqual(cached.directDeps, 1);

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

// --- Run all ---

const tests = [
  testGraphDBPrecomputedAggregates,
  testGraphDBPrecomputedImpact,
  testAnalyzerPrecomputeImpact,
  testAnalyzerInjectPrecomputed,
  testAnalyzerInjectPrecomputedCorruptedRow,
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
