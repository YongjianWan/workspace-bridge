#!/usr/bin/env node
// @contract — L3-8 点名实例收口：内部模块互信，不为结构性不可能的情况付 ?. 税
//
// 背景（TECH_DEBT L3-8 待处理，2026-07-31 评审登记）： freshness 链三处
// `container.cache?.getContentSignature?.() || ''` + cache 内部 `meta?.mtime/size`，
// 是纪律写进文档之后新写的同族实例。防线只设在外部边界（graph-db deserialize
// 恒产对象、setFileMetadata 恒写对象）；内部消费点摘 ?.，让结构性违约炸出来。
//
// 结构性合同（源形态回归闸）：三处调用必须无条件直调——`?.` 回潮即红。
// 行为合同：null entry 必须炸（RED 驱动本批改动）；稀疏老格式 entry
// （对象缺 mtime）仍是真实可恢复边界，压 0 参与哈希、不炸（防过修）。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const SRC = path.join(__dirname, '..', 'src');

// --- cache 内部合同 ---

function makeCache() {
  const dir = makeTempDir('wb-sigtrust-');
  const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
  return { dir, cache };
}

function testNullEntryThrowsLoudly() {
  const { dir, cache } = makeCache();
  try {
    cache.fileMetadata.set(path.join(dir, 'a.js'), null);
    let threw = false;
    try {
      cache.getContentSignature();
    } catch {
      threw = true;
    }
    assert.ok(
      threw,
      'fileMetadata 里的 null entry 是内部契约违约（写路径 guarantee 对象），必须炸，不能当 0 混进哈希产出假签名'
    );
  } finally {
    cache.close();
    cleanupTempDir(dir);
  }
}

function testSparseEntryKeepsLegacyTolerance() {
  const { dir, cache } = makeCache();
  try {
    // 稀疏对象（有 entry、无 mtime 字段）= 老格式/部分写路径的真实产物，
    // 属可恢复边界：压 0 参与哈希，与显式 {mtime:0,size:0} 同摘要。
    cache.fileMetadata.set(path.join(dir, 'a.js'), {});
    const sig = cache.getContentSignature();
    assert.ok(/^[0-9a-f]{64}$/.test(sig), '稀疏 entry 不炸，产出正常 sha256 摘要');
    cache.fileMetadata.set(path.join(dir, 'a.js'), { mtime: 0, size: 0 });
    assert.strictEqual(cache.getContentSignature(), sig, '稀疏 entry 与显式零值同摘要（|| 0 压位语义保持）');
  } finally {
    cache.close();
    cleanupTempDir(dir);
  }
}

// --- 调用点结构性合同（纪律回归闸：?. 回潮即红） ---

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function testOverviewToolsCallsUnconditionally() {
  const src = readSrc('tools/overview-tools.js');
  assert.ok(!src.includes('getContentSignature?.'), 'overview-tools 不得对 getContentSignature 打 ?.（L3-8）');
  const calls = src.split('container.cache.getContentSignature()').length - 1;
  assert.strictEqual(calls, 2, `overview-tools 应恰好 2 处无条件直调（isSnapshotFresh + 快照写盘），实得 ${calls}`);
}

function testQueryToolsCallsUnconditionally() {
  const src = readSrc('tools/query-tools.js');
  assert.ok(!src.includes('getContentSignature?.'), 'query-tools 不得对 getContentSignature 打 ?.（L3-8）');
  const calls = src.split('container.cache.getContentSignature()').length - 1;
  assert.strictEqual(calls, 1, `query-tools 应恰好 1 处无条件直调（describeReplay），实得 ${calls}`);
}

function testCacheBodyTrustsObjectShape() {
  const src = readSrc('services/cache.js');
  const start = src.indexOf('getContentSignature() {');
  assert.ok(start >= 0, 'precondition: getContentSignature method exists');
  const body = src.slice(start, src.indexOf('\n  }', start));
  assert.ok(!body.includes('meta?.mtime'), 'getContentSignature 不得对 meta 打 ?.（entry 形状由边界保证）');
  assert.ok(!body.includes('meta?.size'), 'getContentSignature 不得对 meta 打 ?.（entry 形状由边界保证）');
}

function main() {
  const tests = [
    testNullEntryThrowsLoudly,
    testSparseEntryKeepsLegacyTolerance,
    testOverviewToolsCallsUnconditionally,
    testQueryToolsCallsUnconditionally,
    testCacheBodyTrustsObjectShape,
  ];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main();
