#!/usr/bin/env node
// @semantic

const assert = require('assert');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testNormalizeFileMapEntriesDeterministic() {
  const root = makeTempDir('wb-cache-');
  const cache = new WorkspaceCache(root);
  const target = path.join(root, 'src', 'a.js');

  const rows = [
    [target, { mtime: 100, size: 1 }],
    [target, { mtime: 100, size: 2 }],
    [target, { mtime: 90, size: 3 }],
    [target, { mtime: 101, size: 4 }],
  ];
  const normalized = cache.normalizeFileMapEntries(rows);
  const picked = normalized.get(cache.normalizeFilePath(target));
  assert(picked, 'normalized row should exist');
  assert.strictEqual(picked.size, 4, 'newer mtime should replace older');

  const rowsTieOnly = [
    [target, { mtime: 200, size: 11 }],
    [target, { mtime: 200, size: 22 }],
  ];
  const tieNormalized = cache.normalizeFileMapEntries(rowsTieOnly);
  const tiePicked = tieNormalized.get(cache.normalizeFilePath(target));
  assert(tiePicked, 'tie row should exist');
  assert.strictEqual(tiePicked.size, 11, 'equal mtime should keep first entry deterministically');

  cleanupTempDir(root);
}

async function testSaveAndLoadRoundtrip() {
  const root = makeTempDir('wb-cache-');
  const cache = new WorkspaceCache(root);
  const file = path.join(root, 'src', 'b.js');
  cache.setWorkspaceInfo({ profile: 'node' });
  cache.setFileMetadata(file, { mtime: 123, size: 9, symbols: ['run'] });
  cache.setParseResult(file, {
    imports: [path.join(root, 'src', 'a.js')],
    exports: ['run'],
    importRecords: [{ source: './a', resolved: path.join(root, 'src', 'a.js'), imported: ['helper'] }],
    exportRecords: [{ name: 'run', kind: 'function' }],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    mtime: 123,
  });
  cache.setSymbols('run', [{ file, line: 1, type: 'function' }]);
  cache.setDiagnostics(file, { mtime: 123, diagnostics: [] });

  const saved = await cache.save();
  assert.strictEqual(saved, true, 'save should succeed');
  const loaded = new WorkspaceCache(root);
  const ok = loaded.load();
  assert.strictEqual(ok, true, 'load should succeed');
  assert(loaded.getWorkspaceInfo(), 'workspace info should load');
  assert(loaded.getFileMetadata(file), 'file metadata should load');
  assert(loaded.hasParseResult(file), 'parse result should load');
  const loadedParse = loaded.getParseResult(file);
  assert.strictEqual(loadedParse.mtime, 123, 'parse result mtime should load');
  assert.strictEqual(loadedParse.parseMode, 'ast', 'parse result parseMode should load');
  assert(Array.isArray(loaded.getSymbols('run')), 'symbols should load');

  cleanupTempDir(root);
}

async function testSaveAfterLoadPersistsNewEntries() {
  const root = makeTempDir('wb-cache-');
  const firstFile = path.join(root, 'src', 'first.js');
  const secondFile = path.join(root, 'src', 'second.js');

  const cache = new WorkspaceCache(root);
  cache.setFileMetadata(firstFile, { mtime: 1, size: 1, symbols: [] });
  assert.strictEqual(await cache.save(), true, 'initial save should succeed');
  cache.close();

  const loaded = new WorkspaceCache(root);
  assert.strictEqual(loaded.load(), true, 'load should succeed');
  loaded.setFileMetadata(secondFile, { mtime: 2, size: 2, symbols: [] });
  loaded.setParseResult(secondFile, {
    imports: [],
    exports: ['second'],
    importRecords: [],
    exportRecords: [{ name: 'second', kind: 'function' }],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    mtime: 2,
  });
  assert.strictEqual(await loaded.save(), true, 'save after load should persist dirty entries');
  loaded.close();

  const reloaded = new WorkspaceCache(root);
  assert.strictEqual(reloaded.load(), true, 'reload should succeed');
  assert(reloaded.getFileMetadata(secondFile), 'metadata added after load should persist');
  assert(reloaded.hasParseResult(secondFile), 'parse result added after load should persist');
  reloaded.close();

  cleanupTempDir(root);
}

function testParseResultGetSetDelete() {
  const root = makeTempDir('wb-cache-');
  const cache = new WorkspaceCache(root);
  const file = path.join(root, 'src', 'c.js');

  assert.strictEqual(cache.hasParseResult(file), false, 'should not have parse result initially');
  assert.strictEqual(cache.getParseResult(file), undefined, 'get should return undefined initially');

  const parseResult = {
    imports: [],
    exports: ['foo'],
    importRecords: [],
    exportRecords: [{ name: 'foo', kind: 'function' }],
    functionRecords: [],
    parseMode: 'regex',
    confidence: 'medium',
    mtime: 456,
  };
  cache.setParseResult(file, parseResult);
  assert.strictEqual(cache.hasParseResult(file), true, 'should have parse result after set');
  assert.deepStrictEqual(cache.getParseResult(file), parseResult, 'get should return exact value');

  cache.deleteParseResult(file);
  assert.strictEqual(cache.hasParseResult(file), false, 'should not have parse result after delete');

  cleanupTempDir(root);
}

async function main() {
  testNormalizeFileMapEntriesDeterministic();
  testParseResultGetSetDelete();
  await testSaveAndLoadRoundtrip();
  await testSaveAfterLoadPersistsNewEntries();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
