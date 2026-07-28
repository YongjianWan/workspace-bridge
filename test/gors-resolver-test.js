#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveImport } = require('../src/services/dep-graph/resolvers');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testGoModuleImport() {
  const tmpDir = makeTempDir('wb-go-res-');
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo.go'), 'package foo\n');
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo_test.go'), 'package foo\n');

  const resolved = resolveImport(path.join(tmpDir, 'main.go'), 'example.com/demo/pkg/foo', '.go', tmpDir);
  assert(resolved && resolved.includes(path.join('pkg', 'foo', 'foo.go')), `Expected go module resolve, got ${resolved}`);

  cleanupTempDir(tmpDir);
}

function testRustCrateImport() {
  const tmpDir = makeTempDir('wb-rs-res-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.rs'), '');

  const lib = path.join(tmpDir, 'src', 'lib.rs');
  const r1 = resolveImport(lib, 'crate::foo', '.rs', tmpDir);
  assert(r1 && r1.includes(path.join('src', 'foo.rs')), `Expected crate::foo -> src/foo.rs, got ${r1}`);

  const r2 = resolveImport(lib, 'crate::foo::bar', '.rs', tmpDir);
  assert(r2 && r2.includes(path.join('src', 'foo', 'bar.rs')), `Expected crate::foo::bar -> src/foo/bar.rs, got ${r2}`);

  cleanupTempDir(tmpDir);
}

function testRustSuperImport() {
  const tmpDir = makeTempDir('wb-rs-super-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.rs'), '');

  const bar = path.join(tmpDir, 'src', 'foo', 'bar.rs');
  const r1 = resolveImport(bar, 'super::foo', '.rs', tmpDir);
  assert(r1 && r1.includes(path.join('src', 'foo.rs')), `Expected super::foo -> src/foo.rs, got ${r1}`);

  // super::super from src/foo/bar.rs (module foo::bar) reaches the crate root,
  // whose file is src/lib.rs — the old null expectation locked the off-by-one
  // climb bug (L2-12). Climbing a third super must still fail.
  const r2 = resolveImport(bar, 'super::super::lib', '.rs', tmpDir);
  assert(r2 && r2.includes(path.join('src', 'lib.rs')), `super::super from foo::bar should reach crate root src/lib.rs, got ${r2}`);

  const r3 = resolveImport(bar, 'super::super::super::lib', '.rs', tmpDir);
  assert(r3 === null, `super::super::super from src/foo/bar.rs should cross above src/ and fail, got ${r3}`);

  cleanupTempDir(tmpDir);
}

// ---------------------------------------------------------------------------
// L2-12: super::/crate:: are module arithmetic, not name guesses.
// Fixtures mirror the measured misses on reference/qartez-mcp.
// ---------------------------------------------------------------------------
function makeRustServerCrate(prefix) {
  const tmpDir = makeTempDir(prefix);
  fs.mkdirSync(path.join(tmpDir, 'src', 'server', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "app"\n');
  for (const f of [
    path.join('src', 'lib.rs'),
    path.join('src', 'server', 'mod.rs'),
    path.join('src', 'server', 'helpers.rs'),
    path.join('src', 'server', 'params.rs'),
    path.join('src', 'server', 'prompts.rs'),
    path.join('src', 'server', 'overview.rs'),
    path.join('src', 'server', 'tools', 'mod.rs'),
    path.join('src', 'server', 'tools', 'blame.rs'),
  ]) {
    fs.writeFileSync(path.join(tmpDir, f), '');
  }
  return tmpDir;
}

function testRustSuperFromNonModFileCostsNoClimb() {
  const tmpDir = makeRustServerCrate('wb-rs-super-nomod-');

  // super from a non-mod file names the module the file belongs to — its
  // submodule directory is the file's own directory, so the first super is free.
  const r1 = resolveImport(path.join(tmpDir, 'src', 'server', 'overview.rs'), 'super::helpers::truncate_path', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'server', 'helpers.rs')), `super::helpers::x from server/overview.rs -> server/helpers.rs, got ${r1}`);

  const r2 = resolveImport(path.join(tmpDir, 'src', 'server', 'tools', 'blame.rs'), 'super::super::params::SoulBlameParams', '.rs', tmpDir);
  assert(r2 && r2.endsWith(path.join('src', 'server', 'params.rs')), `super::super::params::x from server/tools/blame.rs -> server/params.rs, got ${r2}`);

  cleanupTempDir(tmpDir);
}

function testRustSuperItemOfBaseModule() {
  const tmpDir = makeRustServerCrate('wb-rs-super-item-');

  // The trailing segment names an item of the base module, not a submodule:
  // super::QartezServer from server/prompts.rs lives in server/mod.rs.
  const r1 = resolveImport(path.join(tmpDir, 'src', 'server', 'prompts.rs'), 'super::QartezServer', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'server', 'mod.rs')), `super::QartezServer -> server/mod.rs, got ${r1}`);

  const r2 = resolveImport(path.join(tmpDir, 'src', 'server', 'tools', 'blame.rs'), 'super::super::QartezServer', '.rs', tmpDir);
  assert(r2 && r2.endsWith(path.join('src', 'server', 'mod.rs')), `super::super::QartezServer -> server/mod.rs, got ${r2}`);

  cleanupTempDir(tmpDir);
}

function testRustSuperFromModFileClimbsImmediately() {
  const tmpDir = makeRustServerCrate('wb-rs-super-modfile-');

  // A mod.rs file IS the module named by its parent directory, so super climbs.
  const r1 = resolveImport(path.join(tmpDir, 'src', 'server', 'tools', 'mod.rs'), 'super::helpers', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'server', 'helpers.rs')), `super::helpers from server/tools/mod.rs -> server/helpers.rs, got ${r1}`);

  cleanupTempDir(tmpDir);
}

function testRustCrateAnchorsAtNearestCargoToml() {
  const tmpDir = makeTempDir('wb-rs-workspace-');
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "root-crate"\n');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.mkdirSync(path.join(tmpDir, 'dashboard', 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'dashboard', 'Cargo.toml'), '[package]\nname = "dashboard"\n');
  fs.writeFileSync(path.join(tmpDir, 'dashboard', 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'dashboard', 'src', 'paths.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'dashboard', 'src', 'auth.rs'), '');

  // crate:: inside a member crate is relative to THAT crate's src.
  const r1 = resolveImport(path.join(tmpDir, 'dashboard', 'src', 'auth.rs'), 'crate::paths', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('dashboard', 'src', 'paths.rs')), `crate::paths -> dashboard/src/paths.rs, got ${r1}`);

  // Single segment naming an item of the crate root falls back to lib.rs.
  const r2 = resolveImport(path.join(tmpDir, 'dashboard', 'src', 'auth.rs'), 'crate::AppState', '.rs', tmpDir);
  assert(r2 && r2.endsWith(path.join('dashboard', 'src', 'lib.rs')), `crate::AppState -> dashboard/src/lib.rs, got ${r2}`);

  cleanupTempDir(tmpDir);
}

function testGoModMissing() {
  const tmpDir = makeTempDir('wb-go-no-mod-');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo.go'), 'package foo\n');

  const resolved = resolveImport(path.join(tmpDir, 'main.go'), 'example.com/demo/pkg/foo', '.go', tmpDir);
  assert.strictEqual(resolved, null, 'should return null when go.mod is missing');

  cleanupTempDir(tmpDir);
}

function testGoModMalformed() {
  const tmpDir = makeTempDir('wb-go-bad-mod-');
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'not a valid go module file\n');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo.go'), 'package foo\n');

  const resolved = resolveImport(path.join(tmpDir, 'main.go'), 'example.com/demo/pkg/foo', '.go', tmpDir);
  assert.strictEqual(resolved, null, 'should return null when go.mod has no module line');

  cleanupTempDir(tmpDir);
}

testGoModuleImport();
testGoModMissing();
testGoModMalformed();
testRustCrateImport();
testRustSuperImport();
testRustSuperFromNonModFileCostsNoClimb();
testRustSuperItemOfBaseModule();
testRustSuperFromModFileClimbsImmediately();
testRustCrateAnchorsAtNearestCargoToml();
