#!/usr/bin/env node
// @semantic — 工具链降级（regex-fallback）产生的缓存条目永不信任
// 复现 2026-07-20 dogfood bug：无 javalang 时 java 文件走 regex fallback，
// 结果入缓存；装好 javalang 后重跑仍命中旧缓存（key 只看 mtime/hash），
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

function stubCache(dg, filePath, mtime) {
  dg.cache = {
    getFileMetadata: () => ({ mtime, originalPath: filePath }),
  };
}

function seedParseCache(builder, dg, filePath, mtime, parseMode, parseModeReason) {
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
  builder._parseCache.set(key, { mtime, result: stale });
  return stale;
}

async function testRegexFallbackEntryNotTrusted() {
  const { tmpDir, filePath } = makeTmpFile('export const real = 1;');
  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);
    stubCache(dg, filePath, 1000);
    const stale = seedParseCache(builder, dg, filePath, 1000, 'regex', 'regex-fallback');

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
    stubCache(dg, filePath, 1000);
    const stale = seedParseCache(builder, dg, filePath, 1000, 'regex', 'regex-native');

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
    stubCache(dg, filePath, 1000);
    const stale = seedParseCache(builder, dg, filePath, 1000, 'ast', 'ast-success');

    const res = await builder.parseFileOnly(filePath);
    assert.strictEqual(res, stale, 'ast cache entry should still hit');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testIsParseCacheUsableMatrix() {  const dg = DependencyGraph.fromSchema('/mock', {});
  const builder = new GraphBuilder(dg);
  const meta = { mtime: 1000 };

  assert.strictEqual(
    builder._isParseCacheUsable({ mtime: 1000, parseMode: 'regex', parseModeReason: 'regex-fallback' }, meta),
    false,
    'regex-fallback entry unusable even when mtime matches'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ mtime: 1000, parseMode: 'regex', parseModeReason: 'regex-native' }, meta),
    true,
    'regex-native entry usable'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ mtime: 1000, parseMode: 'ast', parseModeReason: 'ast-success' }, meta),
    true,
    'ast entry usable'
  );
  assert.strictEqual(
    builder._isParseCacheUsable({ mtime: 999, parseMode: 'ast', parseModeReason: 'ast-success' }, meta),
    false,
    'mtime mismatch unusable'
  );
  assert.strictEqual(builder._isParseCacheUsable(null, meta), false, 'missing cache unusable');
  assert.strictEqual(
    builder._isParseCacheUsable({ mtime: 1000, parseMode: 'ast' }, null),
    false,
    'missing metadata unusable'
  );
}

function stubLoaderCache(dg, parseResults) {
  dg.cache = {
    checkFileChanges: () => ({ changed: false, changedFiles: [] }),
    loadEdges: () => [{ source: 'a.js', target: 'b.js', edgeType: 'import' }],
    edgeMeta: null,
    parseResults,
    fileMetadata: new Map(),
    getFileMetadata: () => null,
  };
}

function testLoadGraphBailsOnDegradedEntries() {
  const { loadGraph } = require('../src/services/dep-graph/loader');
  const dg = DependencyGraph.fromSchema('/mock', {});
  stubLoaderCache(dg, new Map([
    ['b.js', { parseMode: 'regex', parseModeReason: 'regex-fallback', imports: [], exports: [] }],
  ]));
  assert.strictEqual(
    loadGraph(dg),
    false,
    'loadGraph must refuse to restore regex-fallback parse results (toolchain may have been fixed since)'
  );
}

function testLoadGraphAcceptsHealthyEntries() {
  const { loadGraph } = require('../src/services/dep-graph/loader');
  const dg = DependencyGraph.fromSchema('/mock', {});
  stubLoaderCache(dg, new Map([
    ['b.js', { parseMode: 'ast', parseModeReason: 'ast-success', imports: [], exports: [] }],
  ]));
  assert.strictEqual(loadGraph(dg), true, 'loadGraph should accept AST parse results');
}

async function main() {
  await testRegexFallbackEntryNotTrusted();
  await testRegexNativeEntryStillTrusted();
  await testAstEntryStillTrusted();
  testIsParseCacheUsableMatrix();
  testLoadGraphBailsOnDegradedEntries();
  testLoadGraphAcceptsHealthyEntries();
  console.log('cache-regex-fallback-invalidation-test: all assertions passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
