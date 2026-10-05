#!/usr/bin/env node
// @contract — L3-8 点名实例收口：内部模块互信，不为结构性不可能的情况付 ?. 税
//
// 背景（TECH_DEBT L3-8 待处理，2026-07-31 评审登记）： freshness 链三处
// `container.cache?.getContentSignature?.() || ''` + cache 内部 `meta?.mtime/size`，
// 是纪律写进文档之后新写的同族实例。防线只设在外部边界（graph-db deserialize
// 恒产对象、setFileMetadata 恒写对象）；内部消费点摘 ?.，让结构性违约炸出来。
//
// 源形态约束（调用点不得打 `?.`）由 eslint.config.js 的 no-restricted-syntax 承担。
// 行为合同：null entry 和缺内容 hash 的 entry 都必须炸；签名只随内容变，
// 不随 mtime/size 变（快照新鲜度看的是内容）。

const assert = require('assert');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

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

function testEntryWithoutHashThrows() {
  const { dir, cache } = makeCache();
  try {
    // FileIndex 写入的每条 metadata 都带内容 hash；没有 hash 的条目无法担保内容，
    // 签进快照就等于给一个无法验证的快照盖章。
    cache.fileMetadata.set(path.join(dir, 'a.js'), { mtime: 1, size: 1 });
    assert.throws(() => cache.getContentSignature(), /without content hash/);
  } finally {
    cache.close();
    cleanupTempDir(dir);
  }
}

function testSignatureTracksContentNotStat() {
  const { dir, cache } = makeCache();
  try {
    const file = path.join(dir, 'a.js');
    cache.fileMetadata.set(file, { mtime: 1, size: 10, hash: 'aaa' });
    const sig = cache.getContentSignature();
    assert.ok(/^[0-9a-f]{64}$/.test(sig), '产出正常 sha256 摘要');
    cache.fileMetadata.set(file, { mtime: 2, size: 20, hash: 'aaa' });
    assert.strictEqual(cache.getContentSignature(), sig, '只有 mtime/size 变化时签名不变');
    cache.fileMetadata.set(file, { mtime: 1, size: 10, hash: 'bbb' });
    assert.notStrictEqual(cache.getContentSignature(), sig, 'mtime/size 不变但内容变了，签名必须变');
  } finally {
    cache.close();
    cleanupTempDir(dir);
  }
}

function main() {
  const tests = [
    testNullEntryThrowsLoudly,
    testEntryWithoutHashThrows,
    testSignatureTracksContentNotStat,
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
