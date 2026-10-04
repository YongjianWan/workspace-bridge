// @semantic
// Analyzer 聚合缓存的内存语义 + analysis_snapshots 的行级版本闸。
const assert = require('assert');
const { GraphDB } = require('../src/services/graph-db');
const { GraphAnalyzer } = require('../src/services/dep-graph/analyzer');
const { Ledger } = require('../src/services/ledger');
const path = require('path');
const os = require('os');
const fs = require('fs');

function tmpDbPath() {
  return path.join(os.tmpdir(), `wb-precomputed-test-${Date.now()}.db`);
}

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
    root: process.cwd(),
    normalizeFilePath: (f) => f,
    bus: { emit: () => {}, on: () => {} },
    ledger: new Ledger(),
    getDependencies: (f) => graph.get(f)?.imports || [],
    getDependents: (f) => reverseGraph.get(f) || [],
    shouldExcludeCli: () => false,
    getFileInfo: (f) => graph.get(f),
    isTestLikeFile: (f) => f.includes('test'),
    isKnownEntryFile: () => false,
    _displayPath: (f) => f,
    cache: { getStats: () => ({ totalLines: 0 }) },
  };
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

// analysis_snapshots 必须受 CACHE_VERSION 门禁：旧版本语义算出的快照
// （dead-exports 口径等随版本变化）不得在版本 bump 后继续被
// buildProjectOverview 短路 / query-* 消费。行级 cache_version 戳 + load 门禁。
function testGraphDBAnalysisSnapshotVersionGate() {
  const dbPath = tmpDbPath();
  let db = new GraphDB(dbPath);
  assert.strictEqual(db.saveAnalysisSnapshot('overview', { marker: 1 }, 'head123', 10, 'cfg'), true);
  const fresh = db.loadAnalysisSnapshot('overview');
  assert.ok(fresh && fresh.data && fresh.data.marker === 1, 'current-version snapshot must load');
  db.close();

  // 模拟老 CACHE_VERSION 时代写入的快照行
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(dbPath);
  raw.prepare('UPDATE analysis_snapshots SET cache_version = cache_version - 1').run();
  raw.close();

  db = new GraphDB(dbPath);
  assert.strictEqual(db.loadAnalysisSnapshot('overview'), null, 'stale-version snapshot must NOT be served');
  db.close();
  fs.unlinkSync(dbPath);
}

// --- Run all ---

const tests = [
  testAnalyzerSetOverviewData,
  testFindDeadExportsClearsScanContentCache,
  testGraphDBAnalysisSnapshotVersionGate,
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

