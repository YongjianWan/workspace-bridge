#!/usr/bin/env node
// @contract — Python parser path selection: tree-sitter WASM primary, regex only on WASM failure

const assert = require('assert');

// Must be set before the first tree-sitter load in this process; the loader
// evicts null-settling loads, so the second test retries without the flag.
process.env.FORCE_WASM_FAIL = '1';

const { parsePython } = require('../src/services/dep-graph/parsers/python');

const SOURCE = 'def f(x: int) -> int:\n    return x\n';

async function testWasmFailureFallsBackToRegex() {
  const parsed = await parsePython(SOURCE, null);
  assert.strictEqual(parsed.parseMode, 'regex', 'WASM unavailable should degrade to regex, not spawn');
}

async function testNormalPathIsTreeSitterAst() {
  delete process.env.FORCE_WASM_FAIL;
  const parsed = await parsePython(SOURCE, null);
  assert.strictEqual(parsed.parseMode, 'ast', 'normal path should be tree-sitter ast');
  const f = parsed.functionRecords.find((r) => r.name === 'f');
  assert(f, 'ast path should find f');
  assert(f.fingerprint, 'ast path should carry fingerprint');
  assert.strictEqual(f.hasParameterTypeHints, true, 'typed param should set hasParameterTypeHints');
  assert.strictEqual(f.returnType, 'int', 'returnType should survive normalization');
}

async function main() {
  // Order matters: WASM-fail first (fresh loader), then the retry path.
  await testWasmFailureFallsBackToRegex();
  await testNormalPathIsTreeSitterAst();
  console.log('test/python-tree-sitter-path-test.js ... PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
