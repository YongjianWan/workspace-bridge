#!/usr/bin/env node
// @contract — category-filter must break the audit-assembler ↔ incremental-diff cycle

const assert = require('assert');

function testNoCircularDependency() {
  // Loading incremental-diff should not transitively load audit-assembler.
  // If the cycle still exists, one of these require() calls will hang or throw.
  const incrementalDiff = require('../src/tools/incremental-diff');
  const auditAssembler = require('../src/tools/audit-assembler');
  const categoryFilter = require('../src/tools/category-filter');

  assert.strictEqual(typeof incrementalDiff.buildIncrementalFindings, 'function');
  assert.strictEqual(typeof auditAssembler.assembleSummary, 'function');
  assert.strictEqual(typeof categoryFilter.filterByCategory, 'function');

  // incremental-diff must source filterByCategory from category-filter, not audit-assembler.
  const incrementalModule = require.cache[require.resolve('../src/tools/incremental-diff')];
  const incrementalChildren = incrementalModule?.children?.map((c) => c.filename) || [];
  const auditAssemblerPath = require.resolve('../src/tools/audit-assembler');
  assert.ok(
    !incrementalChildren.includes(auditAssemblerPath),
    'incremental-diff should not require audit-assembler'
  );
}

function testFilterByCategorySharedSemantics() {
  const { filterByCategory } = require('../src/tools/category-filter');
  const result = {
    deadExports: { ok: true, deadExportsCount: 1, deadExports: ['a'] },
    unresolved: { ok: true, unresolvedCount: 2, unresolved: ['b', 'c'] },
    cycles: { ok: true, cyclesCount: 3, cycles: ['d'] },
  };
  filterByCategory(result, 'dead-exports', ['deadExports', 'unresolved', 'cycles']);
  assert.strictEqual(result.deadExports.deadExportsCount, 1, 'kept category should remain');
  assert.strictEqual(result.unresolved.unresolvedCount, 0, 'filtered category should be stubbed');
  assert.strictEqual(result.cycles.cyclesCount, 0, 'filtered category should be stubbed');
}

function main() {
  const tests = [testNoCircularDependency, testFilterByCategorySharedSemantics];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main();
