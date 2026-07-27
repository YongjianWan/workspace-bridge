// @semantic
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { trySymbolTable } = require('../src/services/dep-graph/resolvers');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');
const { normalizePathKey } = require('../src/utils/path');

const P = (val) => normalizePathKey(val);

function testNullRegistryReturnsNull() {
  const ctx = { symbolRegistry: null };
  const result = trySymbolTable('com.example.Foo', P('/src/main.java'), ctx);
  assert.strictEqual(result, null, 'should return null when symbolRegistry is absent');
}

function testRelativeImportIgnored() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/Foo.java'), [{ name: 'Foo' }]);
  const ctx = { symbolRegistry: registry };

  const r1 = trySymbolTable('./Foo', P('/src/main.java'), ctx);
  assert.strictEqual(r1, null, 'relative import should bypass symbol table');

  const r2 = trySymbolTable('/absolute/Foo', P('/src/main.java'), ctx);
  assert.strictEqual(r2, null, 'absolute path import should bypass symbol table');
}

function testUniqueSymbolMatch() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/Utils.java'), [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', P('/src/main.java'), ctx);
  assert.strictEqual(result, P('/src/Utils.java'), 'should resolve via symbol name when unique');
}

function testMultipleSymbolsReturnNull() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/A.java'), [{ name: 'Helper' }]);
  registry.register(P('/src/B.java'), [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', P('/src/main.java'), ctx);
  assert.strictEqual(result, null, 'should return null when symbol is ambiguous');
}

function testFromDirPreference() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/other/Helper.java'), [{ name: 'Helper' }]);
  registry.register(P('/src/main/Helper.java'), [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', P('/src/main/Caller.java'), ctx);
  assert.strictEqual(result, P('/src/main/Helper.java'), 'should prefer symbol in same directory');
}

function testJavaFacadeFallback() {
  const { resolveImport } = require('../src/services/dep-graph/resolvers');
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-sym-fallback-'));

  // File name is "Utils.java" but class name is "Helper"
  fs.mkdirSync(path.join(tmpDir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'main', 'java', 'com', 'example', 'Utils.java'), 'package com.example;\npublic class Helper {}\n');

  const registry = new SymbolRegistry();
  registry.register(path.join(tmpDir, 'src', 'main', 'java', 'com', 'example', 'Utils.java'), [{ name: 'Helper' }]);

  // tryJava looks for com/example/Helper.java — doesn't exist
  const withoutRegistry = resolveImport(null, 'com.example.Helper', '.java', tmpDir);
  assert.strictEqual(withoutRegistry, null, 'tryJava alone should fail when filename != classname');

  // With SymbolRegistry fallback
  const withRegistry = resolveImport(null, 'com.example.Helper', '.java', tmpDir, registry);
  assert.strictEqual(withRegistry, path.join(tmpDir, 'src', 'main', 'java', 'com', 'example', 'Utils.java'), 'symbol table should fallback when tryJava fails');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testDottedImportExtractsLastSegment() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/Handler.java'), [{ name: 'Handler' }]);
  const ctx = { symbolRegistry: registry };

  const r1 = trySymbolTable('org.foo.bar.Handler', P('/src/Main.java'), ctx);
  assert.strictEqual(r1, P('/src/Handler.java'));

  const r2 = trySymbolTable('Handler', P('/src/Main.java'), ctx);
  assert.strictEqual(r2, P('/src/Handler.java'));
}

// ---------------------------------------------------------------------------
// External-package gate: a specifier naming a known third-party package must
// never be guessed against the local symbol table. Its last segment collides
// with local export names often enough (debug, config, glob, semver, path) that
// every such hit is a fabricated edge carrying confidence 0.8.
// ---------------------------------------------------------------------------
function makeJsProject(packageJson, dirs = []) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-sym-external-'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));
  for (const d of dirs) fs.mkdirSync(path.join(tmpDir, d), { recursive: true });
  return tmpDir;
}

function withLocalSymbol(tmpDir, name) {
  const registry = new SymbolRegistry();
  const file = P(path.join(tmpDir, 'src', 'utils', `${name}.js`));
  registry.register(file, [{ name, kind: 'function', isExported: true }]);
  return { registry, file };
}

function testDeclaredNpmDependencyNotGuessed() {
  const tmpDir = makeJsProject({ name: 't', dependencies: { debug: '^4.3.0' } });
  const { registry } = withLocalSymbol(tmpDir, 'debug');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('debug', P(path.join(tmpDir, 'src', 'app.js')), ctx);
  assert.strictEqual(result, null, 'a declared npm dependency must not resolve to a local same-named export');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testNodeBuiltinNotGuessed() {
  const tmpDir = makeJsProject({ name: 't' });
  const { registry } = withLocalSymbol(tmpDir, 'path');
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'src', 'app.js'));

  assert.strictEqual(trySymbolTable('path', from, ctx), null, 'node builtin must not resolve to a local export');
  assert.strictEqual(trySymbolTable('node:path', from, ctx), null, 'node: protocol specifier must not resolve to a local export');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testInstalledButUndeclaredPackageNotGuessed() {
  // No dependencies field at all — presence in node_modules is enough.
  const tmpDir = makeJsProject({ name: 't' }, [path.join('node_modules', 'chalk')]);
  const { registry } = withLocalSymbol(tmpDir, 'chalk');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('chalk', P(path.join(tmpDir, 'src', 'app.js')), ctx);
  assert.strictEqual(result, null, 'a package present in node_modules must not resolve to a local export');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testScopedDependencySubpathNotGuessed() {
  const tmpDir = makeJsProject({ name: 't', devDependencies: { '@scope/kit': '^1.0.0' } });
  const { registry } = withLocalSymbol(tmpDir, 'merge');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('@scope/kit/merge', P(path.join(tmpDir, 'src', 'app.js')), ctx);
  assert.strictEqual(result, null, 'scoped-package subpath must be attributed to the package, not a local symbol');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testUnknownBareSpecifierStillResolves() {
  // Positive control: the gate must not disable the strategy itself. Nothing
  // declares "Helper", so guessing remains the intended behaviour.
  const tmpDir = makeJsProject({ name: 't', dependencies: { debug: '^4.3.0' } });
  const { registry, file } = withLocalSymbol(tmpDir, 'Helper');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('Helper', P(path.join(tmpDir, 'src', 'app.js')), ctx);
  assert.strictEqual(result, file, 'an undeclared bare specifier should still fall back to the symbol table');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testNonJsCallerUnaffectedByJsPackageGate() {
  // package.json deps and node builtins say nothing about a Java import.
  const tmpDir = makeJsProject({ name: 't', dependencies: { path: '^1.0.0' } });
  const registry = new SymbolRegistry();
  const javaFile = P(path.join(tmpDir, 'src', 'Utils.java'));
  registry.register(javaFile, [{ name: 'path' }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('com.example.path', P(path.join(tmpDir, 'src', 'Main.java')), ctx);
  assert.strictEqual(result, javaFile, 'the JS package gate must not apply to non-JS callers');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const tests = [
  testDeclaredNpmDependencyNotGuessed,
  testNodeBuiltinNotGuessed,
  testInstalledButUndeclaredPackageNotGuessed,
  testScopedDependencySubpathNotGuessed,
  testUnknownBareSpecifierStillResolves,
  testNonJsCallerUnaffectedByJsPackageGate,
  testNullRegistryReturnsNull,
  testRelativeImportIgnored,
  testUniqueSymbolMatch,
  testMultipleSymbolsReturnNull,
  testFromDirPreference,
  testJavaFacadeFallback,
  testDottedImportExtractsLastSegment,
];

let passed = 0;
for (const t of tests) {
  try {
    t();
    passed++;
    process.stdout.write(`→ ${t.name} ... PASS\n`);
  } catch (e) {
    process.stdout.write(`→ ${t.name} ... FAIL: ${e.message}\n`);
  }
}

process.stdout.write(`\n${passed}/${tests.length} passed\n`);
if (passed !== tests.length) process.exit(1);
