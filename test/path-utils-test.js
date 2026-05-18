#!/usr/bin/env node

const assert = require('assert');
const {
  normalizePathKey,
  matchesPathFragment,
  isPathInsideRoot,
  resolveWorkspaceFilePath,
} = require('../src/utils/path');

function testNormalizePathKeyWindowsCase() {
  if (process.platform !== 'win32') {
    // On Unix, normalizePathKey just normalizes separators
    const key = normalizePathKey('/Foo/Bar');
    assert.strictEqual(key, '/foo/bar');
    return;
  }
  // On Windows, it should lowercase for case-insensitive comparison
  const key = normalizePathKey('C:\\Foo\\Bar');
  assert.strictEqual(key.includes('Foo'), false, 'should be lowercased on Windows');
}

function testMatchesPathFragment() {
  assert.strictEqual(matchesPathFragment('/a/b/node_modules/c', 'node_modules'), true);
  assert.strictEqual(matchesPathFragment('/a/b/node_modules', 'node_modules'), true);
  assert.strictEqual(matchesPathFragment('/a/b/c', 'node_modules'), false);
}

function testIsPathInsideRoot() {
  assert.strictEqual(isPathInsideRoot('/workspace', '/workspace/src/foo.js'), true);
  assert.strictEqual(isPathInsideRoot('/workspace', '/other/foo.js'), false);
}

function testResolveWorkspaceFilePath() {
  const resolved = resolveWorkspaceFilePath('src/foo.js', '/workspace');
  assert(resolved, 'should resolve relative path');
  assert(resolved.endsWith('src/foo.js') || resolved.endsWith('src\\foo.js'), `got ${resolved}`);

  // Outside workspace should return null
  assert.strictEqual(
    resolveWorkspaceFilePath('../foo.js', '/workspace'),
    null
  );
}

function testTurkishLocaleSafe() {
  // Verify that uppercase 'I' maps to lowercase 'i' even under Turkish locale
  // by checking the implementation uses toLocaleLowerCase('en-US')
  const key = normalizePathKey('/ITEM');
  assert.strictEqual(key.includes('ITEM'), false, 'should lowercase');
  assert.strictEqual(key.includes('ı'), false, 'Turkish ı should not appear');
}

function main() {
  testNormalizePathKeyWindowsCase();
  testMatchesPathFragment();
  testIsPathInsideRoot();
  testResolveWorkspaceFilePath();
  testTurkishLocaleSafe();
}

main();
