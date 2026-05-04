#!/usr/bin/env node
/**
 * REPL command parsing and formatting tests.
 * Tests executeCommand with a mock container — no real dep-graph needed.
 */
const assert = require('assert');
const { executeCommand } = require('../src/cli/repl');

function makeMockDepGraph() {
  return {
    getImpactRadius: (file, maxDepth) => [
      { level: 1, file: `dep-${file}` },
      { level: 2, file: 'dep-level2.js' },
    ],
    findAffectedTests: (file, maxDepth) => [
      { file: `test-${file}`, distance: 1 },
    ],
    findDeadExports: () => [
      { file: 'a.js', exports: ['unusedFn'], confidence: 'high' },
    ],
    findUnresolvedImports: () => [
      { file: 'b.js', import: 'missing-pkg' },
    ],
    findCircularDependencies: () => [
      ['c.js', 'd.js', 'c.js'],
    ],
    getDependents: (file) => [`dependent-of-${file}`],
    getDependencies: (file) => [`dependency-of-${file}`],
    getStats: () => ({
      files: 42,
      totalImports: 100,
      totalExports: 80,
      cycles: 2,
    }),
  };
}

async function main() {
  console.log('=== REPL command test ===\n');

  const container = { depGraph: makeMockDepGraph() };

  // help
  const help = await executeCommand(container, 'help');
  assert(help.includes('impact'), 'help should list commands');
  console.log('help: ok');

  // impact
  const impact = await executeCommand(container, 'impact src/app.js');
  assert(impact.includes('impactCount: 2'), 'impact should count results');
  assert(impact.includes('dep-src/app.js'), 'impact should list files');
  console.log('impact: ok');

  // impact with max-depth
  const impactDepth = await executeCommand(container, 'impact src/app.js --max-depth 5');
  assert(impactDepth.includes('impactCount: 2'), 'impact with depth should work');
  console.log('impact --max-depth: ok');

  // affected-tests
  const tests = await executeCommand(container, 'affected-tests src/app.js');
  assert(tests.includes('affectedTestCount: 1'), 'affected-tests should count');
  assert(tests.includes('test-src/app.js'), 'affected-tests should list files');
  console.log('affected-tests: ok');

  // dead-exports
  const dead = await executeCommand(container, 'dead-exports');
  assert(dead.includes('deadExportCount: 1'), 'dead-exports should count');
  assert(dead.includes('unusedFn'), 'dead-exports should list symbols');
  console.log('dead-exports: ok');

  // unresolved
  const unresolved = await executeCommand(container, 'unresolved');
  assert(unresolved.includes('unresolvedCount: 1'), 'unresolved should count');
  assert(unresolved.includes('missing-pkg'), 'unresolved should list imports');
  console.log('unresolved: ok');

  // cycles
  const cycles = await executeCommand(container, 'cycles');
  assert(cycles.includes('cycleCount: 1'), 'cycles should count');
  assert(cycles.includes('c.js -> d.js -> c.js'), 'cycles should format path');
  console.log('cycles: ok');

  // dependents
  const dependents = await executeCommand(container, 'dependents src/app.js');
  assert(dependents.includes('dependentCount: 1'), 'dependents should count');
  assert(dependents.includes('dependent-of-src/app.js'), 'dependents should list files');
  console.log('dependents: ok');

  // dependencies
  const dependencies = await executeCommand(container, 'dependencies src/app.js');
  assert(dependencies.includes('dependencyCount: 1'), 'dependencies should count');
  assert(dependencies.includes('dependency-of-src/app.js'), 'dependencies should list files');
  console.log('dependencies: ok');

  // stats
  const stats = await executeCommand(container, 'stats');
  assert(stats.includes('files: 42'), 'stats should show files');
  assert(stats.includes('totalImports: 100'), 'stats should show imports');
  console.log('stats: ok');

  // empty input
  const empty = await executeCommand(container, '');
  assert.strictEqual(empty, null, 'empty input should return null');
  console.log('empty-input: ok');

  // unknown command
  const unknown = await executeCommand(container, 'foobar');
  assert(unknown.includes('Unknown command'), 'unknown command should warn');
  console.log('unknown-command: ok');

  // impact missing file
  const impactNoFile = await executeCommand(container, 'impact');
  assert(impactNoFile.includes('Usage:'), 'impact without file should show usage');
  console.log('impact-missing-arg: ok');

  // affected-tests missing file
  const testsNoFile = await executeCommand(container, 'affected-tests');
  assert(testsNoFile.includes('Usage:'), 'affected-tests without file should show usage');
  console.log('affected-tests-missing-arg: ok');

  // dependents missing file
  const depNoFile = await executeCommand(container, 'dependents');
  assert(depNoFile.includes('Usage:'), 'dependents without file should show usage');
  console.log('dependents-missing-arg: ok');

  // dependencies missing file
  const depsNoFile = await executeCommand(container, 'dependencies');
  assert(depsNoFile.includes('Usage:'), 'dependencies without file should show usage');
  console.log('dependencies-missing-arg: ok');

  console.log('\nAll REPL tests passed');
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
