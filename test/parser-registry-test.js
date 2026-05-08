const assert = require('assert');
const { registry } = require('../src/services/dep-graph/parsers/registry');

function testJsFamilyExtsAreRegistered() {
  const jsExts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
  for (const ext of jsExts) {
    const entry = registry.findByExt(ext);
    assert.ok(entry, `expected registry.findByExt('${ext}') to return an entry, got undefined`);
    assert.strictEqual(entry.name, 'javascript', `expected ext '${ext}' to map to 'javascript', got '${entry.name}'`);
  }
  console.log('✓ testJsFamilyExtsAreRegistered');
}

function testPythonExtsAreRegistered() {
  const entry = registry.findByExt('.py');
  assert.ok(entry);
  assert.strictEqual(entry.name, 'python');
  console.log('✓ testPythonExtsAreRegistered');
}

function testVueExtIsRegistered() {
  const entry = registry.findByExt('.vue');
  assert.ok(entry);
  assert.strictEqual(entry.name, 'vue');
  console.log('✓ testVueExtIsRegistered');
}

function testSvelteExtIsRegistered() {
  const entry = registry.findByExt('.svelte');
  assert.ok(entry);
  assert.strictEqual(entry.name, 'svelte');
  console.log('✓ testSvelteExtIsRegistered');
}

if (require.main === module) {
  testJsFamilyExtsAreRegistered();
  testPythonExtsAreRegistered();
  testVueExtIsRegistered();
  testSvelteExtIsRegistered();
  console.log('All parser-registry tests passed');
}
