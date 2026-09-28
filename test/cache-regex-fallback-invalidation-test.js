#!/usr/bin/env node
// @semantic — 工具链降级（regex-fallback）产生的缓存条目永不信任
// @fast
// 复现 2026-07-20 dogfood bug：无 javalang 时 java 文件走 regex fallback，
// 结果入缓存；装好 javalang 后重跑仍命中旧缓存（key 只看内容 hash），
// 拿到一模一样的垃圾数字。修复后 regex-fallback 条目必须每次重解析。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { GraphBuilder } = require('../src/services/dep-graph/builder');

function makeTmpFile(content) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-degraded-'));
  const filePath = path.join(tmpDir, 'Foo.js');
  fs.writeFileSync(filePath, content, 'utf8');
  return { tmpDir, filePath };
}

function stubCache(dg, filePath, hash) {
  dg.cache = {
    getFileMetadata: () => ({ hash, originalPath: filePath }),
    getParseResult: () => null,
    setParseResult: () => {},
  };
}

function seedParseCache(builder, dg, filePath, hash, parseMode, parseModeReason) {
  const key = dg.normalizeFilePath(filePath);
  const stale = {
    content: 'STALE-CACHED-CONTENT',
    graphKey: key,
    imports: [],
    exports: ['staleExport'],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode,
    parseModeReason,
    confidence: 'medium',
  };
  builder._parseCache.set(key, { hash, result: stale });
  return stale;
}

async function testRegexFallbackEntryNotTrusted() {
  const { tmpDir, filePath } = makeTmpFile('export const real = 1;');
  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);
    stubCache(dg, filePath, 'h1');
    const stale = seedParseCache(builder, dg, filePath, 'h1', 'regex', 'regex-fallback');

    const res = await builder.parseFileOnly(filePath);
    assert.notStrictEqual(res, stale, 'regex-fallback cache entry must NOT be trusted');
    assert.strictEqual(res.content, 'export const real = 1;', 'should re-parse from disk');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testRegexNativeEntryStillTrusted() {
  const { tmpDir, filePath } = makeTmpFile('export const real = 1;');
  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);
    stubCache(dg, filePath, 'h1');
    const stale = seedParseCache(builder, dg, filePath, 'h1', 'regex', 'regex-native');

    const res = await builder.parseFileOnly(filePath);
    assert.strictEqual(res, stale, 'regex-native cache entry should still hit (regex is the native parser)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAstEntryStillTrusted() {
  const { tmpDir, filePath } = makeTmpFile('export const real = 1;');
  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);
    stubCache(dg, filePath, 'h1');
    const stale = seedParseCache(builder, dg, filePath, 'h1', 'ast', 'ast-success');

    const res = await builder.parseFileOnly(filePath);
    assert.strictEqual(res, stale, 'ast cache entry should still hit');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testIsParseCacheUsableMatrix() {
  const dg = DependencyGraph.fromSchema('/mock', {});
  const builder = new GraphBuilder(dg);
  const meta = { hash: 'h1' };

  assert.strictEqual(
    builder._isParseCacheUsable({ hash: 'h1', parseMode: 'regex', parseModeReason: 'regex-fallback' }, meta),
    false,
    'regex-fallback entry unusable even when the content hash matches'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ hash: 'h1', parseMode: 'regex', parseModeReason: 'regex-native' }, meta),
    true,
    'regex-native entry usable'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ hash: 'h1', parseMode: 'ast', parseModeReason: 'ast-success' }, meta),
    true,
    'ast entry usable'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ hash: 'h0', parseMode: 'ast', parseModeReason: 'ast-success' }, meta),
    false,
    'content hash mismatch unusable'
  );
  assert.strictEqual(builder._isParseCacheUsable(null, meta), false, 'missing cache unusable');
  assert.strictEqual(
    builder._isParseCacheUsable({ hash: 'h1', parseMode: 'ast' }, null),
    false,
    'missing metadata unusable'
  );
}

async function main() {
  await testRegexFallbackEntryNotTrusted();
  await testRegexNativeEntryStillTrusted();
  await testAstEntryStillTrusted();
  testIsParseCacheUsableMatrix();
  console.log('cache-regex-fallback-invalidation-test: all assertions passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
