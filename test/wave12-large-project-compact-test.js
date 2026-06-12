// @semantic — Wave 12: large-project auto-compact, category filtering, and max-files truncation.

const assert = require('assert');
const { COMMANDS } = require('../src/cli/commands');
const {
  resolveCompact,
  filterByCategory,
  parseCategories,
  assembleDiff,
} = require('../src/tools/audit-assembler');
const { createMockDepGraph, makeMockSnapshot } = require('./test-helpers');
const { DEFAULTS } = require('../src/config/constants');

function makeLargeSchema(count) {
  const schema = {};
  for (let i = 0; i < count; i++) {
    schema[`/repo/src/f${i}.js`] = {
      imports: [],
      exports: [],
      exportRecords: [],
      importRecords: [],
      parseMode: 'ast',
    };
  }
  return schema;
}

function makeLargeStubDepGraph(count, overrides = {}) {
  return createMockDepGraph({
    mode: 'stub',
    root: '/repo',
    schema: makeLargeSchema(count),
    projectContext: {
      classifyFile() {
        return { isMainline: true, fileRole: 'library', directoryRole: 'active' };
      },
    },
    overrides,
  });
}

function makeContainer(graph, root = '/repo') {
  return {
    ensureReady: async () => {},
    workspaceRoot: root,
    snapshot: { graph },
  };
}

function countFileNodes(nodes) {
  let count = 0;
  for (const n of nodes || []) {
    if (n.type === 'file') count += 1;
    if (n.type === 'directory' && n.children) count += countFileNodes(n.children);
  }
  return count;
}

function testParseCategories() {
  assert.deepStrictEqual(parseCategories('dead-exports,health'), ['deadExports', 'health']);
  assert.deepStrictEqual(parseCategories('DEAD-EXPORTS, unresolved'), ['deadExports', 'unresolved']);
  assert.deepStrictEqual(parseCategories('unknown,deadexports'), ['deadExports']);
  assert.strictEqual(parseCategories(null), null);
  assert.strictEqual(parseCategories(''), null);
}

function testFilterByCategory() {
  const result = {
    health: { ok: true, healthScore: '4/5' },
    deadExports: { ok: true, deadExportsCount: 3, deadExports: [1, 2, 3] },
    unresolved: { ok: true, unresolvedCount: 2, unresolved: [1, 2] },
    cycles: { ok: true, cyclesCount: 1, cycles: [1] },
  };
  filterByCategory(result, 'dead-exports', ['health', 'deadExports', 'unresolved', 'cycles']);
  assert.strictEqual(result.deadExports.deadExportsCount, 3);
  assert.strictEqual(result.health.healthScore, '5/5');
  assert.strictEqual(result.unresolved.unresolvedCount, 0);
  assert.strictEqual(result.cycles.cyclesCount, 0);
}

function testResolveCompactExplicitNoCompact() {
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1);
  const container = makeContainer(graph);
  const res = resolveCompact({ compact: false, noCompact: true }, container);
  assert.strictEqual(res.compact, false);
  assert.strictEqual(res.autoCompact, false);
}

function testResolveCompactExplicitCompact() {
  const graph = makeLargeStubDepGraph(10);
  const container = makeContainer(graph);
  const res = resolveCompact({ compact: true, noCompact: false }, container);
  assert.strictEqual(res.compact, true);
  assert.strictEqual(res.autoCompact, false);
}

function testResolveCompactAutoTriggersAboveThreshold() {
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1);
  const container = makeContainer(graph);
  const res = resolveCompact({ compact: false, noCompact: false }, container);
  assert.strictEqual(res.compact, true);
  assert.strictEqual(res.autoCompact, true);
}

function testResolveCompactNoAutoBelowThreshold() {
  const graph = makeLargeStubDepGraph(10);
  const container = makeContainer(graph);
  const res = resolveCompact({ compact: false, noCompact: false }, container);
  assert.strictEqual(res.compact, false);
  assert.strictEqual(res.autoCompact, false);
}

async function testAuditMapAutoCompact() {
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1);
  const container = makeContainer(graph);
  const result = await COMMANDS['audit-map']({ compact: false, noCompact: false }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.options.compact, true);
  assert.strictEqual(result.options.autoCompact, true);
  assert.strictEqual(countFileNodes(result.tree), 0, 'auto-compact should produce a skeleton tree with no file nodes');
}

async function testAuditMapNoCompactOverride() {
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1);
  const container = makeContainer(graph);
  const result = await COMMANDS['audit-map']({ compact: false, noCompact: true }, container);
  assert.strictEqual(result.options.compact, false);
  assert.strictEqual(result.options.autoCompact, false);
  assert.ok(countFileNodes(result.tree) > 0, '--no-compact should keep file nodes on large projects');
}

async function testAuditMapExplicitCompact() {
  const graph = makeLargeStubDepGraph(10);
  const container = makeContainer(graph);
  const result = await COMMANDS['audit-map']({ compact: true, noCompact: false }, container);
  assert.strictEqual(result.options.compact, true);
  assert.strictEqual(countFileNodes(result.tree), 0, 'explicit --compact should produce a skeleton tree');
}

async function testAuditDiffAutoCompact() {
  const impactSize = DEFAULTS.COMPACT_IMPACT_MAX + 5;
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1, {
    hasFile: () => true,
    getFileInfo: () => ({ parseMode: 'ast' }),
    getImpactRadius: () => Array.from({ length: impactSize }, (_, i) => ({ file: `f${i}.js`, level: 1 })),
    findAffectedTests: () => Array.from({ length: DEFAULTS.COMPACT_AFFECTED_TESTS_MAX + 5 }, (_, i) => ({ file: `t${i}.js`, distance: 1 })),
    findAffectedRoutes: () => [],
    getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
    getChangedFunctionImpact: () => null,
    getFrameworkHint: () => null,
  });
  const snapshot = makeMockSnapshot({
    root: '/repo',
    mockDepGraph: graph,
  });
  const container = makeContainer(snapshot.graph, '/repo');
  const result = await assembleDiff({ cwd: '/repo', files: 'src/a.js,src/b.js' }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.options.compact, true);
  assert.strictEqual(result.options.autoCompact, true);
  assert.strictEqual(result.changedFiles.length, 2);
  for (const entry of result.changedFiles) {
    assert.strictEqual(entry.impact.length, DEFAULTS.COMPACT_IMPACT_MAX, 'auto-compact should cap impact array');
    assert.strictEqual(entry.affectedTests.length, DEFAULTS.COMPACT_AFFECTED_TESTS_MAX, 'auto-compact should cap affectedTests array');
    assert.strictEqual(entry.resolvedPath, undefined, 'auto-compact should drop resolvedPath');
  }
}

async function testAuditDiffNoCompactOverride() {
  const impactSize = DEFAULTS.COMPACT_IMPACT_MAX + 5;
  const graph = makeLargeStubDepGraph(DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD + 1, {
    hasFile: () => true,
    getFileInfo: () => ({ parseMode: 'ast' }),
    getImpactRadius: () => Array.from({ length: impactSize }, (_, i) => ({ file: `f${i}.js`, level: 1 })),
    findAffectedTests: () => Array.from({ length: DEFAULTS.COMPACT_AFFECTED_TESTS_MAX + 5 }, (_, i) => ({ file: `t${i}.js`, distance: 1 })),
    findAffectedRoutes: () => [],
    getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
    getChangedFunctionImpact: () => null,
    getFrameworkHint: () => null,
  });
  const snapshot = makeMockSnapshot({
    root: '/repo',
    mockDepGraph: graph,
  });
  const container = makeContainer(snapshot.graph, '/repo');
  const result = await assembleDiff({ cwd: '/repo', files: 'src/a.js', noCompact: true }, container);
  assert.strictEqual(result.options.compact, false);
  assert.strictEqual(result.options.autoCompact, false);
  assert.strictEqual(result.changedFiles[0].impact.length, impactSize, '--no-compact should preserve full impact array');
}

async function testAuditDiffMaxFilesTruncation() {
  const graph = makeLargeStubDepGraph(10, {
    hasFile: () => true,
    getFileInfo: () => ({ parseMode: 'ast' }),
    getImpactRadius: () => [],
    findAffectedTests: () => [],
    findAffectedRoutes: () => [],
    getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
    getChangedFunctionImpact: () => null,
    getFrameworkHint: () => null,
  });
  const snapshot = makeMockSnapshot({
    root: '/repo',
    mockDepGraph: graph,
  });
  const container = makeContainer(snapshot.graph, '/repo');
  const result = await assembleDiff({ cwd: '/repo', files: 'src/a.js,src/b.js,src/c.js', maxFiles: 2 }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.changedFiles.length, 2);
  assert.strictEqual(result.options.maxFiles, 2);
  assert.strictEqual(result.options.totalChangedFiles, 3);
  assert.strictEqual(result.options.maxFilesTruncated, true);
}

async function main() {
  testParseCategories();
  testFilterByCategory();
  testResolveCompactExplicitNoCompact();
  testResolveCompactExplicitCompact();
  testResolveCompactAutoTriggersAboveThreshold();
  testResolveCompactNoAutoBelowThreshold();
  await testAuditMapAutoCompact();
  await testAuditMapNoCompactOverride();
  await testAuditMapExplicitCompact();
  await testAuditDiffAutoCompact();
  await testAuditDiffNoCompactOverride();
  await testAuditDiffMaxFilesTruncation();
  console.log('wave12-large-project-compact-test.js: all passed');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
