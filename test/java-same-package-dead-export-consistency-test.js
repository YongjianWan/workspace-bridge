#!/usr/bin/env node
// @fast
// @contract
// Java same-package 隐式边（tier3）的 dead-exports 语义：
// - tier3 same-package 记录不参与「已使用」判定（与 cycles Rule 5 先例一致，analyzer.js:646）
// - 真实同包引用由 importer 内容扫描兜底（Spring DI 等文本可见引用不误报）
// - 仅剩隐式 importer 的死导出报出，但 confidence=low + confidenceSource='implicit-same-package'
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
  await testRealSamePackageUsageStillSuppressed();
  await testWildcardSuppressionConsistentAcrossPaths();
  console.log('java-same-package-dead-export-consistency-test: all passed');
}

main();
