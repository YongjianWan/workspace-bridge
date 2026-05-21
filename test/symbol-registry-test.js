const assert = require('assert');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');

function testRegisterAndLookup() {
  const reg = new SymbolRegistry();
  reg.register('a.js', [{ name: 'foo', kind: 'function' }, { name: 'bar', kind: 'const' }]);

  const fooLocs = reg.lookup('foo');
  assert.strictEqual(fooLocs.length, 1);
  assert.strictEqual(fooLocs[0].file, 'a.js');
  assert.strictEqual(fooLocs[0].kind, 'function');

  const barLocs = reg.lookup('bar');
  assert.strictEqual(barLocs.length, 1);

  assert.deepStrictEqual(reg.getExportedSymbols('a.js'), ['foo', 'bar']);
}

function testDuplicateSymbols() {
  const reg = new SymbolRegistry();
  reg.register('a.js', [{ name: 'foo' }]);
  reg.register('b.js', [{ name: 'foo' }]);

  const fooLocs = reg.lookup('foo');
  assert.strictEqual(fooLocs.length, 2);

  const stats = reg.getRegistryStats();
  assert.strictEqual(stats.symbolCount, 1);
  assert.strictEqual(stats.fileCount, 2);
  assert.strictEqual(stats.duplicateSymbols, 1);
}

function testLookupUnique() {
  const reg = new SymbolRegistry();
  reg.register('a.js', [{ name: 'foo' }]);
  assert.strictEqual(reg.lookupUnique('foo'), 'a.js');

  reg.register('b.js', [{ name: 'foo' }]);
  assert.strictEqual(reg.lookupUnique('foo'), null);

  // With preferredDir
  reg.register('src/utils/x.js', [{ name: 'helper' }]);
  reg.register('src/components/y.js', [{ name: 'helper' }]);
  assert.strictEqual(reg.lookupUnique('helper', 'src/utils/'), 'src/utils/x.js');
  assert.strictEqual(reg.lookupUnique('helper', 'src/components/'), 'src/components/y.js');
  assert.strictEqual(reg.lookupUnique('helper', 'nonexistent/'), null);
}

function testUnregister() {
  const reg = new SymbolRegistry();
  reg.register('a.js', [{ name: 'foo' }, { name: 'bar' }]);
  reg.register('b.js', [{ name: 'foo' }]);

  reg.unregister('a.js');
  assert.deepStrictEqual(reg.getExportedSymbols('a.js'), []);

  // foo should still exist from b.js
  const fooLocs = reg.lookup('foo');
  assert.strictEqual(fooLocs.length, 1);
  assert.strictEqual(fooLocs[0].file, 'b.js');

  // bar should be gone
  assert.deepStrictEqual(reg.lookup('bar'), []);
}

function testClear() {
  const reg = new SymbolRegistry();
  reg.register('a.js', [{ name: 'foo' }]);
  reg.clear();
  assert.strictEqual(reg.exports.size, 0);
  assert.strictEqual(reg.files.size, 0);
}

function testRegisterEmpty() {
  const reg = new SymbolRegistry();
  reg.register('a.js', []);
  reg.register('a.js', undefined);
  assert.strictEqual(reg.exports.size, 0);
}

function testLookupMissing() {
  const reg = new SymbolRegistry();
  assert.deepStrictEqual(reg.lookup('nonexistent'), []);
  assert.strictEqual(reg.lookupUnique('nonexistent'), null);
}

// --- Run all ---

const tests = [
  testRegisterAndLookup,
  testDuplicateSymbols,
  testLookupUnique,
  testUnregister,
  testClear,
  testRegisterEmpty,
  testLookupMissing,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
    passed++;
    console.log(`  PASS: ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${t.name} —`, e.message);
  }
}

console.log(`\n${passed}/${tests.length} passed${failed > 0 ? `, ${failed} failed` : ''}`);
if (failed > 0) process.exit(1);
