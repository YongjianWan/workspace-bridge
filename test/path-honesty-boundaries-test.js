#!/usr/bin/env node
// @fast
// @semantic
/**
 * Boundary behaviour that earlier tests left unlocked: the dead-export graph-reliability
 * threshold, relative paths resolved against the cwd, dependency folders ignored during
 * language detection, and nested-workspace selection.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { classifyDeadExports, classifyUnresolved } = require('../src/tools/honesty-engine');
const { normalizeFilePath, normalizePathKey, detectWorkspace, findWorkspaceRoot } = require('../src/utils/path');

function reasonFor(stats) {
  const [c] = classifyDeadExports([{ file: '/src/x.js', importerCount: 0, name: 'x' }], { getStats: () => stats });
  return c.reason;
}

// Graph reliability: only a multi-file graph with almost no edges is "unreliable".
assert.notStrictEqual(reasonFor({ files: 1, totalImports: 0 }), 'graph-unreliable', 'single-file project is not downgraded');
assert.notStrictEqual(reasonFor({ files: 0, totalImports: 0 }), 'graph-unreliable', 'empty graph is not downgraded');
assert.strictEqual(reasonFor({ files: 2, totalImports: 0 }), 'graph-unreliable', 'two files without edges is unreliable');
assert.notStrictEqual(reasonFor({ files: 10, totalImports: 1 }), 'graph-unreliable', 'ratio exactly 0.1 is acceptable');
assert.strictEqual(reasonFor({ files: 11, totalImports: 1 }), 'graph-unreliable', 'ratio below 0.1 is unreliable');

// Relative paths resolve against the given root, and against the cwd when no root is given.
const root = makeTempDir('wb-path-bounds-');
try {
  assert.strictEqual(normalizeFilePath('a/b.js', root), normalizePathKey(path.join(root, 'a', 'b.js')));
  assert.strictEqual(normalizeFilePath('a/b.js'), normalizePathKey(path.join(process.cwd(), 'a', 'b.js')));
  assert.strictEqual(normalizeFilePath('', root), null);
  assert.strictEqual(normalizeFilePath(42, root), null);

  // Dependency folders do not count as project languages.
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x.py'), '');
  fs.writeFileSync(path.join(root, 'node_modules', 'pom.xml'), '');
  fs.writeFileSync(path.join(root, 'node_modules', 'x.c'), '');
  fs.writeFileSync(path.join(root, 'node_modules', 'package.json'), '{}');
  let ws = detectWorkspace(root);
  assert.strictEqual(ws.hasPythonFiles, false, 'python files under node_modules are ignored');
  assert.strictEqual(ws.hasJava, false, 'a pom.xml under node_modules is ignored');
  assert.strictEqual(ws.hasCpp, false, 'C files under node_modules are ignored');
  assert.strictEqual(findWorkspaceRoot(root), root, 'a marker file inside node_modules never becomes the workspace root');

  // The same files in a real subfolder are detected.
  fs.mkdirSync(path.join(root, 'svc'));
  fs.writeFileSync(path.join(root, 'svc', 'x.py'), '');
  fs.writeFileSync(path.join(root, 'svc', 'pom.xml'), '');
  fs.writeFileSync(path.join(root, 'svc', 'x.c'), '');
  ws = detectWorkspace(root);
  assert.strictEqual(ws.hasPythonFiles, true);
  assert.strictEqual(ws.hasJava, true);
  assert.strictEqual(ws.hasCpp, true);

  // vendor, build and dist are skipped for C/C++ detection only.
  const cppRoot = makeTempDir('wb-path-cpp-');
  try {
    for (const dir of ['vendor', 'build', 'dist']) {
      fs.mkdirSync(path.join(cppRoot, dir));
      fs.writeFileSync(path.join(cppRoot, dir, 'x.cpp'), '');
    }
    assert.strictEqual(detectWorkspace(cppRoot).hasCpp, false, 'vendored/build C++ does not make the project C++');
  } finally {
    cleanupTempDir(cppRoot);
  }
} finally {
  cleanupTempDir(root);
}

// Each Java build file alone marks the project (root or one level down); each C++ build file likewise.
for (const marker of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
  for (const sub of [null, 'svc']) {
    const dir = makeTempDir('wb-path-java-');
    try {
      const where = sub ? path.join(dir, sub) : dir;
      fs.mkdirSync(where, { recursive: true });
      fs.writeFileSync(path.join(where, marker), '');
      assert.strictEqual(detectWorkspace(dir).hasJava, true, `${marker} at ${sub || 'root'} marks a Java project`);
    } finally {
      cleanupTempDir(dir);
    }
  }
}
for (const marker of ['CMakeLists.txt', 'Makefile']) {
  const dir = makeTempDir('wb-path-cpp-marker-');
  try {
    fs.writeFileSync(path.join(dir, marker), '');
    assert.strictEqual(detectWorkspace(dir).hasCpp, true, `${marker} marks a C++ project`);
  } finally {
    cleanupTempDir(dir);
  }
}
{
  const dir = makeTempDir('wb-path-none-');
  try {
    assert.strictEqual(detectWorkspace(dir).hasJava, false);
  } finally {
    cleanupTempDir(dir);
  }
}

// An alias import is blamed on the missing alias config unless tsconfig really declares paths.
for (const [label, tsconfig] of [['no tsconfig', null], ['no compilerOptions', '{}'], ['empty paths', '{"compilerOptions":{"paths":{}}}']]) {
  const dir = makeTempDir('wb-alias-');
  try {
    if (tsconfig) fs.writeFileSync(path.join(dir, 'tsconfig.json'), tsconfig);
    const [c] = classifyUnresolved([{ file: '/a.js', import: '@/x', resolvedTo: '/x' }], dir);
    assert.strictEqual(c.reason, 'alias-unresolved', label);
  } finally {
    cleanupTempDir(dir);
  }
}
