#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveJavaImport } = require('../src/services/dep-graph/resolvers');

function testMultiModuleResolver() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-java-test-'));
  fs.mkdirSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '');

  const resolved = resolveJavaImport('com.example.Foo', tmpDir);
  assert(resolved && resolved.includes('module-a'), `Expected multi-module resolve, got ${resolved}`);

  fs.rmSync(tmpDir, { recursive: true });
}

function testKotlinSourceRoot() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-kt-test-'));
  fs.mkdirSync(path.join(tmpDir, 'src', 'main', 'kotlin', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'main', 'kotlin', 'com', 'example', 'Bar.kt'), '');

  const resolved = resolveJavaImport('com.example.Bar', tmpDir);
  assert(resolved && resolved.includes('kotlin'), `Expected kotlin source root resolve, got ${resolved}`);

  fs.rmSync(tmpDir, { recursive: true });
}

testMultiModuleResolver();
testKotlinSourceRoot();
console.log('java-resolver-test: OK');
