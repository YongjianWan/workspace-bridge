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

function testRustOwnCrateNameImport() {
  // L2-16: Cargo's package name `qartez-mcp` becomes the crate name
  // `qartez_mcp` ('-' → '_'). Integration tests (and any cross-crate consumer)
  // address the crate by that name; it is crate::-rooted module arithmetic,
  // not a symbol-table guess (qartez-mcp: 152 drops / 167 symbol-table edges
  // were the two sides of this one gap).
  const tmpDir = makeTempDir('wb-rs-owncrate-');
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "qartez-mcp"\n');
  fs.mkdirSync(path.join(tmpDir, 'src', 'graph'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'graph.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'graph', 'blast.rs'), '');
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'tests', 'it.rs'), '');

  const it = path.join(tmpDir, 'tests', 'it.rs');
  const r1 = resolveImport(it, 'qartez_mcp::graph', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'graph.rs')), `qartez_mcp::graph -> src/graph.rs, got ${r1}`);

  const r2 = resolveImport(it, 'qartez_mcp::graph::blast', '.rs', tmpDir);
  assert(r2 && r2.endsWith(path.join('src', 'graph', 'blast.rs')), `qartez_mcp::graph::blast -> src/graph/blast.rs, got ${r2}`);

  // Single segment naming an item of the crate root falls back to lib.rs,
  // same as crate::QartezServer.
  const r3 = resolveImport(it, 'qartez_mcp::QartezServer', '.rs', tmpDir);
  assert(r3 && r3.endsWith(path.join('src', 'lib.rs')), `qartez_mcp::QartezServer -> src/lib.rs, got ${r3}`);

  // A different crate's name must NOT resolve here.
  const r4 = resolveImport(it, 'someone_else::graph', '.rs', tmpDir);
  assert(r4 === null, `another crate's name must not resolve against this crate, got ${r4}`);

  cleanupTempDir(tmpDir);
}

function testRustLibNameOverridesPackageName() {
  // [lib] name, when explicit, is the crate name — [package] name is not
  // consulted (qartez-dashboard declares both).
  const tmpDir = makeTempDir('wb-rs-libname-');
  fs.writeFileSync(
    path.join(tmpDir, 'Cargo.toml'),
    '[package]\nname = "qartez-dashboard-pkg"\n\n[lib]\nname = "qartez_dashboard"\npath = "src/lib.rs"\n'
  );
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib.rs'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'auth.rs'), '');

  const r1 = resolveImport(path.join(tmpDir, 'src', 'auth.rs'), 'qartez_dashboard::auth', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'auth.rs')), `[lib] name must be the crate name, got ${r1}`);

  const r2 = resolveImport(path.join(tmpDir, 'src', 'auth.rs'), 'qartez_dashboard_pkg::auth', '.rs', tmpDir);
  assert(r2 === null, `[package] name must not resolve when [lib] name is explicit, got ${r2}`);

  cleanupTempDir(tmpDir);
}

// ---------------------------------------------------------------------------
// L2-19: Rust 2018+ bare first segment names a submodule of the CURRENT
// module (`use grounding::FileFacts` in benchmark/mod.rs where
// `pub mod grounding;` is declared). Fixtures mirror the 12 measured drops on
// reference/qartez-mcp: benchmark/mod.rs + qartez-dashboard/src/lib.rs.
// ---------------------------------------------------------------------------
function makeRustScopedCrate(prefix) {
  const tmpDir = makeTempDir(prefix);
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "app"\n');
  fs.mkdirSync(path.join(tmpDir, 'src', 'benchmark'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'server'), { recursive: true });
  for (const f of [
    path.join('src', 'lib.rs'),
    path.join('src', 'cli.rs'),
    path.join('src', 'server.rs'),
    path.join('src', 'server', 'api.rs'),
    path.join('src', 'benchmark', 'mod.rs'),
    path.join('src', 'benchmark', 'grounding.rs'),
    path.join('src', 'benchmark', 'report.rs'),
  ]) {
    fs.writeFileSync(path.join(tmpDir, f), '');
  }
  return tmpDir;
}

function testRustScopedFromModFile() {
  const tmpDir = makeRustScopedCrate('wb-rs-scoped-mod-');

  // benchmark/mod.rs declares `pub mod grounding;` — a bare first segment is a
  // submodule of the current module, searched beside the mod.rs.
  const mod = path.join(tmpDir, 'src', 'benchmark', 'mod.rs');
  const r1 = resolveImport(mod, 'grounding::FileFacts', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'benchmark', 'grounding.rs')), `grounding::FileFacts from benchmark/mod.rs -> benchmark/grounding.rs, got ${r1}`);

  const r2 = resolveImport(mod, 'report::BenchmarkReport', '.rs', tmpDir);
  assert(r2 && r2.endsWith(path.join('src', 'benchmark', 'report.rs')), `report::BenchmarkReport from benchmark/mod.rs -> benchmark/report.rs, got ${r2}`);

  cleanupTempDir(tmpDir);
}

function testRustScopedFromCrateRootFile() {
  const tmpDir = makeRustScopedCrate('wb-rs-scoped-root-');

  // lib.rs/main.rs ARE the crate root module: submodules live in the same dir
  // (qartez-dashboard/src/lib.rs: `pub mod cli;` + `pub use cli::DashboardCommand`).
  const lib = path.join(tmpDir, 'src', 'lib.rs');
  const r1 = resolveImport(lib, 'cli::DashboardCommand', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'cli.rs')), `cli::DashboardCommand from src/lib.rs -> src/cli.rs, got ${r1}`);

  cleanupTempDir(tmpDir);
}

function testRustScopedFromNonModFileUsesStemDir() {
  const tmpDir = makeRustScopedCrate('wb-rs-scoped-stem-');

  // src/server.rs is module `server`; its submodules live in src/server/
  // (2018 path rules: a non-mod.rs file's submodules live under <stem>/).
  const server = path.join(tmpDir, 'src', 'server.rs');
  const r1 = resolveImport(server, 'api::Client', '.rs', tmpDir);
  assert(r1 && r1.endsWith(path.join('src', 'server', 'api.rs')), `api::Client from src/server.rs -> src/server/api.rs, got ${r1}`);

  cleanupTempDir(tmpDir);
}

function testRustScopedDoesNotFabricate() {
  const tmpDir = makeRustScopedCrate('wb-rs-scoped-null-');

  const mod = path.join(tmpDir, 'src', 'benchmark', 'mod.rs');
  // No submodule named `phantom` anywhere in the current module: must fall
  // through (external gate / symbol table), not guess.
  const r1 = resolveImport(mod, 'phantom::Nope', '.rs', tmpDir);
  assert(r1 === null, `unknown bare segment must not resolve, got ${r1}`);

  // std:: names a builtin, not a local file — nothing must be fabricated.
  const r2 = resolveImport(mod, 'std::io::Read', '.rs', tmpDir);
  assert(r2 === null, `std:: must stay with the builtin gate, got ${r2}`);

  // Sibling-module shapes must NOT leak across modules: grounding is a
  // submodule of benchmark, not of server.rs.
  const r3 = resolveImport(path.join(tmpDir, 'src', 'server.rs'), 'grounding::FileFacts', '.rs', tmpDir);
  assert(r3 === null, `benchmark's submodule must not resolve from server.rs, got ${r3}`);

  // crate::/super::/self:: stay with their own strategies.
  const r4 = resolveImport(mod, 'self::grounding::FileFacts', '.rs', tmpDir);
  assert(r4 === null, `self:: is not this strategy's job (no self:: handler today), got ${r4}`);

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
testRustOwnCrateNameImport();
testRustLibNameOverridesPackageName();
testRustScopedFromModFile();
testRustScopedFromCrateRootFile();
testRustScopedFromNonModFileUsesStemDir();
testRustScopedDoesNotFabricate();
console.log('gors-resolver-test: all passed');
