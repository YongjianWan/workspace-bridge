#!/usr/bin/env node
// @contract
// savePrecomputed 的 test_map 写入是「全量重算」语义：saveTestMap 走 _saveBatch
// （DELETE 全表 + INSERT）。所以新图算不出任何 test_map 时如果跳过写入，
// DB 里留下的就是上一次 build 的映射，而内存已被清空——下一个进程
// restorePrecomputed 把旧图的映射注入 analyzer，旧语义冒充新鲜（wave8 病族）。
// routes 早就有同样的注释和处理（persistence.js: "Always call saveRoutes so stale
// routes are cleared"），test_map 漏了。
// 契约：无论新图算出多少行，test_map 都必须被无条件重写。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GraphDB } = require('../src/services/graph-db');
const { savePrecomputed } = require('../src/services/dep-graph/persistence');

function tmpDbPath() {
  return path.join(os.tmpdir(), `wb-testmap-clear-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// 一个「新图什么 test 都影响不到」的最小 depGraph：findAffectedTests 恒返回 []
function makeDepGraph(db) {
  const injected = [];
  return {
    injected,
    cache: db,
    graph: new Map([['/repo/src/a.js', { imports: [], exports: [] }]]),
    isTestLikeFile: (f) => f.includes('test'),
    normalizeFilePath: (f) => f,
    analyzer: {
      getAggregateCache: () => null,
      getAggregateVersion: () => 1,
      _impactCache: new Map(),
      _impactVersion: 1,
      _pageRanks: null,
      findAffectedTests: () => [],
      injectPrecomputedTestMap: (rows) => {
        injected.push(rows);
        return true;
      },
    },
  };
}

async function testStaleTestMapIsCleared() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  // 上一次 build 的映射
  assert.strictEqual(
    db.saveTestMap([{ source: '/repo/src/old.js', testFile: '/repo/test/old-test.js', signal: 'import', distance: 1 }]),
    true
  );
  assert.strictEqual((db.loadTestMap() || []).length, 1, 'fixture: stale row must be seeded');

  const depGraph = makeDepGraph(db);
  await savePrecomputed(depGraph);

  const remaining = db.loadTestMap() || [];
  assert.strictEqual(
    remaining.length,
    0,
    `stale test_map rows must be cleared when the new graph yields none, got ${JSON.stringify(remaining)}`
  );

  // 内存态与 DB 一致：都是空
  const lastInjected = depGraph.injected[depGraph.injected.length - 1];
  assert.deepStrictEqual(lastInjected, [], 'in-memory map must end up consistent with the (now empty) table');

  db.close();
  fs.unlinkSync(dbPath);
}

// 回归保护：有内容时照常落盘并回填内存
async function testNonEmptyTestMapStillRoundTrips() {
  const dbPath = tmpDbPath();
  const db = new GraphDB(dbPath);

  const depGraph = makeDepGraph(db);
  depGraph.analyzer.findAffectedTests = () => [{ file: '/repo/test/a-test.js', distance: 1, source: 'graph' }];

  await savePrecomputed(depGraph);

  const rows = db.loadTestMap() || [];
  assert.strictEqual(rows.length, 1, `expected the computed row to persist, got ${JSON.stringify(rows)}`);
  assert.strictEqual(rows[0].testFile, '/repo/test/a-test.js');
  const lastInjected = depGraph.injected[depGraph.injected.length - 1];
  assert.strictEqual(lastInjected.length, 1, 'computed map must be re-injected into the analyzer');

  db.close();
  fs.unlinkSync(dbPath);
}

async function main() {
  await testStaleTestMapIsCleared();
  await testNonEmptyTestMapStillRoundTrips();
  console.log('savepre-testmap-stale-clear-test: all passed');
}

main();
