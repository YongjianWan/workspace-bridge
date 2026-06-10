// @contract — Wave 12: Honest Truncation + JSON Token Reduction

const assert = require('assert');
const { truncateArray, elideString, elideDeep } = require('../src/utils/truncate');
const { DEFAULTS } = require('../src/config/constants');
const { compactChangedFile } = require('../src/cli/formatters/audit-diff-summary');
const { formatHuman, formatSummary, formatMarkdown } = require('../src/cli/formatters/human-formatters');
const { dependencyGraph } = require('../src/tools/dep-tools');
const { makeMockSnapshot } = require('./test-helpers');

function createMockContainer(opts = {}) {
  const impactSize = opts.impactSize || 3;
  const affectedTestsSize = opts.affectedTestsSize || 1;
  const routesSize = opts.routesSize || 0;
  const snapshot = makeMockSnapshot({
    root: '/test',
    depGraphOverrides: {
      getImpactRadius: () => Array.from({ length: impactSize }, (_, i) => ({ file: `f${i}.js`, level: i + 1 })),
      getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
      findAffectedTests: () => Array.from({ length: affectedTestsSize }, (_, i) => ({ file: `t${i}.js`, distance: i + 1 })),
      findAffectedRoutes: () => Array.from({ length: routesSize }, (_, i) => ({ entry: `e${i}.js`, path: ['a', 'b'] })),
      _displayPath: (p) => p,
    },
  });
  return {
    ensureReady: async () => {},
    workspaceRoot: '/test',
    depGraph: snapshot.graph,
    snapshot,
  };
}

function testTruncateArrayWithinLimit() {
  const arr = [1, 2, 3];
  const result = truncateArray(arr, 5);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.total, 3);
  assert.deepStrictEqual(result.items, [1, 2, 3]);
}

function testTruncateArrayExceedsLimit() {
  const arr = Array.from({ length: 10 }, (_, i) => i);
  const result = truncateArray(arr, 5);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.total, 10);
  assert.strictEqual(result.items.length, 5);
  assert.deepStrictEqual(result.items, [0, 1, 2, 3, 4]);
}

function testTruncateArrayNullish() {
  assert.deepStrictEqual(truncateArray(null, 5).items, []);
  assert.strictEqual(truncateArray(undefined, 5).truncated, false);
}

function testElideStringShort() {
  assert.strictEqual(elideString('hi', 10), 'hi');
}

function testElideStringLong() {
  const long = 'a'.repeat(600);
  const out = elideString(long, 500);
  assert.strictEqual(out.length, 501); // 500 + ellipsis
  assert.ok(out.endsWith('…'));
}

function testElideDeepSmallObject() {
  const input = { a: [1, 2], b: 'short' };
  const out = elideDeep(input);
  assert.deepStrictEqual(out, input);
}

function testElideDeepSlicesOversizedArray() {
  const input = { items: Array.from({ length: 150 }, (_, i) => i) };
  const out = elideDeep(input, { maxArrayLength: 100 });
  assert.strictEqual(out.items.length, 100);
}

function testElideDeepElidesLongStrings() {
  const input = { nested: { text: 'x'.repeat(600) } };
  const out = elideDeep(input, { maxStringLength: 500 });
  assert.strictEqual(out.nested.text.length, 501);
  assert.ok(out.nested.text.endsWith('…'));
}

function testElideDeepRespectsDepth() {
  const input = { a: { b: { c: { d: 1 } } } };
  const out = elideDeep(input, { maxDepth: 2 });
  assert.deepStrictEqual(out.a.b, { c: null });
}

function testCompactChangedFileImpactCapped() {
  const entry = {
    file: 'foo.js',
    impactCount: 100,
    impact: Array.from({ length: DEFAULTS.COMPACT_IMPACT_MAX + 5 }, (_, i) => ({ file: `f${i}.js`, level: 1 })),
    affectedTestsCount: 0,
    affectedTests: [],
    impactExplanations: [],
  };
  const compact = compactChangedFile(entry);
  assert.strictEqual(compact.truncated, true);
  assert.strictEqual(compact.impact.length, DEFAULTS.COMPACT_IMPACT_MAX);
}

function testCompactChangedFileTestsCapped() {
  const entry = {
    file: 'foo.js',
    impactCount: 0,
    impact: [],
    affectedTestsCount: 100,
    affectedTests: Array.from({ length: DEFAULTS.COMPACT_AFFECTED_TESTS_MAX + 5 }, (_, i) => ({ file: `t${i}.js`, distance: 1 })),
    impactExplanations: [],
  };
  const compact = compactChangedFile(entry);
  assert.strictEqual(compact.truncated, true);
  assert.strictEqual(compact.affectedTests.length, DEFAULTS.COMPACT_AFFECTED_TESTS_MAX);
}

function testCompactChangedFileNoTruncation() {
  const entry = {
    file: 'foo.js',
    impactCount: 2,
    impact: [{ file: 'a.js', level: 1 }],
    affectedTestsCount: 1,
    affectedTests: [{ file: 'b.js', distance: 1 }],
    impactExplanations: [],
  };
  const compact = compactChangedFile(entry);
  assert.strictEqual(compact.truncated, false);
}

function testCompactChangedFilePreservesDataLayerTruncated() {
  const entry = {
    file: 'foo.js',
    impactCount: 2,
    impact: [{ file: 'a.js', level: 1 }],
    affectedTestsCount: 1,
    affectedTests: [{ file: 'b.js', distance: 1 }],
    impactExplanations: [],
    truncated: true,
  };
  const compact = compactChangedFile(entry);
  assert.strictEqual(compact.truncated, true);
}

function testFormatterImpactTruncationNotice() {
  const result = {
    impactCount: 100,
    impact: Array.from({ length: 10 }, (_, i) => ({ file: `f${i}.js`, level: i + 1 })),
    truncated: true,
  };
  const out = formatHuman('impact', result);
  assert.ok(out.includes('truncated'), `Expected truncation notice in human output: ${out}`);
  assert.ok(out.includes('100'), `Expected total count in human output: ${out}`);
}

function testFormatterImpactNoNoticeWhenNotTruncated() {
  const result = {
    impactCount: 2,
    impact: [{ file: 'a.js', level: 1 }],
    truncated: false,
  };
  const out = formatHuman('impact', result);
  assert.ok(!out.includes('truncated'), `Did not expect truncation notice: ${out}`);
}

function testFormatterAffectedTestsSummaryNotice() {
  const result = {
    affectedTestsCount: 100,
    affectedTests: Array.from({ length: 10 }, (_, i) => ({ file: `t${i}.js`, distance: i + 1 })),
    truncated: true,
  };
  const out = formatSummary('affected-tests', result);
  assert.ok(out.includes('truncated'), `Expected truncation notice in summary output: ${out}`);
}

function testFormatterAffectedRoutesMarkdownNotice() {
  const result = {
    routesCount: 100,
    routes: Array.from({ length: 10 }, (_, i) => ({ entry: `e${i}`, path: ['a', 'b'] })),
    truncated: true,
  };
  const out = formatMarkdown('affected-routes', result);
  assert.ok(out.includes('truncated'), `Expected truncation notice in markdown output: ${out}`);
}

async function testImpactCommandTruncation() {
  const container = createMockContainer({ impactSize: DEFAULTS.JSON_OUTPUT_MAX_IMPACT_ITEMS + 10 });
  const result = await dependencyGraph({ operation: 'impact', file: 'a.js' }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.impactCount, DEFAULTS.JSON_OUTPUT_MAX_IMPACT_ITEMS + 10);
  assert.strictEqual(result.impact.length, DEFAULTS.JSON_OUTPUT_MAX_IMPACT_ITEMS);
}

async function testImpactCommandNoTruncation() {
  const container = createMockContainer({ impactSize: 5 });
  const result = await dependencyGraph({ operation: 'impact', file: 'a.js' }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.impact.length, 5);
}

async function testAffectedTestsCommandTruncation() {
  const container = createMockContainer({ affectedTestsSize: DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_TESTS_ITEMS + 10 });
  const result = await dependencyGraph({ operation: 'affected_tests', file: 'a.js' }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.affectedTestsCount, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_TESTS_ITEMS + 10);
  assert.strictEqual(result.affectedTests.length, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_TESTS_ITEMS);
}

async function testAffectedRoutesCommandTruncation() {
  const container = createMockContainer({ routesSize: DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS + 10 });
  const result = await dependencyGraph({ operation: 'affected_routes', file: 'a.js' }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.routesCount, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS + 10);
  assert.strictEqual(result.routes.length, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS);
}

async function main() {
  testTruncateArrayWithinLimit();
  testTruncateArrayExceedsLimit();
  testTruncateArrayNullish();
  testElideStringShort();
  testElideStringLong();
  testElideDeepSmallObject();
  testElideDeepSlicesOversizedArray();
  testElideDeepElidesLongStrings();
  testElideDeepRespectsDepth();
  testCompactChangedFileImpactCapped();
  testCompactChangedFileTestsCapped();
  testCompactChangedFileNoTruncation();
  testCompactChangedFilePreservesDataLayerTruncated();
  testFormatterImpactTruncationNotice();
  testFormatterImpactNoNoticeWhenNotTruncated();
  testFormatterAffectedTestsSummaryNotice();
  testFormatterAffectedRoutesMarkdownNotice();
  await testImpactCommandTruncation();
  await testImpactCommandNoTruncation();
  await testAffectedTestsCommandTruncation();
  await testAffectedRoutesCommandTruncation();
}

main();
