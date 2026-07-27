#!/usr/bin/env node
// @semantic @slow — two full ServiceContainer lifecycles (cold build + warm load)
// warm 与 cold 必须产出逐字节相同的可观察结果。
//
// 这条断言存在的理由：build() 的后处理是一串步骤，loadGraph() 只恢复图结构，
// 两边靠人记得同步。已经出现两例——L1-3（java 同包展开）和符号表重建——每一次
// 的修法都是"在 warm 分支再补一句"，然后靠一条锁调用顺序的接线测试事后捕捉。
// 接线测试锁的是症状；这条锁的是契约：不管内部怎么改，两条路径的输出必须一致。
//
// 新增任何后处理步骤时，如果它只在 cold 生效，这里会红——不需要为它单独写测试。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

// Without this counter the whole test degrades into "cold equals cold" the day
// the warm path silently falls back to build() — it would stay green while the
// thing it exists to protect is gone.
let buildCalls = 0;
const originalBuild = DependencyGraph.prototype.build;
DependencyGraph.prototype.build = function countedBuild(...args) {
  buildCalls++;
  return originalBuild.apply(this, args);
};

function writeFixture(root) {
  const src = path.join(root, 'src');
  const tests = path.join(root, 'test');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(tests, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'parity-fixture', version: '1.0.0' }));

  // A small but non-trivial shape: a barrel, a diamond, a re-export, a test file.
  fs.writeFileSync(path.join(src, 'util.js'), 'function helper() { return 1; }\nmodule.exports = { helper };\n');
  fs.writeFileSync(path.join(src, 'core.js'), "const { helper } = require('./util');\nfunction core() { return helper() + 1; }\nmodule.exports = { core };\n");
  fs.writeFileSync(path.join(src, 'alt.js'), "const { helper } = require('./util');\nmodule.exports = { alt: () => helper() };\n");
  fs.writeFileSync(path.join(src, 'index.js'), "const { core } = require('./core');\nconst { alt } = require('./alt');\nmodule.exports = { core, alt };\n");
  fs.writeFileSync(path.join(tests, 'core-test.js'), "const { core } = require('../src/core');\nif (core() !== 2) throw new Error('boom');\n");
}

/**
 * Everything a consumer can observe about the graph, in a stable order.
 * Internal field-by-field comparison would break on every refactor; this is
 * the contract surface (edges, symbols, and the precomputed answers that
 * queries are served from).
 */
function observe(container) {
  const dg = container._depGraph;
  const files = dg.getAllFilePaths().slice().sort();

  const edges = [];
  for (const file of files) {
    for (const dep of (dg.getDependencies(file) || []).slice().sort()) {
      edges.push(`${path.basename(file)} -> ${path.basename(dep)}`);
    }
  }

  const dependents = files.map((f) => `${path.basename(f)}<-${(dg.getDependents(f) || []).length}`);

  const symbols = [];
  for (const [name, locations] of dg.symbolRegistry.exports) {
    const entry = locations
      .map((l) => `${path.basename(l.file)}|${l.isExported !== false}`)
      .sort()
      .join(',');
    symbols.push(`${name}:${entry}`);
  }
  symbols.sort();

  const affectedTests = (dg.analyzer.findAffectedTests
    ? dg.analyzer.findAffectedTests(files.find((f) => f.endsWith('util.js')))
    : null);
  // distance + source included deliberately: wave8 was a warm/cold divergence
  // in exactly those fields (cold 44 vs warm 16/23, graph rows demoted to
  // 'mention'), which a bare file-name comparison would have missed.
  const affected = affectedTests
    ? (affectedTests.tests || affectedTests)
      .map((t) => `${path.basename(t.file || t)}@${t.distance ?? '-'}/${t.source ?? '-'}`)
      .sort()
    : [];

  return {
    fileCount: files.length,
    edges,
    dependents,
    symbols,
    duplicateSymbols: dg.symbolRegistry.getRegistryStats().duplicateSymbols,
    affectedTestsOfUtil: affected,
  };
}

async function main() {
  const root = makeTempDir('wb-warm-cold-parity-');
  writeFixture(root);
  const cacheDir = path.join(root, '.cache');

  const cold = new ServiceContainer({ quiet: true, cacheDir });
  await cold.initialize(root, 120000, { watch: false });
  assert.strictEqual(buildCalls, 1, 'first start must be a real cold build');
  assert.ok(cold._depGraph.getFileCount() > 0, 'cold build must produce a non-empty graph');
  const coldView = observe(cold);
  await cold.shutdown();

  const warm = new ServiceContainer({ quiet: true, cacheDir });
  await warm.initialize(root, 120000, { watch: false });
  assert.strictEqual(
    buildCalls,
    1,
    'second start must take the warm path — a fallback to build() would make this comparison vacuous'
  );
  const warmView = observe(warm);
  await warm.shutdown();

  assert.deepStrictEqual(
    warmView,
    coldView,
    'warm start must observe exactly what a cold build observes'
  );

  cleanupTempDir(root);
  console.log('warm-cold-parity-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
