#!/usr/bin/env node
// @semantic — 降级解析（regex-fallback）下 0-importer 死导出不得拿 high confidence
// 复现 2026-07-20 dogfood 问题：无 javalang 的 Java 仓库，dead-exports 对
// regex fallback 解析的 0-importer 文件照样报 high confidence + safeToDelete，
// 违反 L1-4（静默错误必须显式）。regex-native 语言（C/C++/Svelte）不受连坐。
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');
const { computeDeadExportConfidence } = require('../src/services/dep-graph/shared');

function n(p) {
  return normalizePathKey(p);
}

function testZeroImporterRegexFallbackDowngraded() {
  const file = n('/repo/Service.java');
  const dg = createMockDepGraph({
    schema: {
      [file]: {
        imports: [], exports: ['doThing'], importRecords: [], exportRecords: [{ name: 'doThing' }],
        parseMode: 'regex', parseModeReason: 'regex-fallback', confidence: 'medium',
      },
      // healthy edge ratio so the graph-sparse guard does NOT fire —
      // the downgrade must come from parseModeReason, not edge scarcity
      [n('/repo/a.js')]: { imports: [n('/repo/b.js')], exports: [], importRecords: [{ source: './b', imported: [], resolved: n('/repo/b.js') }], exportRecords: [], parseMode: 'ast', parseModeReason: 'ast-success' },
      [n('/repo/b.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', parseModeReason: 'ast-success' },
    }
  });

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file || d.file.endsWith('Service.java'));
  assert(item, 'should report dead export candidate');
  assert.strictEqual(item.confidence, 'low', 'regex-fallback 0-importer must be low confidence');
  assert.strictEqual(item.confidenceSource, 'regex-fallback', 'source must name the degradation');
  assert.ok(/parser|regex/i.test(item.confidenceReason), `reason should explain degradation: ${item.confidenceReason}`);
}

function testZeroImporterRegexNativeNotDowngraded() {
  const file = n('/repo/util.cpp');
  const dg = createMockDepGraph({
    schema: {
      [file]: {
        imports: [], exports: ['helper'], importRecords: [], exportRecords: [{ name: 'helper' }],
        parseMode: 'regex', parseModeReason: 'regex-native', confidence: 'medium',
      },
      [n('/repo/a.js')]: { imports: [n('/repo/b.js')], exports: [], importRecords: [{ source: './b', imported: [], resolved: n('/repo/b.js') }], exportRecords: [], parseMode: 'ast', parseModeReason: 'ast-success' },
      [n('/repo/b.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', parseModeReason: 'ast-success' },
    }
  });

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file || d.file.endsWith('util.cpp'));
  assert(item, 'should report dead export candidate');
  assert.strictEqual(item.confidence, 'high', 'regex-native 0-importer keeps high confidence (regex IS the native parser)');
  assert.strictEqual(item.confidenceSource, 'ast-no-importer');
}

function testPureFunctionContract() {
  const degraded = computeDeadExportConfidence(0, 'regex', false, 'regex-fallback');
  assert.strictEqual(degraded.confidence, 'low');
  assert.strictEqual(degraded.source, 'regex-fallback');

  const native = computeDeadExportConfidence(0, 'regex', false, 'regex-native');
  assert.strictEqual(native.confidence, 'high');
  assert.strictEqual(native.source, 'ast-no-importer');

  // 旧调用方式（3 参，无 parseModeReason）行为不变
  const legacy = computeDeadExportConfidence(0, 'ast', false);
  assert.strictEqual(legacy.confidence, 'high');
}

function testHonestyEngineDoesNotMarkSafeToDelete() {
  const { classifyDeadExports } = require('../src/tools/honesty-engine');
  const degradedFindings = [
    { file: '/repo/Service.java', exports: ['doThing'], confidence: 'low', confidenceSource: 'regex-fallback', importerCount: 0 },
  ];
  const classifications = classifyDeadExports(degradedFindings, null);
  const item = classifications[0].item;
  assert(item.safeToDelete !== true, 'regex-fallback degraded finding must NOT be safeToDelete');
}

function main() {
  testZeroImporterRegexFallbackDowngraded();
  testZeroImporterRegexNativeNotDowngraded();
  testPureFunctionContract();
  testHonestyEngineDoesNotMarkSafeToDelete();
  console.log('dead-export-regex-fallback-confidence-test: all assertions passed');
}

main();
