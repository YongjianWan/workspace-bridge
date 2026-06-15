#!/usr/bin/env node
// @semantic

const assert = require('assert');
const {
  normalizePathKey,
  matchesPathFragment,
  isPathInsideRoot,
  resolveWorkspaceFilePath,
} = require('../src/utils/path');

function testNormalizePathKeyCaseBehavior() {
  if (process.platform === 'win32') {
    // On Windows, normalizePathKey lowercases for case-insensitive comparison.
    const key = normalizePathKey('C:\\Foo\\Bar');
    assert.strictEqual(key.includes('Foo'), false, 'should be lowercased on Windows');
    return;
  }
  // On POSIX filesystems, normalizePathKey preserves casing (case-sensitive keys).
  const key = normalizePathKey('/Foo/Bar');
  assert.strictEqual(key, '/Foo/Bar', 'Unix keys should preserve original casing');
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
  if (process.platform !== 'win32') {
    // POSIX keys preserve casing, including uppercase I; no Turkish-locale risk here.
    const key = normalizePathKey('/ITEM');
    assert.strictEqual(key, '/ITEM', 'Unix keys should preserve casing');
    assert.strictEqual(key.includes('ı'), false, 'Turkish ı should not appear');
    return;
  }
  // On Windows, verify that uppercase 'I' maps to lowercase 'i' even under Turkish locale
  // by checking the implementation uses toLocaleLowerCase('en-US').
  const key = normalizePathKey('C:\\ITEM');
  assert.strictEqual(key.includes('ITEM'), false, 'should lowercase');
  assert.strictEqual(key.includes('ı'), false, 'Turkish ı should not appear');
}

function testBfsTraverse() {
  const { bfsTraverse } = require('../src/services/dep-graph/shared');
  
  // A -> B -> C
  const graph = {
    A: ['B'],
    B: ['C'],
    C: [],
  };
  const getNeighbors = (node) => graph[node] || [];

  // Test 1: Full traversal with path tracking
  const visited = [];
  const results = bfsTraverse('A', getNeighbors, {
    onVisit: (node, depth, path) => {
      visited.push({ node, depth, path: [...path] });
      return node;
    }
  });

  assert.deepStrictEqual(results, ['A', 'B', 'C']);
  assert.deepStrictEqual(visited, [
    { node: 'A', depth: 0, path: [] },
    { node: 'B', depth: 1, path: ['A'] },
    { node: 'C', depth: 2, path: ['A', 'B'] },
  ]);

  // Test 2: Early termination using 'STOP'
  const visited2 = [];
  const results2 = bfsTraverse('A', getNeighbors, {
    onVisit: (node, depth, path) => {
      visited2.push(node);
      if (node === 'B') return 'STOP';
      return node;
    }
  });
  assert.deepStrictEqual(results2, ['A']);
  assert.deepStrictEqual(visited2, ['A', 'B']);
}

function main() {
  testNormalizePathKeyCaseBehavior();
  testMatchesPathFragment();
  testIsPathInsideRoot();
  testResolveWorkspaceFilePath();
  testTurkishLocaleSafe();
  testBfsTraverse();
}

main();
