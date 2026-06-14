#!/usr/bin/env node
/**
 * 跨文件分析 CLI 测试
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runCliInProcess, cleanupTempDir } = require('./test-helpers');

async function main() {


  // 创建临时测试文件
  const testDir = path.join(os.tmpdir(), 'wb-test-analysis-' + crypto.randomBytes(4).toString('hex'));
  const testFile = path.join(testDir, 'test-module.js');
  const testUnusedFile = path.join(testDir, 'unused-module.js');
  const partialExportsFile = path.join(testDir, 'partial-exports.js');
  const partialConsumerFile = path.join(testDir, 'partial-consumer.js');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 项目根标记，确保 CLI 正确识别扫描范围
  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'analysis-test', version: '1.0.0' }, null, 2));

  // 创建一个有导出但未使用的文件
  fs.writeFileSync(testUnusedFile, [
    '// 这个文件的导出未被使用',
    'export function unusedHelper() {',
    "  return 'I am not used';",
    '}',
    '',
    'export const UNUSED_CONST = 42;',
    '',
  ].join('\n'));

  // 创建一个导入不存在的模块的文件
  fs.writeFileSync(testFile, [
    '// 导入不存在的模块',
    "import { something } from './non-existent-module';",
    "import fs from 'fs';",

    '',
    'export function test() {',
    '  return something;',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(partialExportsFile, [
    'export function usedHelper() {',
    "  return 'used';",
    '}',
    '',
    'export function unusedHelperTwo() {',
    "  return 'unused';",
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(partialConsumerFile, [
    "import { usedHelper } from './partial-exports';",
    '',
    'export function run() {',
    '  return usedHelper();',
    '}',
    '',
  ].join('\n'));

  try {

    const deadExports = await runCliInProcess(['dead-exports', '--cwd', testDir, '--json', '--quiet']);
    assert(Array.isArray(deadExports.deadExports), 'deadExports should be an array');
    assert(deadExports.deadExportsCount >= 1, `deadExportsCount should be >= 1, got ${deadExports.deadExportsCount}`);
    const partialEntry = deadExports.deadExports.find(item => path.basename(item.file) === 'partial-exports.js');
    assert(partialEntry, 'partial-exports.js should be reported');
    assert(partialEntry.exports.includes('unusedHelperTwo'), 'unusedHelperTwo should be reported as dead export');
    assert(!partialEntry.exports.includes('usedHelper'), 'usedHelper should not be reported as dead export');



    const unresolved = await runCliInProcess(['unresolved', '--cwd', testDir, '--json', '--quiet']);
    assert(Array.isArray(unresolved.unresolved), 'unresolved should be an array');
    assert(unresolved.unresolvedCount >= 1, `unresolvedCount should be >= 1, got ${unresolved.unresolvedCount}`);



    const affectedTests = await runCliInProcess(['affected-tests', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
    assert(Array.isArray(affectedTests.affectedTests), 'affectedTests should be an array');
    assert(affectedTests.affectedTestsCount >= 0, `affectedTestsCount should be >= 0, got ${affectedTests.affectedTestsCount}`);



    const limitedAffectedTests = await runCliInProcess(['affected-tests', '--cwd', '.', '--file', 'src/services/container.js', '--max-depth', '2', '--json', '--quiet']);
    assert(limitedAffectedTests.maxDepth === 2, 'maxDepth should be 2');
    // graph source 的结果受 maxDepth 约束；mention/heuristic 的 distance 语义为 maxDepth+1，表示超出直接依赖图范围
    const graphTests = limitedAffectedTests.affectedTests.filter(t => t.source === 'graph');
    const allGraphWithinDepth = graphTests.every(t => t.distance <= 2);
    assert(allGraphWithinDepth, 'All graph-sourced affected tests should be within maxDepth');


    const impact = await runCliInProcess(['impact', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
    assert(impact.impactCount >= 0, `impactCount should be >= 0, got ${impact.impactCount}`);
    assert(impact.symbolImpact, 'symbolImpact should exist');
    assert(['symbol', 'file-fallback'].includes(impact.symbolImpact.mode), 'symbolImpact.mode should be valid');
    const transitiveInImpact = (impact.impact || []).filter((e) => e.level >= 2);
    assert.strictEqual(
      impact.symbolImpact.transitiveCount,
      transitiveInImpact.length,
      'transitiveCount should match count of level>=2 items in impact array'
    );



  } finally {
    try {
      fs.unlinkSync(testFile);
      fs.unlinkSync(testUnusedFile);
      fs.unlinkSync(partialExportsFile);
      fs.unlinkSync(partialConsumerFile);
      cleanupTempDir(testDir);
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

main();
