#!/usr/bin/env node
// @semantic
/**
 * P1-16: hotspot 排序同分时必须按文件路径升序，保证冷启动下
 * recommendations 的顺序确定。修复前只有 score 一个排序键，
 * V8 sort 对同分元素不保序，输出顺序跟输入批次有关。
 */
const assert = require('assert');
const { buildHotspots } = require('../src/tools/overview-assembler');

function makeDeps() {
  return {
    _displayPath: (f) => f,
    getDependents: () => [],
    getDependencies: () => [],
    getFrameworkHint: () => null,
    projectContext: { classifyFile: () => ({ fileRole: 'library' }) },
  };
}

// 所有文件给同样的历史信号 → 打分完全相同，触发同分路径
const evenHistoryProvider = async () => ({
  ok: true,
  historyRisk: { level: 'high', commitCount: 10, authorCount: 5, signals: ['churn'] },
});

async function testTieBrokenByPath() {
  const mainlineFiles = ['/fake/root/zeta.js', '/fake/root/alpha.js', '/fake/root/mid.js'];
  const results = await buildHotspots('/fake/root', makeDeps(), mainlineFiles, evenHistoryProvider);

  assert.strictEqual(results.length, 3, 'all candidates should pass the threshold');
  assert.deepStrictEqual(
    results.map((r) => r.file),
    ['alpha.js', 'mid.js', 'zeta.js'],
    'equal scores must be ordered by path ascending, regardless of input order'
  );
}

async function testScoreStillDominates() {
  const mainlineFiles = ['/fake/root/aaa.js', '/fake/root/zzz.js'];
  const historyProvider = async (root, file) => ({
    ok: true,
    historyRisk: file.endsWith('zzz.js')
      ? { level: 'high', commitCount: 10, authorCount: 9, signals: ['churn'] }
      : { level: 'high', commitCount: 10, authorCount: 1, signals: ['churn'] },
  });

  const results = await buildHotspots('/fake/root', makeDeps(), mainlineFiles, historyProvider);
  assert.deepStrictEqual(
    results.map((r) => r.file),
    ['zzz.js', 'aaa.js'],
    'higher score must still win over path order'
  );
}

async function main() {
  await testTieBrokenByPath();
  await testScoreStillDominates();
  console.log('p1-16-hotspot-tie-sort-test: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
