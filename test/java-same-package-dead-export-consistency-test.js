#!/usr/bin/env node
// @contract
// L1-3: Java same-package 隐式边（tier3）在 build 路径与 loadGraph 路径下的
// dead-exports 语义必须一致（TECH_DEBT L1-3，2026-07-20 发现）：
// - tier3 same-package 记录不参与「已使用」判定（与 cycles Rule 5 先例一致，analyzer.js:646）
// - 真实同包引用由 importer 内容扫描兜底（Spring DI 等文本可见引用不误报）
// - 仅剩隐式 importer 的死导出报出，但 confidence=low + confidenceSource='implicit-same-package'
// - warm 路径（loadGraph 恢复态：有边、无 tier3/tier1-resolved 记录）重跑
//   expandJavaPackageImports 后与 cold 路径结果完全一致（orchestrator.js 负责挂钩；
//   持久化聚合的失效由 CACHE_VERSION bump 保证）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function javaEntry(filePath, className, pkg, extras = {}) {
  return {
    originalPath: filePath,
    imports: [],
    exports: [className],
    importRecords: [],
    exportRecords: [{ name: className }],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    package: pkg,
    ...extras,
  };
}

function findByFile(deadExports, basename) {
  return deadExports.find((d) => d.file.includes(basename));
}

// cold 路径：build + postProcess 展开 → 同包死类必须报出（低置信），不再被掩盖
async function testColdPathReportsSamePackageDeadClass() {
  const tmpDir = makeTempDir('wb-l13-cold-');
  const fooPath = path.join(tmpDir, 'Foo.java');
  const barPath = path.join(tmpDir, 'Bar.java');
  fs.writeFileSync(fooPath, 'public class Foo { public void run() {} }\n');
  fs.writeFileSync(barPath, 'public class Bar { public void idle() {} }\n');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [fooPath]: javaEntry(fooPath, 'Foo', 'com.example'),
    [barPath]: javaEntry(barPath, 'Bar', 'com.example'),
  });
  await depGraph.builder.expandJavaPackageImports();

  const dead = depGraph.findDeadExports();
  const bar = findByFile(dead, 'Bar.java');
  assert(bar, 'same-package dead class must be visible on the build path (was masked by tier3 usesAllExports)');
  assert.strictEqual(bar.confidence, 'low', 'implicit-only importers must downgrade to low confidence');
  assert.strictEqual(bar.confidenceSource, 'implicit-same-package');

  cleanupTempDir(tmpDir);
}

// warm 路径恢复态（有同包边、无 tier3 记录）重跑展开后与 cold 一致
async function testWarmPathMatchesColdAfterReExpansion() {
  const tmpDir = makeTempDir('wb-l13-warm-');
  const fooPath = path.join(tmpDir, 'Foo.java');
  const barPath = path.join(tmpDir, 'Bar.java');
  fs.writeFileSync(fooPath, 'public class Foo { public void run() {} }\n');
  fs.writeFileSync(barPath, 'public class Bar { public void idle() {} }\n');

  // 模拟 loadGraph 恢复态：edges 表带回同包边，parse_results 不含 tier3 记录
  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [fooPath]: javaEntry(fooPath, 'Foo', 'com.example', { imports: [barPath] }),
    [barPath]: javaEntry(barPath, 'Bar', 'com.example', { imports: [fooPath] }),
  });
  // orchestrator 在 loadGraph 成功后重跑展开（L1-3 修复挂钩）
  await depGraph.builder.expandJavaPackageImports();

  const dead = depGraph.findDeadExports();
  const bar = findByFile(dead, 'Bar.java');
  assert(bar, 'warm path must report the same dead class as cold path');
  assert.strictEqual(bar.confidence, 'low');
  assert.strictEqual(bar.confidenceSource, 'implicit-same-package');

  cleanupTempDir(tmpDir);
}

// 同包真实引用（文本可见，如 Spring 注入字段/直接 new）不误报——内容扫描兜底
async function testRealSamePackageUsageStillSuppressed() {
  const tmpDir = makeTempDir('wb-l13-real-');
  const barPath = path.join(tmpDir, 'Bar.java');
  const consumerPath = path.join(tmpDir, 'Consumer.java');
  fs.writeFileSync(barPath, 'public class Bar { public void idle() {} }\n');
  fs.writeFileSync(consumerPath, 'public class Consumer { private Bar bar = new Bar(); }\n');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [barPath]: javaEntry(barPath, 'Bar', 'com.example'),
    [consumerPath]: javaEntry(consumerPath, 'Consumer', 'com.example'),
  });
  await depGraph.builder.expandJavaPackageImports();

  const dead = depGraph.findDeadExports();
  const bar = findByFile(dead, 'Bar.java');
  assert(!bar || !bar.exports.includes('Bar'), 'Bar is referenced in Consumer source; content scan must suppress the finding');

  cleanupTempDir(tmpDir);
}

// wildcard import（tier1）语义不变：cold / warm 重展开后都视为「使用全部导出」
async function testWildcardSuppressionConsistentAcrossPaths() {
  const tmpDir = makeTempDir('wb-l13-wild-');
  const utilPath = path.join(tmpDir, 'Util.java');
  const appPath = path.join(tmpDir, 'App.java');
  fs.writeFileSync(utilPath, 'public class Util { public void helper() {} }\n');
  fs.writeFileSync(appPath, 'import com.other.*;\npublic class App { public void main() {} }\n');

  const wildcardRecord = { source: 'com.other.*', imported: [], usesAllExports: true, resolved: null };

  // cold：展开产生 tier1 resolved 记录
  const cold = DependencyGraph.fromSchema(tmpDir, {
    [utilPath]: javaEntry(utilPath, 'Util', 'com.other'),
    [appPath]: javaEntry(appPath, 'App', 'com.app', { importRecords: [wildcardRecord] }),
  });
  await cold.builder.expandJavaPackageImports();
  assert(!findByFile(cold.findDeadExports(), 'Util.java'), 'cold: wildcard-imported class must not be dead');

  // warm 恢复态：边在、tier1 resolved 记录缺失 → 重展开后必须同样被抑制
  const warm = DependencyGraph.fromSchema(tmpDir, {
    [utilPath]: javaEntry(utilPath, 'Util', 'com.other'),
    [appPath]: javaEntry(appPath, 'App', 'com.app', {
      imports: [utilPath],
      importRecords: [{ ...wildcardRecord }],
    }),
  });
  await warm.builder.expandJavaPackageImports();
  assert(!findByFile(warm.findDeadExports(), 'Util.java'), 'warm: wildcard-imported class must not be dead after re-expansion');

  cleanupTempDir(tmpDir);
}

async function main() {
  await testColdPathReportsSamePackageDeadClass();
  await testWarmPathMatchesColdAfterReExpansion();
  await testRealSamePackageUsageStillSuppressed();
  await testWildcardSuppressionConsistentAcrossPaths();
  console.log('java-same-package-dead-export-consistency-test: all passed');
}

main();
