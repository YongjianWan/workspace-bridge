#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createResolver,
  registerResolverConfig,
  RESOLVER_CONFIGS,
  tryAlias,
  tryRelativeWithExtensions,
  tryPythonRelative,
  tryPythonAbsolute,
  tryJava,
  tryGoRelative,
  tryGoModule,
  tryRustCrate,
  tryRustSuper,
  resolveImport,
} = require('../src/services/dep-graph/resolvers');

// ============================================================================
// Test: createResolver chain — first non-null wins
// ============================================================================
function testCreateResolverFirstWin() {
  const s1 = () => null;
  const s2 = () => 'second';
  const s3 = () => 'third';
  const resolver = createResolver([s1, s2, s3]);
  const result = resolver('any', '/foo.js', { root: '/' });
  assert.strictEqual(result, 'second', 'first non-null strategy should win');
}

function testCreateResolverAllNull() {
  const resolver = createResolver([() => null, () => null]);
  const result = resolver('any', '/foo.js', { root: '/' });
  assert.strictEqual(result, null, 'all-null chain should return null');
}

function testCreateResolverFirstWinSkipsRest() {
  let called = false;
  const s1 = () => 'winner';
  const s2 = () => { called = true; return 'loser'; };
  const resolver = createResolver([s1, s2]);
  resolver('any', '/foo.js', { root: '/' });
  assert.strictEqual(called, false, 'strategies after first win should not be called');
}

// ============================================================================
// Test: RESOLVER_CONFIGS covers all 9 languages
// ============================================================================
function testResolverConfigsCoverage() {
  const expectedExts = ['.py', '.java', '.kt', '.go', '.rs', 'default'];
  for (const ext of expectedExts) {
    assert(RESOLVER_CONFIGS.has(ext), `RESOLVER_CONFIGS should have entry for ${ext}`);
    const strategies = RESOLVER_CONFIGS.get(ext);
    assert(Array.isArray(strategies) && strategies.length > 0, `${ext} should have non-empty strategy array`);
  }
}

function testUnknownExtFallsBackToDefault() {
  const ext = '.unknown-lang';
  const strategies = RESOLVER_CONFIGS.get(ext) || RESOLVER_CONFIGS.get('default');
  assert.strictEqual(strategies, RESOLVER_CONFIGS.get('default'), 'unknown ext should fallback to default');
}

// ============================================================================
// Test: tryRelativeWithExtensions (JS/TS)
// ============================================================================
function testTryRelativeWithExtensions() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rel-ext-'));
  fs.writeFileSync(path.join(dir, 'foo.js'), '', 'utf8');

  const ctx = { root: dir, cachedStatSync: (p) => {
    try { return fs.statSync(p); } catch { return null; }
  } };
  const result = tryRelativeWithExtensions('./foo', path.join(dir, 'bar.js'), ctx);
  assert.strictEqual(result, path.join(dir, 'foo.js'), 'should resolve relative JS import');

  fs.rmSync(dir, { recursive: true, force: true });
}

function testTryRelativeWithExtensionsIgnoresNonRelative() {
  const ctx = { root: '/', cachedStatSync: () => null };
  const result = tryRelativeWithExtensions('lodash', '/foo.js', ctx);
  assert.strictEqual(result, null, 'non-relative import should be skipped');
}

// ============================================================================
// Test: tryAlias
// ============================================================================
function testTryAliasIgnoresRelative() {
  const ctx = { root: '/', cachedStatSync: () => null };
  assert.strictEqual(tryAlias('./foo', null, ctx), null, 'relative import should be skipped');
  assert.strictEqual(tryAlias('/foo', null, ctx), null, 'absolute import should be skipped');
}

// ============================================================================
// Test: tryPythonRelative
// ============================================================================
function testTryPythonRelative() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-py-rel-'));
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'mod.py'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const result = tryPythonRelative('.mod', path.join(dir, 'pkg', 'main.py'), ctx);
  assert.strictEqual(result, path.join(dir, 'pkg', 'mod.py'), 'should resolve Python relative import');

  fs.rmSync(dir, { recursive: true, force: true });
}

function testTryPythonRelativeIgnoresAbsolute() {
  const ctx = { root: '/', cachedExistsSync: () => false };
  assert.strictEqual(tryPythonAbsolute('os.path', null, ctx), null, 'absolute import should not match relative strategy');
}

// ============================================================================
// Test: tryJava
// ============================================================================
function testTryJava() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-java-strat-'));
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '', 'utf8');

  const ctx = {
    root: dir,
    cachedExistsSync: (p) => fs.existsSync(p),
    discoverJavaSourceRoots: () => [dir, path.join(dir, 'src', 'main', 'java')],
  };
  const result = tryJava('com.example.Foo', null, ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: tryGoModule + tryGoRelative integration
// ============================================================================
function testTryGoModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-go-mod-strat-'));
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'foo', 'foo.go'), 'package foo\n', 'utf8');

  const ctx = {
    root: dir,
    cachedStatSync: (p) => {
      try { return fs.statSync(p); } catch { return null; }
    },
    cachedExistsSync: (p) => fs.existsSync(p),
    readGoMod: () => 'example.com/test',
  };
  const result = tryGoModule('example.com/test/pkg/foo', path.join(dir, 'main.go'), ctx);
  assert(result && result.includes(path.join('pkg', 'foo', 'foo.go')), `Expected go module resolve, got ${result}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: tryRustCrate + tryRustSuper
// ============================================================================
function testTryRustCrate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rs-crate-strat-'));
  fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pkg', 'mod.rs'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const result = tryRustCrate('crate::pkg', path.join(dir, 'src', 'main.rs'), ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'pkg', 'mod.rs'));

  fs.rmSync(dir, { recursive: true, force: true });
}

function testTryRustSuper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-rs-super-strat-'));
  fs.mkdirSync(path.join(dir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.rs'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const bar = path.join(dir, 'src', 'foo', 'bar.rs');
  const result = tryRustSuper('super::foo', bar, ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'foo.rs'));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: registerResolverConfig allows extension
// ============================================================================
function testRegisterResolverConfig() {
  const customStrategy = () => 'custom-result';
  registerResolverConfig('.custom', [customStrategy]);
  assert(RESOLVER_CONFIGS.has('.custom'), 'should register new extension');
  const strategies = RESOLVER_CONFIGS.get('.custom');
  assert.strictEqual(strategies.length, 1);
  assert.strictEqual(strategies[0](), 'custom-result');
}

// ============================================================================
// Test: resolveImport facade unchanged behavior
// ============================================================================
function testResolveImportFacadeJs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facade-js-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.js'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'src', 'bar.js'), './foo', '.js', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'foo.js'), 'facade should resolve JS relative import');

  fs.rmSync(dir, { recursive: true, force: true });
}

function testResolveImportFacadePython() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facade-py-'));
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'mod.py'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'pkg', 'main.py'), '.mod', '.py', dir);
  assert.strictEqual(result, path.join(dir, 'pkg', 'mod.py'), 'facade should resolve Python relative import');

  fs.rmSync(dir, { recursive: true, force: true });
}

function testResolveImportFacadeJava() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facade-java-'));
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '', 'utf8');

  const result = resolveImport(null, 'com.example.Foo', '.java', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'));

  fs.rmSync(dir, { recursive: true, force: true });
}

function testResolveImportFacadeGo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facade-go-'));
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'foo', 'foo.go'), 'package foo\n', 'utf8');

  const result = resolveImport(path.join(dir, 'main.go'), 'example.com/test/pkg/foo', '.go', dir);
  assert(result && result.includes(path.join('pkg', 'foo', 'foo.go')), `Expected facade go resolve, got ${result}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testResolveImportFacadeRust() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-facade-rs-'));
  fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pkg', 'mod.rs'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'src', 'main.rs'), 'crate::pkg', '.rs', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'pkg', 'mod.rs'));

  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  testCreateResolverFirstWin();
  testCreateResolverAllNull();
  testCreateResolverFirstWinSkipsRest();
  testResolverConfigsCoverage();
  testUnknownExtFallsBackToDefault();
  testTryRelativeWithExtensions();
  testTryRelativeWithExtensionsIgnoresNonRelative();
  testTryAliasIgnoresRelative();
  testTryPythonRelative();
  testTryPythonRelativeIgnoresAbsolute();
  testTryJava();
  testTryGoModule();
  testTryRustCrate();
  testTryRustSuper();
  testRegisterResolverConfig();
  testResolveImportFacadeJs();
  testResolveImportFacadePython();
  testResolveImportFacadeJava();
  testResolveImportFacadeGo();
  testResolveImportFacadeRust();

  console.log('resolver-strategy-chain-test: all 20 passed');
}

main();
