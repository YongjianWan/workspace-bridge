const assert = require('assert');
const { dependencyGraph } = require('../src/tools/dep-tools');

function createMockContainer() {
  return {
    ensureReady: async () => {},
    workspaceRoot: '/test',
    depGraph: {
      getStats: () => ({ totalFiles: 10, totalEdges: 20 }),
      getDependencies: (file) => (file.includes('a.js') ? ['b.js', 'c.js'] : []),
      getDependents: (file) => (file.includes('a.js') ? ['d.js'] : []),
      getImpactRadius: (file) => (file.includes('a.js') ? ['b.js', 'c.js', 'd.js'] : []),
      getSymbolImpact: (file) => ({ mode: 'file-fallback', impactedFiles: [] }),
      findCircularDependencies: () => [{ files: ['a.js', 'b.js'], length: 2 }],
      findDeadExports: () => [{ file: 'x.js', exports: ['unused'] }],
      findUnresolvedImports: () => [{ file: 'y.js', import: 'missing' }],
      findAffectedTests: (file, depth) => (file.includes('a.js') ? ['test/a.test.js'] : []),
      _displayPath: (p) => p,
    },
  };
}

async function testStatsOperation() {
  const result = await dependencyGraph({ operation: 'stats' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.stats.totalFiles, 10);
  assert.strictEqual(result.stats.totalEdges, 20);
}

async function testDependenciesOperation() {
  const result = await dependencyGraph({ operation: 'dependencies', file: 'a.js' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dependenciesCount, 2);
  assert(result.dependencies.includes('b.js'));
  assert(result.dependencies.includes('c.js'));
}

async function testDependenciesMissingFile() {
  const result = await dependencyGraph({ operation: 'dependencies' }, createMockContainer());
  assert.strictEqual(result.ok, false);
  assert(result.error.includes('file is required'));
}

async function testDependentsOperation() {
  const result = await dependencyGraph({ operation: 'dependents', file: 'a.js' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dependentsCount, 1);
  assert(result.dependents.includes('d.js'));
}

async function testImpactOperation() {
  const result = await dependencyGraph({ operation: 'impact', file: 'a.js' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.impactCount, 3);
  assert.strictEqual(result.symbolImpact.mode, 'file-fallback');
}

async function testImpactMissingFile() {
  const result = await dependencyGraph({ operation: 'impact' }, createMockContainer());
  assert.strictEqual(result.ok, false);
  assert(result.error.includes('file is required'));
}

async function testCyclesOperation() {
  const result = await dependencyGraph({ operation: 'cycles' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cyclesCount, 1);
  assert.strictEqual(result.cycles[0].length, 2);
}

async function testDeadExportsOperation() {
  const result = await dependencyGraph({ operation: 'dead_exports' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.deadExportsCount, 1);
  assert.strictEqual(result.deadExports[0].file, 'x.js');
  assert(result.possibleFalsePositives);
}

async function testUnresolvedOperation() {
  const result = await dependencyGraph({ operation: 'unresolved' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.unresolvedCount, 1);
  assert.strictEqual(result.unresolved[0].file, 'y.js');
  assert(result.possibleFalsePositives);
}

async function testAffectedTestsOperation() {
  const result = await dependencyGraph({ operation: 'affected_tests', file: 'a.js' }, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.affectedTestsCount, 1);
  assert(result.affectedTests.includes('test/a.test.js'));
  assert.strictEqual(result.maxDepth, 5);
}

async function testAffectedTestsCustomDepth() {
  const result = await dependencyGraph({ operation: 'affected_tests', file: 'a.js', maxDepth: 3 }, createMockContainer());
  assert.strictEqual(result.maxDepth, 3);
}

async function testAffectedTestsMissingFile() {
  const result = await dependencyGraph({ operation: 'affected_tests' }, createMockContainer());
  assert.strictEqual(result.ok, false);
  assert(result.error.includes('file is required'));
}

async function testDefaultOperation() {
  const result = await dependencyGraph({}, createMockContainer());
  assert.strictEqual(result.ok, true);
  assert(result.stats);
}

async function testUnknownOperation() {
  const result = await dependencyGraph({ operation: 'unknown' }, createMockContainer());
  assert.strictEqual(result.ok, false);
  assert(result.error.includes('Unknown operation'));
}

async function testDepGraphNotAvailable() {
  const container = createMockContainer();
  container.depGraph = null;
  const result = await dependencyGraph({ operation: 'stats' }, container);
  assert.strictEqual(result.ok, false);
  assert(result.error.includes('not available'));
}

async function main() {
  await testStatsOperation();
  await testDependenciesOperation();
  await testDependenciesMissingFile();
  await testDependentsOperation();
  await testImpactOperation();
  await testImpactMissingFile();
  await testCyclesOperation();
  await testDeadExportsOperation();
  await testUnresolvedOperation();
  await testAffectedTestsOperation();
  await testAffectedTestsCustomDepth();
  await testAffectedTestsMissingFile();
  await testDefaultOperation();
  await testUnknownOperation();
  await testDepGraphNotAvailable();
}

main();
