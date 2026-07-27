#!/usr/bin/env node
// @contract
// debug --what symbols: the command's entire purpose is duplicate detection,
// so it must report the same duplicate set the registry contract defines.
// Prescan records every top-level declaration (isExported: false) for lookup
// purposes; those are not exports and must never surface as duplicates.
const assert = require('assert');
const debugCmd = require('../src/cli/commands/debug');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');

function makeContainer(registry) {
  return {
    ensureReady: async () => {},
    snapshot: { graph: { symbolRegistry: registry } },
  };
}

async function testPrivateDeclarationsAreNotDuplicates() {
  const registry = new SymbolRegistry();
  // Every test file in a repo declares a private `main` — 227 of them in this
  // very repo. None is exported, so this is not a duplicate-symbol finding.
  for (let i = 0; i < 5; i++) {
    registry.register(`test/file${i}-test.js`, [{ name: 'main', kind: 'function', isExported: false }]);
  }

  const result = await debugCmd({ what: 'symbols' }, makeContainer(registry));
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.duplicates, [], 'private declarations must not be reported as duplicate symbols');
  assert.strictEqual(result.duplicateCount, 0, 'duplicateCount must exclude private declarations');
}

async function testStatsAndListAgreeOnTheSameSet() {
  const registry = new SymbolRegistry();
  registry.register('src/a.js', [{ name: 'shared', isExported: true }, { name: 'privateOne', isExported: false }]);
  registry.register('src/b.js', [{ name: 'shared', isExported: true }, { name: 'privateOne', isExported: false }]);

  const result = await debugCmd({ what: 'symbols' }, makeContainer(registry));
  assert.strictEqual(result.duplicateCount, result.stats.duplicateSymbols,
    'duplicateCount and stats.duplicateSymbols must describe the same set');
  assert.strictEqual(result.duplicateCount, 1, 'only the genuinely exported collision counts');
  assert.strictEqual(result.duplicates[0].name, 'shared');
  assert.strictEqual(result.duplicates[0].count, 2);
}

async function testMixedExportedAndPrivateCountsOnlyExported() {
  const registry = new SymbolRegistry();
  registry.register('src/utils/debug.js', [{ name: 'debug', isExported: true }]);
  registry.register('src/services/debug.js', [{ name: 'debug', isExported: false }]);

  const result = await debugCmd({ what: 'symbols' }, makeContainer(registry));
  assert.strictEqual(result.duplicateCount, 0, 'one exported + one private is not a collision');
  assert.deepStrictEqual(result.duplicates, []);
}

async function testMissingRegistryStillReportsCleanly() {
  const result = await debugCmd({ what: 'symbols' }, { ensureReady: async () => {}, snapshot: { graph: {} } });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Symbol registry/);
}

async function main() {
  const tests = [
    testPrivateDeclarationsAreNotDuplicates,
    testStatsAndListAgreeOnTheSameSet,
    testMixedExportedAndPrivateCountsOnlyExported,
    testMissingRegistryStillReportsCleanly,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`  PASS: ${t.name}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL: ${t.name} —`, e.message);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main();
