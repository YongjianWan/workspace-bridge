#!/usr/bin/env node
// @contract
// CACHE_VERSION 门禁的唯一守门人是 loader.loadGraph 里的 edgeMeta 检查：
// GraphDB.loadAll 在版本不匹配时只返回 null、不删表，而 loadEdges / loadTestMap /
// loadMetrics / loadRoutes / loadPrecomputedImpact 全是直读表、无版本检查。
// 所以 edgeMeta 缺失时若放行，就等于用任意版本的持久化数据重建图——
// 正是 2026-07-23 那批 flaky 的病族（旧语义冒充新鲜）。
// 契约：edges 在但 edgeMeta 缺失/损坏 → 拒绝 warm load，回落冷建。
const assert = require('assert');
const { loadGraph } = require('../src/services/dep-graph/loader');
const { CACHE_VERSION } = require('../src/config/constants');

function makeDepGraph(edgeMeta) {
  const parseResults = new Map([['/repo/a.js', { imports: [], exports: [], parseMode: 'ast' }]]);
  const fileMetadata = new Map([['/repo/a.js', { originalPath: '/repo/a.js' }]]);
  return {
    quiet: true,
    graph: new Map(),
    reverseGraph: new Map(),
    bus: { emit: () => {}, on: () => {} },
    builder: { _buildSymbolRegistry: () => {} },
    _finishBuilding: () => {},
    analyzer: {
      injectPrecomputedMetrics: () => {},
      injectPrecomputedTestMap: () => {},
      injectPrecomputedImpact: () => {},
    },
    cache: {
      edgeMeta,
      parseResults,
      fileMetadata,
      getFileMetadata: (f) => fileMetadata.get(f),
      loadEdges: () => [{ source: '/repo/a.js', target: '/repo/b.js', edgeType: 'import' }],
      loadPrecomputedImpact: () => null,
      loadMetrics: () => null,
      loadTestMap: () => null,
      loadPrecomputedAggregates: () => null,
      loadRoutes: () => null,
    },
  };
}

function freshMeta(overrides = {}) {
  return {
    cacheVersion: CACHE_VERSION,
    fileMetadataCount: 1,
    parseResultsCount: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

// 基线：完好的 edgeMeta 必须放行，否则后面的拒绝断言毫无意义
function testValidMetaLoads() {
  const dg = makeDepGraph(freshMeta());
  assert.strictEqual(loadGraph(dg, { skipChangeCheck: true }), true, 'valid edgeMeta must load');
}

// edgeMeta 缺失 = 不可信，不是「没检查项就放行」
function testMissingMetaRejected() {
  for (const missing of [null, undefined]) {
    const dg = makeDepGraph(missing);
    assert.strictEqual(
      loadGraph(dg, { skipChangeCheck: true }),
      false,
      `edges present but edgeMeta ${String(missing)} must fall back to cold build (CACHE_VERSION gate would be skipped entirely)`
    );
    assert.strictEqual(dg.graph.size, 0, 'rejected load must not leave a half-built graph');
  }
}

// 版本不匹配照旧拒绝（回归保护）
function testStaleVersionRejected() {
  const dg = makeDepGraph(freshMeta({ cacheVersion: CACHE_VERSION - 1 }));
  assert.strictEqual(loadGraph(dg, { skipChangeCheck: true }), false, 'stale cacheVersion must be rejected');
}

function main() {
  testValidMetaLoads();
  testMissingMetaRejected();
  testStaleVersionRejected();
  console.log('loader-edge-meta-gate-test: all passed');
}

main();
