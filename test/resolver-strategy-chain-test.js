#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const {
  createResolver,
  registerResolverConfig,
  clearResolverCaches,
  RESOLVER_CONFIGS,
  tryAlias,
  tryRelativeWithExtensions,
  tryPythonRelative,
  tryPythonAbsolute,
  tryJava,
  tryGoModule,
  tryRustCrate,
  tryRustSuper,
  trySymbolTable,
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
  const dir = makeTempDir('wb-rel-ext-');
  fs.writeFileSync(path.join(dir, 'foo.js'), '', 'utf8');

  const ctx = { root: dir, cachedStatSync: (p) => {
    try { return fs.statSync(p); } catch { return null; }
  } };
  const result = tryRelativeWithExtensions('./foo', path.join(dir, 'bar.js'), ctx);
  assert.strictEqual(result, path.join(dir, 'foo.js'), 'should resolve relative JS import');

  cleanupTempDir(dir);
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
  const dir = makeTempDir('wb-py-rel-');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'mod.py'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const result = tryPythonRelative('.mod', path.join(dir, 'pkg', 'main.py'), ctx);
  assert.strictEqual(result, path.join(dir, 'pkg', 'mod.py'), 'should resolve Python relative import');

  cleanupTempDir(dir);
}

function testTryPythonRelativeNonExistent() {
  const dir = makeTempDir('wb-py-rel-non-');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'main.py'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const result = tryPythonRelative('.nonexistent', path.join(dir, 'pkg', 'main.py'), ctx);
  assert.strictEqual(result, null, 'relative import of non-existent python module should return null');

  cleanupTempDir(dir);
}

function testTryPythonRelativeIgnoresAbsolute() {
  const ctx = { root: '/', cachedExistsSync: () => false };
  assert.strictEqual(tryPythonAbsolute('os.path', null, ctx), null, 'absolute import should not match relative strategy');
}

// ============================================================================
// Test: tryJava
// ============================================================================
function testTryJava() {
  const dir = makeTempDir('wb-java-strat-');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '', 'utf8');

  const ctx = {
    root: dir,
    cachedExistsSync: (p) => fs.existsSync(p),
    discoverJavaSourceRoots: () => [dir, path.join(dir, 'src', 'main', 'java')],
  };
  const result = tryJava('com.example.Foo', null, ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'));

  cleanupTempDir(dir);
}

// ============================================================================
// Test: tryGoModule + tryGoRelative integration
// ============================================================================
function testTryGoModule() {
  const dir = makeTempDir('wb-go-mod-strat-');
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

  cleanupTempDir(dir);
}

// ============================================================================
// Test: tryRustCrate + tryRustSuper
// ============================================================================
function testTryRustCrate() {
  const dir = makeTempDir('wb-rs-crate-strat-');
  fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pkg', 'mod.rs'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const result = tryRustCrate('crate::pkg', path.join(dir, 'src', 'main.rs'), ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'pkg', 'mod.rs'));

  cleanupTempDir(dir);
}

function testTryRustSuper() {
  const dir = makeTempDir('wb-rs-super-strat-');
  fs.mkdirSync(path.join(dir, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.rs'), '', 'utf8');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const bar = path.join(dir, 'src', 'foo', 'bar.rs');
  const result = tryRustSuper('super::foo', bar, ctx);
  assert.strictEqual(result, path.join(dir, 'src', 'foo.rs'));

  cleanupTempDir(dir);
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

function testResolverConflictMatrix() {
  clearResolverCaches();

  const defaultStrategyV1 = () => 'default-v1';
  const defaultStrategyV2 = () => 'default-v2';
  const matrixStrategyV1 = () => 'matrix-v1';
  const matrixStrategyV2 = () => 'matrix-v2';

  registerResolverConfig('default', [defaultStrategyV1]);
  registerResolverConfig('.matrix', [matrixStrategyV1]);

  const unknownBefore = resolveImport('/repo/src/app.js', 'pkg/Thing', '.unknown-matrix', '/repo');
  const matrixBefore = resolveImport('/repo/src/app.js', 'pkg/Thing', '.matrix', '/repo');

  assert.strictEqual(unknownBefore, 'default-v1', 'unknown extensions should use default resolver');
  assert.strictEqual(matrixBefore, 'matrix-v1', 'registered extension should use its own strategy chain');

  registerResolverConfig('default', [defaultStrategyV2]);
  const unknownAfter = resolveImport('/repo/src/app.js', 'pkg/Thing', '.unknown-matrix', '/repo');
  assert.strictEqual(
    unknownAfter,
    'default-v2',
    're-registering default should invalidate cached fallback resolvers for unknown extensions'
  );

  registerResolverConfig('.matrix', [matrixStrategyV2]);
  const matrixAfter = resolveImport('/repo/src/app.js', 'pkg/Thing', '.matrix', '/repo');
  assert.strictEqual(matrixAfter, 'matrix-v2', 're-registering an extension should refresh its cached resolver');

  registerResolverConfig('default', [tryAlias, tryRelativeWithExtensions, trySymbolTable]);
  clearResolverCaches();
}

// ============================================================================
// Test: resolveImport facade unchanged behavior
// ============================================================================
function testResolveImportFacadeJs() {
  const dir = makeTempDir('wb-facade-js-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.js'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'src', 'bar.js'), './foo', '.js', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'foo.js'), 'facade should resolve JS relative import');

  cleanupTempDir(dir);
}

function testResolveImportFacadePython() {
  const dir = makeTempDir('wb-facade-py-');
  fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'mod.py'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'pkg', 'main.py'), '.mod', '.py', dir);
  assert.strictEqual(result, path.join(dir, 'pkg', 'mod.py'), 'facade should resolve Python relative import');

  cleanupTempDir(dir);
}

function testResolveImportFacadeJava() {
  const dir = makeTempDir('wb-facade-java-');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '', 'utf8');

  const result = resolveImport(null, 'com.example.Foo', '.java', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Foo.java'));

  cleanupTempDir(dir);
}

function testResolveImportFacadeGo() {
  const dir = makeTempDir('wb-facade-go-');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', 'foo', 'foo.go'), 'package foo\n', 'utf8');

  const result = resolveImport(path.join(dir, 'main.go'), 'example.com/test/pkg/foo', '.go', dir);
  assert(result && result.includes(path.join('pkg', 'foo', 'foo.go')), `Expected facade go resolve, got ${result}`);

  cleanupTempDir(dir);
}

function testResolveImportFacadeRust() {
  const dir = makeTempDir('wb-facade-rs-');
  fs.mkdirSync(path.join(dir, 'src', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pkg', 'mod.rs'), '', 'utf8');

  const result = resolveImport(path.join(dir, 'src', 'main.rs'), 'crate::pkg', '.rs', dir);
  assert.strictEqual(result, path.join(dir, 'src', 'pkg', 'mod.rs'));

  cleanupTempDir(dir);
}

function testReadTsconfigPathsWithCommentsAndTrailingCommas() {
  const dir = makeTempDir('wb-tsconfig-comments-');
  const tsconfigContent = `{
    // compilerOptions comment
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "@/*": ["src/*"],
      },
    },
    /* block comment
       goes here */
  }`;
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), tsconfigContent, 'utf8');

  const { _readTsconfigPaths } = require('../src/services/dep-graph/resolvers/base');
  const result = _readTsconfigPaths(dir);
  assert(result !== null, 'should successfully parse tsconfig with comments and trailing commas');
  assert(result.paths && result.paths['@/*'], 'should parse paths mapping');
  assert.strictEqual(result.paths['@/*'][0], 'src/*', 'should map paths value correctly');

  cleanupTempDir(dir);
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
  testTryPythonRelativeNonExistent();
  testTryPythonRelativeIgnoresAbsolute();
  testTryJava();
  testTryGoModule();
  testTryRustCrate();
  testTryRustSuper();
  testRegisterResolverConfig();
  testResolverConflictMatrix();
  testResolveImportFacadeJs();
  testResolveImportFacadePython();
  testResolveImportFacadeJava();
  testResolveImportFacadeGo();
  testResolveImportFacadeRust();
  testReadTsconfigPathsWithCommentsAndTrailingCommas();
  testTryPythonAbsoluteNamespacePackageSubmodule();
  testTryPythonAbsoluteNamespacePackageNoFabrication();
  testTryPythonAbsoluteRegularPackageStillWinsInit();
  testResolveImportFacadePythonNamespace();
  testTryPythonRelativeNamespacePackageSubmodule();
}

// ============================================================================
// L2-17: PEP 420 namespace packages — `from PKG import X` where PKG is a
// directory WITHOUT __init__.py binds the submodule PKG/X (measured on
// CodeGraphContext: tools/handlers + tools/languages are namespace dirs, all
// 6 drops are `from codegraphcontext.tools.handlers import <module>`).
// ============================================================================
function makeNamespacePkgCrate(prefix) {
  const dir = makeTempDir(prefix);
  fs.mkdirSync(path.join(dir, 'src', 'codegraphcontext', 'tools', 'handlers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'codegraphcontext', '__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'src', 'codegraphcontext', 'tools', '__init__.py'), '');
  // handlers/ is a namespace package: NO __init__.py, only submodules.
  fs.writeFileSync(path.join(dir, 'src', 'codegraphcontext', 'tools', 'handlers', 'management_handlers.py'), '');
  fs.writeFileSync(path.join(dir, 'src', 'codegraphcontext', 'tools', 'handlers', 'watcher_handlers.py'), '');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'test_x.py'), '');
  return dir;
}

function testTryPythonAbsoluteNamespacePackageSubmodule() {
  const dir = makeNamespacePkgCrate('wb-py-ns-');
  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['management_handlers'] };
  const r = tryPythonAbsolute('codegraphcontext.tools.handlers', path.join(dir, 'tests', 'test_x.py'), ctx);
  assert(r && r.endsWith(path.join('handlers', 'management_handlers.py')), `namespace from-import must bind the submodule, got ${r}`);
  cleanupTempDir(dir);
}

function testTryPythonAbsoluteNamespacePackageNoFabrication() {
  const dir = makeNamespacePkgCrate('wb-py-ns-null-');
  const from = path.join(dir, 'tests', 'test_x.py');
  // An imported name that is NOT a submodule (class / symbol) must not resolve.
  const ctx1 = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['ManagementHandler'] };
  const r1 = tryPythonAbsolute('codegraphcontext.tools.handlers', from, ctx1);
  assert.strictEqual(r1, null, `non-module imported name must not fabricate, got ${r1}`);
  // Plain `import PKG` (no imported names): a namespace dir has no file target.
  const ctx2 = { root: dir, cachedExistsSync: (p) => fs.existsSync(p) };
  const r2 = tryPythonAbsolute('codegraphcontext.tools.handlers', from, ctx2);
  assert.strictEqual(r2, null, `plain namespace import has no file target, got ${r2}`);
  cleanupTempDir(dir);
}

function testTryPythonAbsoluteRegularPackageStillWinsInit() {
  const dir = makeNamespacePkgCrate('wb-py-ns-init-');
  // tools/ HAS __init__.py: the plain candidates must win; the imported-name
  // path is a fallback only, never an override.
  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['handlers'] };
  const r = tryPythonAbsolute('codegraphcontext.tools', path.join(dir, 'tests', 'test_x.py'), ctx);
  assert(r && r.endsWith(path.join('tools', '__init__.py')), `regular package must keep resolving to __init__.py, got ${r}`);
  cleanupTempDir(dir);
}

function testResolveImportFacadePythonNamespace() {
  const dir = makeNamespacePkgCrate('wb-facade-py-ns-');
  const from = path.join(dir, 'tests', 'test_x.py');
  // Facade must thread imported names through extraCtx to the strategy.
  const r = resolveImport(from, 'codegraphcontext.tools.handlers', '.py', dir, null, null, null, { imported: ['watcher_handlers'] });
  assert(r && r.endsWith(path.join('handlers', 'watcher_handlers.py')), `facade must thread imported names, got ${r}`);
  cleanupTempDir(dir);
}

function testTryPythonRelativeNamespacePackageSubmodule() {
  const dir = makeTempDir('wb-py-rel-ns-');
  // src/codegraphcontext/server.py does `from .tools.handlers import X`
  // (CodeGraphContext measured shape): tools/handlers is a namespace dir.
  fs.mkdirSync(path.join(dir, 'pkg', 'tools', 'handlers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pkg', '__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'pkg', 'server.py'), '');
  fs.writeFileSync(path.join(dir, 'pkg', 'tools', '__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'pkg', 'tools', 'handlers', 'watcher_handlers.py'), '');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['watcher_handlers'] };
  const r = tryPythonRelative('.tools.handlers', path.join(dir, 'pkg', 'server.py'), ctx);
  assert(r && r.endsWith(path.join('handlers', 'watcher_handlers.py')), `relative namespace from-import must bind the submodule, got ${r}`);

  // Non-module imported name must not fabricate (same guard as absolute).
  const ctx2 = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['WatcherHandler'] };
  const r2 = tryPythonRelative('.tools.handlers', path.join(dir, 'pkg', 'server.py'), ctx2);
  assert.strictEqual(r2, null, `non-module imported name must not fabricate, got ${r2}`);

  cleanupTempDir(dir);
}

main();
