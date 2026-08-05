#!/usr/bin/env node
// @contract — Java parser path selection: tree-sitter WASM primary, regex only on WASM failure
//
// L3-9 Java half: before the migration this file's assertions were about a
// spawned CPython+javalang process. Nothing spawns any more — the only two
// paths are in-process tree-sitter and the regex fallback.

const assert = require('assert');

// Must be set before the first tree-sitter load in this process; the loader
// evicts null-settling loads, so the second test retries without the flag.
process.env.FORCE_WASM_FAIL = '1';

const { parseJava } = require('../src/services/dep-graph/parsers/java');

const SOURCE = [
  'package demo.app;',
  '',
  'import java.util.List;',
  '',
  'public class Widget {',
  '    public List<String> render(int count) {',
  '        return null;',
  '    }',
  '}',
  '',
].join('\n');

async function testWasmFailureFallsBackToRegex() {
  const parsed = await parseJava(SOURCE, null);
  assert.strictEqual(parsed.parseMode, 'regex', 'WASM unavailable should degrade to regex, not spawn');
  assert.strictEqual(parsed.package, 'demo.app', 'regex path still reads the package declaration');
}

async function testNormalPathIsTreeSitterAst() {
  delete process.env.FORCE_WASM_FAIL;
  const parsed = await parseJava(SOURCE, null);
  assert.strictEqual(parsed.parseMode, 'ast', 'normal path should be tree-sitter ast');
  assert.strictEqual(parsed.package, 'demo.app', 'package must survive the AST path (L2-11 gate C geology)');

  const render = parsed.functionRecords.find((r) => r.name === 'render');
  assert(render, 'ast path should find render');
  assert(render.fingerprint, 'ast path should carry fingerprint');
  assert.strictEqual(render.fingerprint.paramCount, 1);
  assert.deepStrictEqual(parsed.imports, ['java.util.List']);
}

async function testNoSpawnInfrastructureRemains() {
  // The migration's other half: scripts/java_ast_parser.py and the whole
  // spawn-ast.js module are gone. Requiring either must fail, otherwise a
  // dead second parsing path is quietly still shipping.
  assert.throws(
    () => {
      const moduleName = '../src/services/dep-graph/parsers/' + 'spawn-ast';
      require(moduleName);
    },
    /Cannot find module/,
    'spawn-ast.js must be deleted, not merely unused'
  );
}

async function main() {
  // Order matters: WASM-fail first (fresh loader), then the retry path.
  await testWasmFailureFallsBackToRegex();
  await testNormalPathIsTreeSitterAst();
  await testNoSpawnInfrastructureRemains();
  console.log('test/java-tree-sitter-path-test.js ... PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
