#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { normalizePathKey, fromNormalizedKey } = require('../src/utils/path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testFindUnresolvedImportsUsesPlatformPath() {
  const dir = makeTempDir('wb-p77-');

  // Create a real file and a missing import target
  fs.writeFileSync(path.join(dir, 'main.js'), "import './missing';", 'utf8');

  const dg = new DependencyGraph(dir, null);
  const mainKey = normalizePathKey(path.join(dir, 'main.js'));
  const missingKey = normalizePathKey(path.join(dir, 'missing.js'));

  // Inject graph state directly (bypassing build)
  dg.graph.set(mainKey, {
    originalPath: path.join(dir, 'main.js'),
    imports: [missingKey],
    exports: [],
    importRecords: [{ source: './missing', resolved: missingKey, imported: null, usesAllExports: true }],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    parseModeReason: 'js',
  });

  const unresolved = dg.findUnresolvedImports();
  assert.strictEqual(unresolved.length, 1, 'should detect one unresolved import');
  // _displayPath returns originalPath for files in the graph, or the key itself otherwise.
  // The key is in normalizePathKey format (lowercase + POSIX slashes on Windows).
  assert.strictEqual(unresolved[0].file, path.join(dir, 'main.js'), 'file path should match');
  assert.strictEqual(unresolved[0].import, normalizePathKey(path.join(dir, 'missing.js')), 'import path should be normalizePathKey format');

  cleanupTempDir(dir);
}

function testFromNormalizedKeyRoundTrip() {
  if (process.platform !== 'win32') {
    // On POSIX, fromNormalizedKey is a no-op
    assert.strictEqual(fromNormalizedKey('/foo/bar'), '/foo/bar');
    return;
  }

  // On Windows, backslashes should be restored
  const key = 'c:/users/test/project/src/foo.js';
  const fsPath = fromNormalizedKey(key);
  assert.strictEqual(fsPath, 'c:\\users\\test\\project\\src\\foo.js', 'should restore backslashes on Windows');

  // Edge: already platform-native path should be unchanged
  const native = 'c:\\users\\test\\project\\src\\foo.js';
  assert.strictEqual(fromNormalizedKey(native), native, 'native path should be unchanged');
}

function testFromNormalizedKeyNullSafety() {
  assert.strictEqual(fromNormalizedKey(null), null);
  assert.strictEqual(fromNormalizedKey(''), '');
  assert.strictEqual(fromNormalizedKey(undefined), undefined);
}

function main() {
  testFindUnresolvedImportsUsesPlatformPath();
  testFromNormalizedKeyRoundTrip();
  testFromNormalizedKeyNullSafety();
  }

main();
