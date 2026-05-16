#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveImport } = require('../src/services/dep-graph/resolvers');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testResolveJavaScriptRelative() {
  const dir = makeTempDir('wb-resolver-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.js'), '', 'utf8');

  const fromFile = path.join(dir, 'src', 'bar.js');
  const resolved = resolveImport(fromFile, './foo', '.js', dir);
  assert.strictEqual(resolved, path.join(dir, 'src', 'foo.js'));

  cleanupTempDir(dir);
}

function testResolvePythonRelative() {
  const dir = makeTempDir('wb-resolver-');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'mod.py'), '', 'utf8');

  const fromFile = path.join(dir, 'pkg', 'main.py');
  const resolved = resolveImport(fromFile, '.mod', '.py', dir);
  assert.strictEqual(resolved, path.join(dir, 'pkg', 'mod.py'));

  cleanupTempDir(dir);
}

function testResolveJavaImport() {
  const dir = makeTempDir('wb-resolver-');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '', 'utf8');

  const resolved = resolveImport(null, 'com.example.Foo', '.java', dir);
  assert.strictEqual(resolved, path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'));

  cleanupTempDir(dir);
}

function testResolveGoImport() {
  const dir = makeTempDir('wb-resolver-');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'pkg', 'foo.go'), 'package pkg\n', 'utf8');

  const fromFile = path.join(dir, 'main.go');
  const resolved = resolveImport(fromFile, 'example.com/test/pkg', '.go', dir);
  assert.strictEqual(resolved, path.join(dir, 'pkg', 'foo.go'));

  cleanupTempDir(dir);
}

function testResolveRustCrate() {
  const dir = makeTempDir('wb-resolver-');
  fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pkg', 'mod.rs'), '', 'utf8');

  const fromFile = path.join(dir, 'src', 'main.rs');
  const resolved = resolveImport(fromFile, 'crate::pkg', '.rs', dir);
  assert.strictEqual(resolved, path.join(dir, 'src', 'pkg', 'mod.rs'));

  cleanupTempDir(dir);
}

function testResolveNullImportPath() {
  const resolved = resolveImport('/foo.js', null, '.js', '/');
  assert.strictEqual(resolved, null);
}

function main() {
  testResolveJavaScriptRelative();
  testResolvePythonRelative();
  testResolveJavaImport();
  testResolveGoImport();
  testResolveRustCrate();
  testResolveNullImportPath();
  }

main();
