#!/usr/bin/env node
/**
 * 跨文件分析 CLI 测试
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function main() {
  console.log('=== workspace-bridge 跨文件分析 CLI 测试 ===\n');

  // 创建临时测试文件
  const testDir = path.join(__dirname, '..', 'fixture-temp');
  const testFile = path.join(testDir, 'test-module.js');
  const testUnusedFile = path.join(testDir, 'unused-module.js');
  const partialExportsFile = path.join(testDir, 'partial-exports.js');
  const partialConsumerFile = path.join(testDir, 'partial-consumer.js');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // 创建一个有导出但未使用的文件
  fs.writeFileSync(testUnusedFile, [
    '// 这个文件的导出未被使用',
    'ex' + 'port function unusedHelper() {',
    "  return 'I am not used';",
    '}',
    '',
    'ex' + 'port const UNUSED_CONST = 42;',
    '',
  ].join('\n'));

  // 创建一个导入不存在的模块的文件
  fs.writeFileSync(testFile, [
    '// 导入不存在的模块',
    "im" + "port { something } from './non-existent-module';",
    "im" + "port fs from 'fs';",
    '',
    'ex' + 'port function test() {',
    '  return something;',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(partialExportsFile, [
    'ex' + 'port function usedHelper() {',
    "  return 'used';",
    '}',
    '',
    'ex' + 'port function unusedHelperTwo() {',
    "  return 'unused';",
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(partialConsumerFile, [
    "im" + "port { usedHelper } from './partial-exports';",
    '',
    'ex' + 'port function run() {',
    '  return usedHelper();',
    '}',
    '',
  ].join('\n'));

  try {
    console.log('📋 Test Group: dead_exports');
    const deadExports = runCli(['dead-exports', '--cwd', '.', '--json', '--quiet']);
    assert(Array.isArray(deadExports.deadExports), 'deadExports should be an array');
    assert(typeof deadExports.deadExportsCount === 'number', 'deadExportsCount should be a number');
    const partialEntry = deadExports.deadExports.find(item => path.basename(item.file) === 'partial-exports.js');
    assert(partialEntry, 'partial-exports.js should be reported');
    assert(partialEntry.exports.includes('unusedHelperTwo'), 'unusedHelperTwo should be reported as dead export');
    assert(!partialEntry.exports.includes('usedHelper'), 'usedHelper should not be reported as dead export');
    console.log(`     Found ${deadExports.deadExportsCount} files with dead exports`);

    console.log('\n📋 Test Group: unresolved');
    const unresolved = runCli(['unresolved', '--cwd', '.', '--json', '--quiet']);
    assert(Array.isArray(unresolved.unresolved), 'unresolved should be an array');
    assert(typeof unresolved.unresolvedCount === 'number', 'unresolvedCount should be a number');
    console.log(`     Found ${unresolved.unresolvedCount} unresolved imports`);

    console.log('\n📋 Test Group: affected_tests');
    const affectedTests = runCli(['affected-tests', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
    assert(Array.isArray(affectedTests.affectedTests), 'affectedTests should be an array');
    assert(typeof affectedTests.affectedTestsCount === 'number', 'affectedTestsCount should be a number');
    console.log(`     Found ${affectedTests.affectedTestsCount} affected tests`);

    console.log('\n📋 Test Group: affected_tests with maxDepth');
    const limitedAffectedTests = runCli(['affected-tests', '--cwd', '.', '--file', 'src/services/container.js', '--max-depth', '2', '--json', '--quiet']);
    assert(limitedAffectedTests.maxDepth === 2, 'maxDepth should be 2');
    const allWithinDepth = limitedAffectedTests.affectedTests.every(t => t.distance <= 2);
    assert(allWithinDepth, 'All affected tests should be within maxDepth');

    console.log('\n📋 Test Group: impact');
    const impact = runCli(['impact', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
    assert(typeof impact.impactCount === 'number', 'impactCount should be a number');
    assert(impact.symbolImpact, 'symbolImpact should exist');
    assert(['symbol', 'file-fallback'].includes(impact.symbolImpact.mode), 'symbolImpact.mode should be valid');
    const transitiveInImpact = (impact.impact || []).filter((e) => e.level >= 2);
    assert.strictEqual(
      impact.symbolImpact.transitiveCount,
      transitiveInImpact.length,
      'transitiveCount should match count of level>=2 items in impact array'
    );
    console.log(`     Impact: ${impact.impactCount}, transitive: ${impact.symbolImpact.transitiveCount}`);

    console.log('\nAll analysis tests passed');
  } finally {
    try {
      fs.unlinkSync(testFile);
      fs.unlinkSync(testUnusedFile);
      fs.unlinkSync(partialExportsFile);
      fs.unlinkSync(partialConsumerFile);
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

main();
