#!/usr/bin/env node
// @contract — ParseCache 跨调用内存缓存功能校验

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { GraphBuilder } = require('../src/services/dep-graph/builder');

async function testCacheHitOnUnchangedFile() {
  const dg = DependencyGraph.fromSchema('/mock', {});
  const builder = new GraphBuilder(dg);

  const file = '/mock/a.js';
  const key = dg.normalizeFilePath(file);

  // Stub getFileMetadata to return a fixed mtime
  dg.cache = {
    getFileMetadata: () => ({ mtime: 1000, originalPath: file }),
  };

  // Populate cache with a fake result
  const stubResult = { content: 'cached-content', graphKey: key, imports: [] };
  builder._parseCache.set(key, { mtime: 1000, result: stubResult });

  // Running parseFileOnly should return stubResult immediately
  const res = await builder.parseFileOnly(file);
  assert.deepStrictEqual(res, stubResult, 'Expected parse cache hit');
}

async function testCacheMissOnMtimeOrHashChange() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-parse-cache-test-'));
  const filePath = path.join(tmpDir, 'test.js');
  fs.writeFileSync(filePath, 'const a = 1;', 'utf8');

  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);
    const key = dg.normalizeFilePath(filePath);

    // Initial parse to populate cache
    const stat = fs.statSync(filePath);
    dg.cache = {
      getFileMetadata: () => ({ mtime: stat.mtimeMs, originalPath: filePath }),
    };

    const firstResult = await builder.parseFileOnly(filePath);
    assert.strictEqual(firstResult.content, 'const a = 1;');
    assert.ok(builder._parseCache.has(key), 'Cache should be populated');

    // 1. Mtime matches -> Hit
    const secondResult = await builder.parseFileOnly(filePath);
    assert.strictEqual(secondResult, firstResult, 'Expected hit with identical reference');

    // 2. Mtime changes -> Miss
    dg.cache.getFileMetadata = () => ({ mtime: stat.mtimeMs + 999, originalPath: filePath });
    // Write new content to disk
    fs.writeFileSync(filePath, 'const b = 2;', 'utf8');
    const thirdResult = await builder.parseFileOnly(filePath);
    assert.strictEqual(thirdResult.content, 'const b = 2;', 'Expected re-read after mtime mismatch');
    assert.notStrictEqual(thirdResult, firstResult, 'Result reference should be different');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function testLruEviction() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-parse-cache-lru-'));

  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);

    // Stub getFileMetadata so parseFileOnly will cache every parsed file.
    dg.cache = {
      getFileMetadata: (p) => ({ mtime: 100, originalPath: p }),
    };

    // Create 202 files and parse them; the cache limit is 200, so the oldest entries should be evicted.
    const filePaths = [];
    for (let i = 0; i < 202; i++) {
      const filePath = path.join(tmpDir, `file-${i}.js`);
      fs.writeFileSync(filePath, `export const x${i} = ${i};`, 'utf8');
      filePaths.push(filePath);
    }

    for (const filePath of filePaths) {
      await builder.parseFileOnly(filePath);
    }

    assert.strictEqual(builder._parseCache.size, 200, 'Cache size should be capped at 200');
    const key0 = dg.normalizeFilePath(filePaths[0]);
    const key1 = dg.normalizeFilePath(filePaths[1]);
    assert.ok(!builder._parseCache.has(key0), 'Oldest cached file should be evicted');
    assert.ok(!builder._parseCache.has(key1), 'Second-oldest cached file should be evicted');
    const keyLast = dg.normalizeFilePath(filePaths[filePaths.length - 1]);
    assert.ok(builder._parseCache.has(keyLast), 'Most recently parsed file should still be cached');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function testCacheLifecycle() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-parse-cache-life-'));
  const f1 = path.join(tmpDir, 'f1.js');
  const f2 = path.join(tmpDir, 'f2.js');
  fs.writeFileSync(f1, 'export const x = 1;', 'utf8');
  fs.writeFileSync(f2, 'export const y = 2;', 'utf8');

  try {
    const dg = DependencyGraph.fromSchema(tmpDir, {});
    const builder = new GraphBuilder(dg);

    // Stub cache
    const stat1 = fs.statSync(f1);
    const stat2 = fs.statSync(f2);
    dg.cache = {
      getFileMetadata: (p) => {
        if (p === f1) return { mtime: stat1.mtimeMs, originalPath: f1 };
        if (p === f2) return { mtime: stat2.mtimeMs, originalPath: f2 };
        return null;
      },
      getParseResult: () => null,
      setParseResult: () => {},
      deleteFileMetadata: () => {},
      deleteParseResult: () => {},
      clearDiagnostics: () => {},
      walCheckpoint: () => {},
      save: async () => {},
      saveEdges: () => {},
    };

    // Populate
    await builder.parseFileOnly(f1);
    await builder.parseFileOnly(f2);
    assert.strictEqual(builder._parseCache.size, 2, 'Should cache both parsed files');

    // Manually add an orphan cached file
    builder._parseCache.set('stale.js', { mtime: 100, result: {} });

    // 1. build() should clear previous cached orphans
    await builder.build([f1, f2]);
    assert.ok(!builder._parseCache.has('stale.js'), 'build() should clear previous cache orphans');

    // Populate again
    await builder.parseFileOnly(f1);
    await builder.parseFileOnly(f2);
    assert.strictEqual(builder._parseCache.size, 2);

    // 2. updateFiles([f1]) where f1 is deleted -> should remove f1 from cache
    fs.unlinkSync(f1);
    await builder.updateFiles([f1]);
    const k1 = dg.normalizeFilePath(f1);
    const k2 = dg.normalizeFilePath(f2);
    assert.ok(!builder._parseCache.has(k1), 'f1 should be deleted from cache after file deletion');
    assert.ok(builder._parseCache.has(k2), 'f2 should remain in cache');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testCacheHitOnUnchangedFile,
  testCacheMissOnMtimeOrHashChange,
  testLruEviction,
  testCacheLifecycle,
];

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.stack || err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
})();
