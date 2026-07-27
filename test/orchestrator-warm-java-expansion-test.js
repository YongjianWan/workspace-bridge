#!/usr/bin/env node
// @contract
// L1-3 的接线契约（补 2026-07-23 修复的测试缺口）：
// java-same-package-dead-export-consistency-test.js 锁的是 analyzer 语义——它自己
// 手动调 expandJavaPackageImports()，所以把 orchestrator 里的那次调用删掉，
// 那 4 个用例照样全绿。真正坏掉的是接线：loadGraph 成功后没人重跑展开。
// 契约：
// - warm 路径（loadGraph 返回 true）必须重跑 expandJavaPackageImports()
// - 且必须在增量 delta 更新之前跑（updateFiles 的 postProcess 要基于一致的基线）
// - cold 路径（loadGraph 返回 false）不得重复跑——build() 内部的 postProcess 已经做了
const assert = require('assert');
const { initializeDepGraph } = require('../src/services/orchestrator');

function makeHarness({ loaded, changedFiles = [] }) {
  const calls = [];
  const depGraph = {
    loadGraph: () => {
      calls.push('loadGraph');
      return loaded;
    },
    build: async () => {
      calls.push('build');
    },
    updateFiles: async () => {
      calls.push('updateFiles');
    },
    builder: {
      expandJavaPackageImports: async () => {
        calls.push('expandJavaPackageImports');
      },
    },
    analyzer: {
      precomputeAggregates: () => {
        calls.push('precomputeAggregates');
      },
    },
    normalizeFilePath: (f) => f,
    getAllFilePaths: () => [],
    getFileCount: () => 0,
    shouldExclude: () => false,
    shouldExcludeCli: () => false,
    _resetState: () => {},
    projectContext: null,
  };

  const args = {
    DependencyGraphClass: function () {
      return depGraph;
    },
    workspaceRoot: '/repo',
    cache: { hasFileMetadata: () => true },
    fileIndex: { _indexedFiles: [], changedFiles },
    projectContext: null,
    quiet: true,
  };

  return { calls, args };
}

async function testWarmPathReExpandsBeforeDelta() {
  const { calls, args } = makeHarness({ loaded: true, changedFiles: ['/repo/src/Foo.java'] });
  await initializeDepGraph(args);

  const expandAt = calls.indexOf('expandJavaPackageImports');
  assert.ok(
    expandAt !== -1,
    `warm path must re-run expandJavaPackageImports (L1-3 wiring), call sequence: ${JSON.stringify(calls)}`
  );
  const updateAt = calls.indexOf('updateFiles');
  assert.ok(updateAt !== -1, `delta update expected in this fixture, got ${JSON.stringify(calls)}`);
  assert.ok(
    expandAt < updateAt,
    `expansion must precede the incremental delta update, got ${JSON.stringify(calls)}`
  );
}

async function testWarmPathWithoutDeltaStillExpands() {
  const { calls, args } = makeHarness({ loaded: true });
  await initializeDepGraph(args);

  assert.ok(
    calls.includes('expandJavaPackageImports'),
    `fully warm start must still re-run the expansion, got ${JSON.stringify(calls)}`
  );
  assert.ok(calls.includes('precomputeAggregates'), `expected fully-warm branch, got ${JSON.stringify(calls)}`);
}

async function testColdPathDoesNotDoubleExpand() {
  const { calls, args } = makeHarness({ loaded: false });
  await initializeDepGraph(args);

  assert.ok(calls.includes('build'), `expected cold build, got ${JSON.stringify(calls)}`);
  assert.ok(
    !calls.includes('expandJavaPackageImports'),
    `cold path must not re-run the expansion (build()'s postProcess already did), got ${JSON.stringify(calls)}`
  );
}

async function main() {
  await testWarmPathReExpandsBeforeDelta();
  await testWarmPathWithoutDeltaStillExpands();
  await testColdPathDoesNotDoubleExpand();
  console.log('orchestrator-warm-java-expansion-test: all passed');
}

main();
