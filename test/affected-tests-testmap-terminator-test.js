#!/usr/bin/env node
// @contract
// wave8 flaky 根因（2026-07-23，两层）：findAffectedTests 的 _testMapCache fast path
// 1. 终结符条目（heuristic/mention）的哨兵 distance 被当真实距离参与深度过滤
// 2. 预计算按 depth 3 落库、查询默认 depth 5——map 是按深度参数化的答案，
//    fast path 却拿它回答任意深度（深图条目在浅查询里会被冷路径重分类为 mention，
//    行级过滤永远无法复现），实测 cold 44 vs warm 16/23。
// 契约：
// - fast path 仅在 maxDepth === CONFIG.DEFAULT_MAX_DEPTH（预计算深度）时服务
// - 匹配深度下条目原样直出：graph 条目不过滤，终结符 distance=maxDepth+1 + terminator: true
// - 外来深度完全绕过 fast path，走活计算（预计算内容不得泄漏进结果）
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');
const { DEFAULTS } = require('../src/config/defaults');

const DEFAULT_DEPTH = DEFAULTS.AFFECTED_TEST_DEPTH;

function n(p) {
  return normalizePathKey(p);
}

const fooKey = n('/repo/src/foo.js');
const graphTestKey = n('/repo/test/foo-direct-test.js');
const deepTestKey = n('/repo/test/foo-deep-test.js');
const mentionTestKey = n('/repo/test/foo-mention-test.js');
const heuristicTestKey = n('/repo/test/foo-heuristic-test.js');

function entry(exports) {
  return {
    imports: [],
    exports,
    importRecords: [],
    exportRecords: exports.map((name) => ({ name })),
    parseMode: 'ast',
    confidence: 'high',
  };
}

function makeGraphWithTestMap() {
  const depGraph = createMockDepGraph({
    schema: {
      [fooKey]: entry(['foo']),
      [graphTestKey]: entry([]),
      [deepTestKey]: entry([]),
      [mentionTestKey]: entry([]),
      [heuristicTestKey]: entry([]),
    },
  });
  // 模拟 restorePrecomputed 注入的 warm 测试映射（预计算深度 = DEFAULT_DEPTH，
  // 终结符哨兵 distance = DEFAULT_DEPTH + 1）
  depGraph.analyzer.injectPrecomputedTestMap([
    { source: fooKey, testFile: graphTestKey, distance: 1, signal: 'import' },
    { source: fooKey, testFile: deepTestKey, distance: DEFAULT_DEPTH, signal: 'import' },
    { source: fooKey, testFile: mentionTestKey, distance: DEFAULT_DEPTH + 1, signal: 'mention' },
    { source: fooKey, testFile: heuristicTestKey, distance: DEFAULT_DEPTH + 1, signal: 'heuristic' },
  ]);
  return depGraph;
}

function bySource(results) {
  const m = {};
  for (const r of results) m[r.source] = m[r.source] || [];
  for (const r of results) m[r.source].push(r);
  return m;
}

// 匹配深度：map 原样直出，终结符 schema 与冷路径逐字段一致
function testMatchingDepthServesFullMap() {
  const depGraph = makeGraphWithTestMap();
  const results = depGraph.findAffectedTests(fooKey, DEFAULT_DEPTH);

  assert.strictEqual(results.length, 4, `matching-depth query must serve the full map, got ${JSON.stringify(results.map((r) => r.file))}`);
  const { graph, mention, heuristic } = bySource(results);
  assert.strictEqual(graph.length, 2, 'both import rows must pass through unfiltered');
  const distances = graph.map((g) => g.distance).sort();
  assert.deepStrictEqual(distances, [1, DEFAULT_DEPTH]);
  assert.strictEqual(mention[0].distance, DEFAULT_DEPTH + 1, 'mention distance must be maxDepth+1 (cold-path parity)');
  assert.strictEqual(mention[0].terminator, true, 'mention entry must carry terminator: true');
  assert.deepStrictEqual(mention[0].via, ['mention:stem']);
  assert.strictEqual(heuristic[0].distance, DEFAULT_DEPTH + 1);
  assert.strictEqual(heuristic[0].terminator, true);
  assert.deepStrictEqual(heuristic[0].via, ['heuristic:naming']);
}

// 外来深度：fast path 必须完全绕过——预计算条目一条都不许泄漏进结果
function testForeignDepthBypassesFastPath() {
  const depGraph = makeGraphWithTestMap();
  const results = depGraph.findAffectedTests(fooKey, 1);

  const injected = new Set([graphTestKey, deepTestKey, mentionTestKey, heuristicTestKey]);
  for (const r of results) {
    assert.ok(
      !injected.has(n(r.file)) || r.source !== 'graph' || r.distance <= 1,
      `foreign-depth query leaked precomputed row: ${JSON.stringify(r)}`
    );
  }
  // mock 文件不存在于磁盘、无 import 边：活计算不可能产出 mention 条目
  assert.ok(
    !results.some((r) => n(r.file) === mentionTestKey),
    'precomputed mention row must not be served at a foreign depth'
  );
  assert.ok(
    !results.some((r) => r.source === 'graph' && n(r.file) === deepTestKey),
    'deep import row must not be served at a foreign depth'
  );
}

// includeHeuristic: false 时 fast path 不服务（既有语义回归保护）
function testIncludeHeuristicFalseSkipsFastPath() {
  const depGraph = makeGraphWithTestMap();
  const results = depGraph.findAffectedTests(fooKey, DEFAULT_DEPTH, { includeHeuristic: false });
  assert.ok(
    !results.some((r) => r.source === 'mention' || r.source === 'heuristic'),
    'includeHeuristic: false must not emit terminator entries'
  );
}

function main() {
  testMatchingDepthServesFullMap();
  testForeignDepthBypassesFastPath();
  testIncludeHeuristicFalseSkipsFastPath();
  console.log('affected-tests-testmap-terminator-test: all passed');
}

main();
