#!/usr/bin/env node
// @semantic
/**
 * Unit tests for audit-diff compact curation logic.
 */
const assert = require('assert');
const { compactChangedFile } = require('../src/cli/formatters/audit-diff-summary');

function makeEntry(overrides = {}) {
  return {
    file: 'src/utils/path.js',
    resolvedPath: '/project/src/utils/path.js',
    classification: { isMainline: true, fileRole: 'library', directoryRole: 'active' },
    graphKnown: true,
    impactCount: 12,
    impact: Array.from({ length: 12 }, (_, i) => ({
      file: `src/a${i}.js`,
      level: i < 3 ? 1 : 2,
      reason: 'direct-import',
    })),
    changedLineRanges: [{ startLine: 10, endLine: 20 }],
    symbolImpact: { symbols: ['foo', 'bar'], mode: 'full' },
    affectedTestsCount: 8,
    affectedTests: Array.from({ length: 8 }, (_, i) => ({
      file: `test/a${i}-test.js`,
      distance: i < 4 ? 1 : 2,
    })),
    historyRisk: { score: 75, level: 'high', recentCommits: [{ hash: 'abc', message: 'x' }] },
    recentCommits: [{ hash: 'abc', message: 'x', date: '2024-01-01' }],
    impactExplanations: ['exp1', 'exp2', 'exp3', 'exp4'],
    compositeRisk: { score: 82, level: 'high', reasons: ['high impact', 'high history risk'] },
    ...overrides,
  };
}

function main() {

  // Baseline: all expected fields present, large arrays capped
  {
    const entry = makeEntry();
    const c = compactChangedFile(entry);

    assert.strictEqual(c.file, 'src/utils/path.js');
    assert.deepStrictEqual(c.classification, entry.classification);
    assert.strictEqual(c.graphKnown, true);
    assert.strictEqual(c.impactCount, 12);
    assert.strictEqual(c.affectedTestsCount, 8);
    assert.strictEqual(c.compositeRisk.score, 82);
    assert.strictEqual(c.historyRisk.score, 75);
    assert.strictEqual(c.historyRisk.level, 'high');
    assert.strictEqual(c.impact.length, 5, 'impact should be capped to 5');
    assert.strictEqual(c.affectedTests.length, 5, 'affectedTests should be capped to 5');
    assert.strictEqual(c.impactExplanations.length, 3, 'impactExplanations should be capped to 3');

    // Dropped fields
    assert.strictEqual(c.resolvedPath, undefined, 'resolvedPath should be dropped');
    assert.strictEqual(c.changedLineRanges, undefined, 'changedLineRanges should be dropped');
    assert.strictEqual(c.symbolImpact, undefined, 'symbolImpact should be dropped');
    assert.strictEqual(c.recentCommits, undefined, 'recentCommits should be dropped');
    assert.strictEqual(c.historyRisk.recentCommits, undefined, 'historyRisk.recentCommits should be dropped');
  }

  // Empty/null edge cases
  {
    const c = compactChangedFile(null);
    assert.strictEqual(c, null, 'null should pass through');
  }

  {
    const c = compactChangedFile({ file: 'x.js' });
    assert.strictEqual(c.file, 'x.js');
    assert.deepStrictEqual(c.impact, []);
    assert.deepStrictEqual(c.affectedTests, []);
    assert.deepStrictEqual(c.impactExplanations, []);
    assert.strictEqual(c.impactCount, 0);
    assert.strictEqual(c.affectedTestsCount, 0);
    assert.strictEqual(c.compositeRisk, null);
    assert.strictEqual(c.historyRisk, null);
  }

  // Arrays smaller than caps should be preserved entirely
  {
    const entry = makeEntry({
      impact: [{ file: 'a.js' }],
      affectedTests: [{ file: 'test/a.js' }],
      impactExplanations: ['one'],
    });
    const c = compactChangedFile(entry);
    assert.strictEqual(c.impact.length, 1);
    assert.strictEqual(c.affectedTests.length, 1);
    assert.strictEqual(c.impactExplanations.length, 1);
  }

  // Missing historyRisk
  {
    const entry = makeEntry({ historyRisk: null });
    const c = compactChangedFile(entry);
    assert.strictEqual(c.historyRisk, null);
  }

  // Missing details inside historyRisk
  {
    const c = compactChangedFile({ file: 'a.js', historyRisk: { authorCount: 2 } });
    assert.strictEqual(c.historyRisk.score, undefined);
    assert.strictEqual(c.historyRisk.authorCount, 2);
  }

}

try {
  main();
} catch (err) {
  console.error('Test failed:', err.message);
  process.exit(1);
}
