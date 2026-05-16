#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveJavaImport } = require('../src/services/dep-graph/resolvers');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testMultiModuleResolver() {
  const tmpDir = makeTempDir('wb-java-test-');
  fs.mkdirSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '');

  const resolved = resolveJavaImport('com.example.Foo', tmpDir);
  assert(resolved && resolved.includes('module-a'), `Expected multi-module resolve, got ${resolved}`);

  cleanupTempDir(tmpDir);
}

function testKotlinSourceRoot() {
  const tmpDir = makeTempDir('wb-kt-test-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'main', 'kotlin', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'main', 'kotlin', 'com', 'example', 'Bar.kt'), '');

  const resolved = resolveJavaImport('com.example.Bar', tmpDir);
  assert(resolved && resolved.includes('kotlin'), `Expected kotlin source root resolve, got ${resolved}`);

  cleanupTempDir(tmpDir);
}

testMultiModuleResolver();
testKotlinSourceRoot();
