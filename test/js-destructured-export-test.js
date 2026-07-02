#!/usr/bin/env node
// @semantic
/**
 * Verify that destructured export bindings are captured as source symbols
 * and propagate correctly through symbol-level impact analysis.
 *
 * Regression coverage for ROADMAP observation:
 * "symbolImpact 多符号解构遗漏".
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');

async function main() {
  const testDir = path.join(
    os.tmpdir(),
    'wb-test-destructured-export-' + crypto.randomBytes(4).toString('hex')
  );
  fs.mkdirSync(testDir, { recursive: true });

  fs.writeFileSync(
    path.join(testDir, 'package.json'),
    JSON.stringify({ name: 'destructured-export-test', version: '1.0.0' }, null, 2)
  );

  fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(testDir, 'src', 'utils.js'),
    `export const { foo, bar } = { foo: 1, bar: 2 };
export const [alpha, beta] = [1, 2];
export const { x, y: aliasY } = { x: 1, y: 2 };
export const { nested: { leaf } } = { nested: { leaf: 1 } };
export const normal = 'ok';
`
  );

  fs.writeFileSync(
    path.join(testDir, 'src', 'consumer.js'),
    `import { foo, alpha, aliasY, leaf, normal } from './utils.js';
console.log(foo, alpha, aliasY, leaf, normal);
`
  );

  const container = new ServiceContainer({ quiet: true });
  let initialized = false;

  try {
    initialized = await container.initialize(testDir, 30000, { watch: false });
    assert.ok(initialized, 'container should initialize');

    const graph = container.snapshot.graph;
    const utilsPath = path.join(testDir, 'src', 'utils.js');
    const normalizedUtils = graph.normalizeFilePath(utilsPath);
    const info = graph.getFileInfo(normalizedUtils);
    assert.ok(info, 'utils.js should be indexed');
    assert.strictEqual(info.parseMode, 'ast', 'utils.js should be parsed with AST');

    const exports = info.exports || [];
    assert.ok(exports.includes('foo'), 'destructured object binding foo should be exported');
    assert.ok(exports.includes('bar'), 'destructured object binding bar should be exported');
    assert.ok(exports.includes('alpha'), 'destructured array binding alpha should be exported');
    assert.ok(exports.includes('beta'), 'destructured array binding beta should be exported');
    assert.ok(exports.includes('x'), 'plain destructured property x should be exported');
    assert.ok(exports.includes('aliasY'), 'renamed destructured property aliasY should be exported');
    assert.ok(exports.includes('leaf'), 'nested destructured property leaf should be exported');
    assert.ok(exports.includes('normal'), 'regular export normal should still be present');

    const symbolImpact = graph.getSymbolImpact(normalizedUtils);
    assert.strictEqual(symbolImpact.mode, 'symbol', 'symbol impact should be available');

    const symbolToDependents = symbolImpact.symbolToDependents || [];
    const bySymbol = new Map(symbolToDependents.map((r) => [r.symbol, r]));

    assert.ok(
      bySymbol.has('foo') && bySymbol.get('foo').dependents.length === 1,
      'foo should have one dependent'
    );
    assert.ok(
      bySymbol.has('alpha') && bySymbol.get('alpha').dependents.length === 1,
      'alpha should have one dependent'
    );
    assert.ok(
      bySymbol.has('aliasY') && bySymbol.get('aliasY').dependents.length === 1,
      'aliasY should have one dependent'
    );
    assert.ok(
      bySymbol.has('leaf') && bySymbol.get('leaf').dependents.length === 1,
      'leaf should have one dependent'
    );
    assert.ok(
      bySymbol.has('normal') && bySymbol.get('normal').dependents.length === 1,
      'normal should have one dependent'
    );
    assert.ok(
      !bySymbol.has('bar') || bySymbol.get('bar').dependents.length === 0,
      'unused destructured symbol bar should have no dependents'
    );

    const directDependents = symbolImpact.directDependents || [];
    const consumerEntry = directDependents.find((d) => d.file.includes('consumer.js'));
    assert.ok(consumerEntry, 'consumer.js should appear as direct dependent');
    const expectedSymbols = ['alpha', 'aliasY', 'foo', 'leaf', 'normal'].sort();
    assert.deepStrictEqual(
      consumerEntry.symbols.slice().sort(),
      expectedSymbols,
      'consumer.js should list only the symbols it actually imported'
    );
  } finally {
    if (initialized) {
      await container.shutdown();
    }
    cleanupTempDir(testDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
