#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveImport } = require('../src/services/dep-graph/resolvers');

function testGoModuleImport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-go-res-'));
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo.go'), 'package foo\n');
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo_test.go'), 'package foo\n');

  const resolved = resolveImport(path.join(tmpDir, 'main.go'), 'example.com/demo/pkg/foo', '.go', tmpDir);
  assert(resolved && resolved.includes(path.join('pkg', 'foo', 'foo.go')), `Expected go module resolve, got ${resolved}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testRustCrateImport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rs-res-'));
  fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.rs'), '');

  const lib = path.join(tmpDir, 'src', 'lib.rs');
  const r1 = resolveImport(lib, 'crate::foo', '.rs', tmpDir);
  assert(r1 && r1.includes(path.join('src', 'foo.rs')), `Expected crate::foo -> src/foo.rs, got ${r1}`);

  const r2 = resolveImport(lib, 'crate::foo::bar', '.rs', tmpDir);
  assert(r2 && r2.includes(path.join('src', 'foo', 'bar.rs')), `Expected crate::foo::bar -> src/foo/bar.rs, got ${r2}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testRustSuperImport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rs-super-'));
  fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.rs'), '');

  const bar = path.join(tmpDir, 'src', 'foo', 'bar.rs');
  const r1 = resolveImport(bar, 'super::foo', '.rs', tmpDir);
  assert(r1 && r1.includes(path.join('src', 'foo.rs')), `Expected super::foo -> src/foo.rs, got ${r1}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

testGoModuleImport();
testRustCrateImport();
testRustSuperImport();
console.log('gors-resolver-test: ok');
