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
const { packageManifestChain, discoverJavaSourceRoots } = require('../src/services/dep-graph/resolvers/base');

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
  testTryPythonAbsoluteRegularPackageWinsAcrossSearchRoots();
  testPackageManifestChainReturnsNativePaths();
  testDiscoverJavaSourceRootsKmpSourceSetLayout();
  testDiscoverJavaSourceRootsContainerDirDepth2();
  testTryJavaMemberImportsStripToClassFile();
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

// The namespace fallback is a fallback GLOBALLY, not per searchRoot. searchRoots
// is a heuristic priority list ([root, backend, src, app]), so short-circuiting
// `plain || namespace` inside each root lets an earlier root's WEAK evidence (a
// namespace dir that happens to hold a matching filename) beat a later root's
// STRONG evidence (a real __init__.py). src-layout repos with a same-named
// directory left at the root are exactly this shape.
function testTryPythonAbsoluteRegularPackageWinsAcrossSearchRoots() {
  const dir = makeTempDir('wb-py-ns-rootorder-');
  // <root>/mypkg/ — namespace dir (no __init__.py) that happens to hold thing.py
  fs.mkdirSync(path.join(dir, 'mypkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mypkg', 'thing.py'), '');
  // <root>/src/mypkg/ — the REAL regular package, later in searchRoots
  fs.mkdirSync(path.join(dir, 'src', 'mypkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'mypkg', '__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'src', 'mypkg', 'thing.py'), '');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'test_x.py'), '');

  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), imported: ['thing'] };
  const r = tryPythonAbsolute('mypkg', path.join(dir, 'tests', 'test_x.py'), ctx);
  assert(
    r && r.endsWith(path.join('src', 'mypkg', '__init__.py')),
    `a real __init__.py in a later searchRoot must beat an earlier root's namespace fallback, got ${r}`
  );

  cleanupTempDir(dir);
}

// Path-shape contract, shared with findCargoCrateRoot: helpers that WALK the
// tree compare in normalizePathKey space but RETURN platform-native,
// original-case directories. Consumers path.join / startsWith against paths
// that came from the file index (native casing), so a normalized return value
// breaks their arithmetic — and on Windows it also splits readPackageDeps's
// mtime cache into two entries for the same directory.
function testPackageManifestChainReturnsNativePaths() {
  const dir = makeTempDir('wb-Manifest-Case-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'packages', 'SubPkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'SubPkg', 'package.json'), '{}');

  const subDir = path.join(dir, 'packages', 'SubPkg');
  const chain = packageManifestChain(subDir, dir);
  assert.strictEqual(chain.length, 2, `chain must hold both manifests, got ${JSON.stringify(chain)}`);
  assert.strictEqual(chain[0], subDir, 'nearest manifest dir must come back platform-native and original-case');
  assert.strictEqual(chain[1], path.resolve(dir), 'root manifest dir must come back platform-native and original-case');

  cleanupTempDir(dir);
}

// L2-14: KMP / non-standard Gradle layouts put sources at
// <module>/src/<sourceSet>/{kotlin,java} — one level deeper than the Maven
// standard and with an ARBITRARY sourceSet name (commonJvmAndroid, jvmTest,
// desktopMain, …). Hardcoding sourceSet names would just be the same bug
// wearing a list; the scan must key on the leaf names `kotlin`/`java`.
// okhttp's main sources live exactly there, which is why 43% of its edges
// fell through to symbol-table guessing.
function testDiscoverJavaSourceRootsKmpSourceSetLayout() {
  const dir = makeTempDir('wb-java-kmp-');
  // KMP layout, arbitrary sourceSet names
  const kmpKotlin = path.join(dir, 'okhttp', 'src', 'commonJvmAndroid', 'kotlin');
  fs.mkdirSync(path.join(kmpKotlin, 'okhttp3'), { recursive: true });
  fs.writeFileSync(path.join(kmpKotlin, 'okhttp3', 'HttpUrl.kt'), '');
  const kmpJava = path.join(dir, 'okhttp', 'src', 'jvmTest', 'java');
  fs.mkdirSync(path.join(kmpJava, 'okhttp3'), { recursive: true });
  fs.writeFileSync(path.join(kmpJava, 'okhttp3', 'HttpUrlTest.java'), '');
  // non-code leaves under a sourceSet must NOT become roots
  fs.mkdirSync(path.join(dir, 'okhttp', 'src', 'commonJvmAndroid', 'resources'), { recursive: true });
  // standard Maven layout in a sibling module still works
  const stdRoot = path.join(dir, 'mockwebserver3', 'src', 'main', 'kotlin');
  fs.mkdirSync(path.join(stdRoot, 'mockwebserver3'), { recursive: true });
  fs.writeFileSync(path.join(stdRoot, 'mockwebserver3', 'MockWebServer.kt'), '');

  const roots = discoverJavaSourceRoots(dir);
  assert(
    roots.some((r) => r === kmpKotlin),
    `KMP sourceSet kotlin root must be discovered, got ${JSON.stringify(roots)}`
  );
  assert(
    roots.some((r) => r === kmpJava),
    `KMP sourceSet java root must be discovered, got ${JSON.stringify(roots)}`
  );
  assert(
    roots.some((r) => r === stdRoot),
    `standard module layout must keep working, got ${JSON.stringify(roots)}`
  );
  assert(
    !roots.some((r) => r.endsWith('resources')),
    `non-code leaves must not become source roots, got ${JSON.stringify(roots)}`
  );
  const dupes = roots.filter((r, i) => roots.indexOf(r) !== i);
  assert.strictEqual(dupes.length, 0, `roots must be deduplicated, got ${JSON.stringify(dupes)}`);

  // End-to-end: tryJava resolves through a discovered KMP root — this is the
  // layer the user consumes, not the roots list itself.
  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), discoverJavaSourceRoots };
  const hit = tryJava('okhttp3.HttpUrl', null, ctx);
  assert(
    hit && hit.endsWith(path.join('okhttp3', 'HttpUrl.kt')),
    `tryJava must resolve a package whose source root is a KMP sourceSet, got ${hit}`
  );

  cleanupTempDir(dir);
}

// Kotlin companion/extension and Java nested-class imports extend PAST the
// class name: `import okhttp3.HttpUrl.Companion.toHttpUrl` is a member of
// HttpUrl, and the file binding is still HttpUrl.kt. tryJava must strip
// trailing segments (longest match wins) instead of treating the whole
// dotted path as a file path — okhttp's samples are full of this shape, and
// every one of them fell through to symbol-table or droppedImports.
function testTryJavaMemberImportsStripToClassFile() {
  const dir = makeTempDir('wb-java-member-');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'kotlin', 'okhttp3'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'kotlin', 'okhttp3', 'HttpUrl.kt'), '', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Outer.java'), '', 'utf8');

  const ctx = {
    root: dir,
    cachedExistsSync: (p) => fs.existsSync(p),
    discoverJavaSourceRoots: () => [path.join(dir, 'src', 'main', 'kotlin'), path.join(dir, 'src', 'main', 'java')],
  };

  // Kotlin companion member import → the class's file
  const companion = tryJava('okhttp3.HttpUrl.Companion.toHttpUrl', null, ctx);
  assert.strictEqual(
    companion,
    path.join(dir, 'src', 'main', 'kotlin', 'okhttp3', 'HttpUrl.kt'),
    `companion member import must bind the class file, got ${companion}`
  );
  // Kotlin nested class import → outer class's file
  const nested = tryJava('okhttp3.HttpUrl.Builder', null, ctx);
  assert.strictEqual(
    nested,
    path.join(dir, 'src', 'main', 'kotlin', 'okhttp3', 'HttpUrl.kt'),
    `nested class import must bind the outer class file, got ${nested}`
  );
  // Java nested class, deeper chain
  const javaNested = tryJava('com.example.Outer.Inner.Deep', null, ctx);
  assert.strictEqual(
    javaNested,
    path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Outer.java'),
    `java nested chain must strip to the outer class file, got ${javaNested}`
  );
  // Full path that resolves directly must NOT be disturbed by stripping
  const direct = tryJava('okhttp3.HttpUrl', null, ctx);
  assert.strictEqual(
    direct,
    path.join(dir, 'src', 'main', 'kotlin', 'okhttp3', 'HttpUrl.kt'),
    `direct class import must keep resolving as before, got ${direct}`
  );
  // No prefix matches a file → still null, do not bind a package-level shot
  const miss = tryJava('okhttp3.Nonexistent.Member', null, ctx);
  assert.strictEqual(miss, null, `unknown class must stay unresolved, got ${miss}`);

  cleanupTempDir(dir);
}

// ============================================================================
// depth≥2 container modules: a directory with no src of its own can hold
// sibling modules one level deeper (okhttp's samples/ holds 8 modules, each
// with src/main/kotlin — measured 2026-07-31: 10 symbol-table edges in
// samples/tlssurvey had class name == file name, pure structure gap). The
// multi-module scan used to stop at root+1. Dependency/build noise dirs must
// NOT be descended into — an npm fixture (node_modules/x/src/main/java) or
// generated output is not a source root.
// ============================================================================
function testDiscoverJavaSourceRootsContainerDirDepth2() {
  const dir = makeTempDir('wb-java-depth2-');
  // Container dir with NO src of its own, holding a module one level deeper
  const deepKotlin = path.join(dir, 'samples', 'tlssurvey', 'src', 'main', 'kotlin');
  fs.mkdirSync(path.join(deepKotlin, 'okhttp3', 'survey', 'types'), { recursive: true });
  fs.writeFileSync(path.join(deepKotlin, 'okhttp3', 'survey', 'types', 'Client.kt'), '');
  // A normal depth-1 module keeps working
  const stdRoot = path.join(dir, 'okhttp', 'src', 'main', 'kotlin');
  fs.mkdirSync(path.join(stdRoot, 'okhttp3'), { recursive: true });
  fs.writeFileSync(path.join(stdRoot, 'okhttp3', 'HttpUrl.kt'), '');
  // Noise dirs that must NOT be descended into
  const nmRoot = path.join(dir, 'node_modules', 'somepkg', 'src', 'main', 'java');
  fs.mkdirSync(nmRoot, { recursive: true });
  const buildRoot = path.join(dir, 'build', 'generated', 'src', 'main', 'java');
  fs.mkdirSync(buildRoot, { recursive: true });

  const roots = discoverJavaSourceRoots(dir);
  assert(
    roots.some((r) => r === deepKotlin),
    `module under a src-less container dir must be discovered, got ${JSON.stringify(roots)}`
  );
  assert(
    roots.some((r) => r === stdRoot),
    `depth-1 module must keep working, got ${JSON.stringify(roots)}`
  );
  assert(
    !roots.some((r) => r.includes('node_modules')),
    `node_modules must not be descended into, got ${JSON.stringify(roots)}`
  );
  assert(
    !roots.some((r) => r === buildRoot),
    `build output must not be descended into, got ${JSON.stringify(roots)}`
  );

  // End-to-end: the okhttp samples/tlssurvey shape resolves through tryJava,
  // no symbol-table fallback needed.
  const ctx = { root: dir, cachedExistsSync: (p) => fs.existsSync(p), discoverJavaSourceRoots };
  const hit = tryJava('okhttp3.survey.types.Client', null, ctx);
  assert(
    hit && hit.endsWith(path.join('okhttp3', 'survey', 'types', 'Client.kt')),
    `tryJava must resolve a class under a depth-2 container module, got ${hit}`
  );

  cleanupTempDir(dir);
}

main();
