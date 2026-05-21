const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { trySymbolTable } = require('../src/services/dep-graph/resolvers');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');

function testNullRegistryReturnsNull() {
  const ctx = { symbolRegistry: null };
  const result = trySymbolTable('com.example.Foo', '/src/main.java', ctx);
  assert.strictEqual(result, null, 'should return null when symbolRegistry is absent');
}

function testRelativeImportIgnored() {
  const registry = new SymbolRegistry();
  registry.register('/src/Foo.java', [{ name: 'Foo' }]);
  const ctx = { symbolRegistry: registry };

  const r1 = trySymbolTable('./Foo', '/src/main.java', ctx);
  assert.strictEqual(r1, null, 'relative import should bypass symbol table');

  const r2 = trySymbolTable('/absolute/Foo', '/src/main.java', ctx);
  assert.strictEqual(r2, null, 'absolute path import should bypass symbol table');
}

function testUniqueSymbolMatch() {
  const registry = new SymbolRegistry();
  registry.register('/src/Utils.java', [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', '/src/main.java', ctx);
  assert.strictEqual(result, '/src/Utils.java', 'should resolve via symbol name when unique');
}

function testMultipleSymbolsReturnNull() {
  const registry = new SymbolRegistry();
  registry.register('/src/A.java', [{ name: 'Helper' }]);
  registry.register('/src/B.java', [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', '/src/main.java', ctx);
  assert.strictEqual(result, null, 'should return null when symbol is ambiguous');
}

function testFromDirPreference() {
  const registry = new SymbolRegistry();
  registry.register('/src/other/Helper.java', [{ name: 'Helper' }]);
  registry.register('/src/main/Helper.java', [{ name: 'Helper' }]);
  const ctx = { symbolRegistry: registry };

  const result = trySymbolTable('com.example.Helper', '/src/main/Caller.java', ctx);
  assert.strictEqual(result, '/src/main/Helper.java', 'should prefer symbol in same directory');
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
  registry.register('/src/Handler.java', [{ name: 'Handler' }]);
  const ctx = { symbolRegistry: registry };

  const r1 = trySymbolTable('org.foo.bar.Handler', '/src/Main.java', ctx);
  assert.strictEqual(r1, '/src/Handler.java');

  const r2 = trySymbolTable('Handler', '/src/Main.java', ctx);
  assert.strictEqual(r2, '/src/Handler.java');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const tests = [
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
