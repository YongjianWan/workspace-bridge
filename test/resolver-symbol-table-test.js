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

function testSvelteCallerCoveredByJsFamilyGate() {
  // .svelte shares the JS family's whole disease shape — package.json, node
  // builtins, same import syntax — and belongs inside the same gate
  // (TECH_DEBT L2-11 Svelte leg: JS_FAMILY_EXTENSIONS listed .vue but
  // forgot .svelte).
  const tmpDir = makeJsProject({ name: 't', devDependencies: { svelte: '^4.0.0' } });
  const { registry } = withLocalSymbol(tmpDir, 'path');
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'src', 'App.svelte'));

  assert.strictEqual(trySymbolTable('path', from, ctx), null, 'a .svelte caller must not guess node builtins against local symbols');
  assert.strictEqual(trySymbolTable('svelte', from, ctx), null, 'a .svelte caller must not guess declared deps against local symbols');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// JVM: no manifest reader yet, but the registry already declares the stdlib
// prefixes (isBuiltIn — formerly dead config, L3-6). The gate must consult it
// for languages that have no EXTERNAL_DEPENDENCY_CHECKS row.
// ---------------------------------------------------------------------------

function testJavaStdlibNotGuessed() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/Utils.java'), [{ name: 'List', kind: 'class', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: '/repo' };

  assert.strictEqual(
    trySymbolTable('java.util.List', P('/src/Main.java'), ctx),
    null,
    'java.* must not resolve to a local same-named class'
  );
  assert.strictEqual(
    trySymbolTable('javax.annotation.Nonnull', P('/src/Main.java'), ctx),
    null,
    'javax.* must not resolve to a local same-named class'
  );
}

function testKotlinStdlibNotGuessed() {
  const registry = new SymbolRegistry();
  registry.register(P('/src/Helpers.kt'), [{ name: 'List', kind: 'class', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: '/repo' };

  assert.strictEqual(
    trySymbolTable('kotlin.collections.List', P('/src/Main.kt'), ctx),
    null,
    'kotlin.* must not resolve to a local same-named class'
  );
}

function testJavaThirdPartyStillGuessesForNow() {
  // Documents the remaining half of L2-11: without a pom/gradle reader the
  // gate cannot tell com.google.* from com.example.*, so it stays out of the
  // way. When the manifest reader lands this test must be INVERTED — its
  // current green is the debt, not the goal.
  const registry = new SymbolRegistry();
  const file = P('/src/Utils.java');
  registry.register(file, [{ name: 'Helper', kind: 'class', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: '/repo' };

  assert.strictEqual(
    trySymbolTable('com.example.Helper', P('/src/Main.java'), ctx),
    file,
    'a non-stdlib Java import must still reach the symbol table'
  );
}

// ---------------------------------------------------------------------------
// Rust: same disease, measured on reference/qartez-mcp — 361 of its 642 edges
// came from the symbol table, and 48 of those pointed at local files from
// `std::process::Command`, `rmcp::…` (an external crate) and `tokio::…`.
// ---------------------------------------------------------------------------
function makeRustProject(cargoToml) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-sym-rust-'));
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), cargoToml);
  return tmpDir;
}

function rustRegistry(tmpDir, name, file) {
  const registry = new SymbolRegistry();
  const target = P(path.join(tmpDir, 'src', file));
  registry.register(target, [{ name, kind: 'struct', isExported: true }]);
  return { registry, target };
}

function testRustStdlibNotGuessed() {
  const tmpDir = makeRustProject('[package]\nname = "app"\n\n[dependencies]\n');
  const { registry } = rustRegistry(tmpDir, 'Command', 'cli.rs');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  const result = trySymbolTable('std::process::Command', P(path.join(tmpDir, 'tests', 'it.rs')), ctx);
  assert.strictEqual(result, null, 'std:: paths must not resolve to a local file that happens to declare the name');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testDeclaredCrateNotGuessed() {
  // Cargo package names are hyphenated; code refers to them with underscores.
  const tmpDir = makeRustProject(
    '[package]\nname = "app"\n\n[dependencies]\nrmcp = "0.1"\nsome-crate = { version = "1", features = ["x"] }\n\n[dev-dependencies]\ntokio = "1"\n'
  );
  const { registry } = rustRegistry(tmpDir, 'QartezServer', 'server.rs');
  registry.register(P(path.join(tmpDir, 'src', 'runtime.rs')), [{ name: 'spawn', isExported: true }]);
  registry.register(P(path.join(tmpDir, 'src', 'helper.rs')), [{ name: 'thing', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'tests', 'it.rs'));

  assert.strictEqual(trySymbolTable('rmcp::QartezServer', from, ctx), null, 'declared crate must not be guessed');
  assert.strictEqual(trySymbolTable('tokio::spawn', from, ctx), null, 'dev-dependency crate must not be guessed');
  assert.strictEqual(
    trySymbolTable('some_crate::thing', from, ctx),
    null,
    'hyphenated package name must match its underscored path form'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testCrateInternalRustPathStillResolves() {
  // Positive control: the 156 qartez_mcp:: edges are the reason this strategy
  // exists for Rust at all — integration tests address their own crate by name.
  const tmpDir = makeRustProject('[package]\nname = "qartez-mcp"\n\n[dependencies]\nrmcp = "0.1"\n');
  const { registry, target } = rustRegistry(tmpDir, 'QartezServer', 'server.rs');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  assert.strictEqual(
    trySymbolTable('qartez_mcp::server::QartezServer', P(path.join(tmpDir, 'tests', 'it.rs')), ctx),
    target,
    'a path rooted at the crate itself is not external and must still resolve'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Python: same disease again. `import requests` must never land on a local
// module that happens to export `requests` — stdlib ownership and the two
// manifest formats (requirements.txt, pyproject.toml [project] dependencies)
// are deterministic facts and outrank the guess.
// ---------------------------------------------------------------------------
function makePythonProject(files) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-sym-py-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }
  return tmpDir;
}

function pythonRegistry(tmpDir, name) {
  const registry = new SymbolRegistry();
  const target = P(path.join(tmpDir, 'src', `${name}.py`));
  registry.register(target, [{ name, kind: 'function', isExported: true }]);
  return { registry, target };
}

function testPythonStdlibNotGuessed() {
  const tmpDir = makePythonProject({});
  const { registry } = pythonRegistry(tmpDir, 'join');
  registry.register(P(path.join(tmpDir, 'src', 'json.py')), [{ name: 'json', isExported: true }]);
  registry.register(P(path.join(tmpDir, 'src', '__future__.py')), [{ name: 'annotations', isExported: true }, { name: '__future__', isExported: true }]);
  registry.register(P(path.join(tmpDir, 'src', 'tomllib.py')), [{ name: 'tomllib', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'src', 'app.py'));

  assert.strictEqual(trySymbolTable('os.path.join', from, ctx), null, 'stdlib submodule path must not be guessed');
  assert.strictEqual(trySymbolTable('json', from, ctx), null, 'stdlib top-level module must not be guessed');
  assert.strictEqual(trySymbolTable('__future__.annotations', from, ctx), null, '__future__ submodule path must not be guessed (L2-11 gap B)');
  assert.strictEqual(trySymbolTable('__future__', from, ctx), null, '__future__ top-level module must not be guessed (L2-11 gap B)');
  assert.strictEqual(trySymbolTable('tomllib', from, ctx), null, 'tomllib (3.11+ stdlib) must not be guessed — measured in CodeGraphContext droppedImports');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testPythonRequirementsDeclaredNotGuessed() {
  const tmpDir = makePythonProject({
    'requirements.txt': '# comment\nrequests\nflask>=2.0\nuvicorn[standard]\n',
  });
  const { registry } = pythonRegistry(tmpDir, 'requests');
  registry.register(P(path.join(tmpDir, 'src', 'flask.py')), [{ name: 'flask', isExported: true }]);
  registry.register(P(path.join(tmpDir, 'src', 'uvicorn.py')), [{ name: 'uvicorn', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'src', 'app.py'));

  assert.strictEqual(trySymbolTable('requests', from, ctx), null, 'requirements.txt entry must not be guessed');
  assert.strictEqual(trySymbolTable('flask', from, ctx), null, 'version specifier must be stripped before matching');
  assert.strictEqual(trySymbolTable('uvicorn', from, ctx), null, 'extras bracket must be stripped before matching');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testPythonPyprojectDeclaredNotGuessed() {
  const tmpDir = makePythonProject({
    'pyproject.toml': '[project]\nname = "app"\ndependencies = [\n  "rich>=13",\n  "python-dotenv",\n]\n',
  });
  const { registry } = pythonRegistry(tmpDir, 'rich');
  registry.register(P(path.join(tmpDir, 'src', 'dotenv.py')), [{ name: 'dotenv', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'src', 'app.py'));

  assert.strictEqual(trySymbolTable('rich', from, ctx), null, 'pyproject dependency must not be guessed');
  assert.strictEqual(trySymbolTable('dotenv', from, ctx), null, 'python-dotenv must match its import name dotenv');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testPythonWorkspaceModuleStillResolves() {
  // Positive control: nothing owns `mymod`, so the guess remains intended.
  const tmpDir = makePythonProject({
    'requirements.txt': 'requests\n',
    'pyproject.toml': '[project]\nname = "app"\ndependencies = ["rich"]\n',
  });
  const { registry, target } = pythonRegistry(tmpDir, 'mymod');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  assert.strictEqual(
    trySymbolTable('mymod', P(path.join(tmpDir, 'src', 'app.py')), ctx),
    target,
    'an unowned specifier must still fall back to the symbol table'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Go: the cheapest gate of all — Go imports always carry their full path, so
// ownership is deterministic. A specifier rooted at the module's own path
// (go.mod `module …`) is workspace-internal; a dotted first segment is an
// external module; a dot-less one is the standard library. Only the first
// kind may be guessed against local symbols.
// ---------------------------------------------------------------------------
function makeGoProject(files) {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-sym-go-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }
  return tmpDir;
}

function goRegistry(tmpDir, name) {
  const registry = new SymbolRegistry();
  const target = P(path.join(tmpDir, 'pkg', `${name}.go`));
  registry.register(target, [{ name, kind: 'function', isExported: true }]);
  return { registry, target };
}

function testGoStdlibNotGuessed() {
  const tmpDir = makeGoProject({ 'go.mod': 'module example.com/mymod\n\ngo 1.22\n' });
  const { registry } = goRegistry(tmpDir, 'json');
  registry.register(P(path.join(tmpDir, 'pkg', 'fmt.go')), [{ name: 'fmt', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'cmd', 'main.go'));

  assert.strictEqual(trySymbolTable('encoding/json', from, ctx), null, 'stdlib package path must not be guessed');
  assert.strictEqual(trySymbolTable('fmt', from, ctx), null, 'stdlib top-level package must not be guessed');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testGoExternalModuleNotGuessed() {
  const tmpDir = makeGoProject({
    'go.mod': 'module example.com/mymod\n\ngo 1.22\n\nrequire github.com/gorilla/mux v1.8.0\n',
  });
  const { registry } = goRegistry(tmpDir, 'mux');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  assert.strictEqual(
    trySymbolTable('github.com/gorilla/mux', P(path.join(tmpDir, 'cmd', 'main.go')), ctx),
    null,
    'a dotted module path is somebody else\u2019s module and must not be guessed'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testGoNoModFileStillGates() {
  // Without go.mod we cannot know the own module path, but the two external
  // classes are still deterministic: dotted = external module, dot-less =
  // stdlib. Guessing those against local symbols was pure risk.
  const tmpDir = makeGoProject({});
  const { registry } = goRegistry(tmpDir, 'bar');
  registry.register(P(path.join(tmpDir, 'pkg', 'fmt.go')), [{ name: 'fmt', isExported: true }]);
  const ctx = { symbolRegistry: registry, root: tmpDir };
  const from = P(path.join(tmpDir, 'cmd', 'main.go'));

  assert.strictEqual(trySymbolTable('github.com/foo/bar', from, ctx), null, 'dotted path must be gated even without go.mod');
  assert.strictEqual(trySymbolTable('fmt', from, ctx), null, 'dot-less path is stdlib and must be gated even without go.mod');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testGoOwnModuleStillResolves() {
  // Positive control, symmetric to the qartez_mcp:: Rust case: packages inside
  // the module itself are legitimately resolvable by name.
  const tmpDir = makeGoProject({
    'go.mod': 'module example.com/mymod\n\ngo 1.22\n\nrequire github.com/gorilla/mux v1.8.0\n',
  });
  const { registry, target } = goRegistry(tmpDir, 'helper');
  const ctx = { symbolRegistry: registry, root: tmpDir };

  assert.strictEqual(
    trySymbolTable('example.com/mymod/pkg/helper', P(path.join(tmpDir, 'cmd', 'main.go')), ctx),
    target,
    'a path rooted at the module itself is not external and must still resolve'
  );

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
  testSvelteCallerCoveredByJsFamilyGate,
  testJavaStdlibNotGuessed,
  testKotlinStdlibNotGuessed,
  testJavaThirdPartyStillGuessesForNow,
  testRustStdlibNotGuessed,
  testDeclaredCrateNotGuessed,
  testCrateInternalRustPathStillResolves,
  testPythonStdlibNotGuessed,
  testPythonRequirementsDeclaredNotGuessed,
  testPythonPyprojectDeclaredNotGuessed,
  testPythonWorkspaceModuleStillResolves,
  testGoStdlibNotGuessed,
  testGoExternalModuleNotGuessed,
  testGoNoModFileStillGates,
  testGoOwnModuleStillResolves,
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
