// @semantic
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

function testLookupBestMatchNeverResolvesToNonExported() {
  const reg = new SymbolRegistry();
  // Both candidates are top-level-but-private declarations, as recorded by the
  // JS prescan (FunctionDeclaration/ClassDeclaration at Program level).
  reg.register('src/services/debug.js', [{ name: 'debug', isExported: false }]);
  reg.register('src/utils/debug.js', [{ name: 'debug', isExported: false }]);

  // A locality bonus must not promote a private declaration into a resolution:
  // same invariant the single-location branch already enforces.
  assert.strictEqual(
    reg.lookupBestMatch('debug', 'src/services/other.js'),
    null,
    'no exported candidate exists — must not resolve to a private declaration'
  );
  assert.strictEqual(reg.lookupBestMatch('debug', 'src/utils/other.js'), null);

  // Once one of them is genuinely exported, it wins regardless of locality.
  reg.register('src/utils/debug.js', [{ name: 'debug', isExported: true }]);
  assert.strictEqual(
    reg.lookupBestMatch('debug', 'src/services/other.js'),
    'src/utils/debug.js',
    'the only exported candidate must win even when a private one sits next door'
  );
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

function testLookupUniqueNormalizesPreferredDir() {
  const reg = new SymbolRegistry();
  reg.register('project/src/main/Helper.java', [{ name: 'Helper' }]);
  reg.register('project/src/other/Helper.java', [{ name: 'Helper' }]);

  // Redundant separators and trailing slash should still resolve to the preferred directory.
  assert.strictEqual(
    reg.lookupUnique('Helper', 'project/src//main/'),
    'project/src/main/Helper.java',
    'should normalize preferredDir before prefix matching'
  );
}

function testLookupUniqueWithWindowsNativePreferredDir() {
  const reg = new SymbolRegistry();
  // On Windows, registry keys are normalized POSIX + lowercased drive letters.
  reg.register('c:/project/src/main/Helper.java', [{ name: 'Helper' }]);
  reg.register('c:/project/src/other/Helper.java', [{ name: 'Helper' }]);

  if (process.platform === 'win32') {
    // preferredDir arrives from path.dirname() as a native Windows path.
    assert.strictEqual(
      reg.lookupUnique('Helper', 'C:\\project\\src\\main'),
      'c:/project/src/main/Helper.java',
      'should match Windows-native preferredDir against normalized registry keys'
    );
  } else {
    // POSIX cannot meaningfully normalize a Windows absolute path; verify stability.
    assert.strictEqual(reg.lookupUnique('Helper', 'C:\\project\\src\\main'), null);
  }
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
  testLookupBestMatchNeverResolvesToNonExported,
  testLookupUnique,
  testLookupUniqueNormalizesPreferredDir,
  testLookupUniqueWithWindowsNativePreferredDir,
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
