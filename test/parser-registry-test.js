// @contract
const assert = require('assert');
const { registry } = require('../src/services/dep-graph/parsers/registry');

function testJsFamilyExtsAreRegistered() {
  const jsExts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
  for (const ext of jsExts) {
    const entry = registry.findByExt(ext);
    assert.ok(entry, `expected registry.findByExt('${ext}') to return an entry, got undefined`);
    assert.strictEqual(entry.name, 'javascript', `expected ext '${ext}' to map to 'javascript', got '${entry.name}'`);
  }
}

function testPythonExtsAreRegistered() {
  const entry = registry.findByExt('.py');
  assert.ok(entry, 'registry.findByExt(".py") should return an entry');
  assert.strictEqual(entry.name, 'python');
}

function testVueExtIsRegistered() {
  const entry = registry.findByExt('.vue');
  assert.ok(entry, 'registry.findByExt(".vue") should return an entry');
  assert.strictEqual(entry.name, 'vue');
}

function testSvelteExtIsRegistered() {
  const entry = registry.findByExt('.svelte');
  assert.ok(entry, 'registry.findByExt(".svelte") should return an entry');
  assert.strictEqual(entry.name, 'svelte');
}

function testRegistryBoundaryAndAttributes() {
  const entry = registry.findByExt('.unknown-xyz');
  assert.strictEqual(entry, undefined, 'unknown extension should return undefined');

  const jsEntry = registry.findByExt('.js');
  assert.strictEqual(jsEntry.async, false, 'JS parser should be synchronous');
  assert.strictEqual(jsEntry.needsFilePath, true, 'JS parser should require file path');
}

if (require.main === module) {
  testJsFamilyExtsAreRegistered();
  testPythonExtsAreRegistered();
  testVueExtIsRegistered();
  testSvelteExtIsRegistered();
  testRegistryBoundaryAndAttributes();
}

