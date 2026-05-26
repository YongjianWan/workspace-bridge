#!/usr/bin/env node
/**
 * REPL command parsing and formatting tests.
 * Tests executeCommand with a mock container — no real dep-graph needed.
 */
const assert = require('assert');
const path = require('path');
const { executeCommand } = require('../src/cli/repl');
const { buildMockDepGraph } = require('./test-helpers');

function makeMockDepGraph() {
  return {
    workspaceRoot: '/project',
    graph: buildMockDepGraph({
      '/project/src/utils/path.js': {},
      '/project/src/app.js': {},
      '/project/src/services/core.js': {},
      '/project/test/app.test.js': {},
      '/project/cli.js': {},
      '/project/src/other.js': {},
    }),
    entryFiles: new Set(['/project/cli.js']),
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
    getDependents: (file) => {
      if (file === '/project/src/utils/path.js') {
        return ['/project/src/app.js', '/project/src/services/core.js', '/project/test/app.test.js', '/project/cli.js', '/project/src/other.js'];
      }
      return [`dependent-of-${file}`];
    },
    getDependencies: (file) => [`dependency-of-${file}`],
    getStats: () => ({
      files: 42,
      totalImports: 100,
      totalExports: 80,
      cycles: 2,
    }),
    getAllFilePaths: () => [
      '/project/src/utils/path.js',
      '/project/src/app.js',
      '/project/src/services/core.js',
      '/project/test/app.test.js',
      '/project/cli.js',
      '/project/src/other.js',
    ],
    _displayPath: (f) => f,
    root: '/project',
  };
}

async function testExecuteCommand() {


  const container = { workspaceRoot: '/project', depGraph: makeMockDepGraph() };

  // help
  const help = await executeCommand(container, 'help');
  assert(help.includes('impact'), 'help should list commands');


  // impact
  const impact = await executeCommand(container, 'impact src/app.js');
  assert(impact.includes('impactCount: 2'), 'impact should count results');
  assert(impact.includes('dep-' + path.resolve('/project', 'src/app.js')), 'impact should list files');


  // impact with max-depth
  const impactDepth = await executeCommand(container, 'impact src/app.js --max-depth 5');
  assert(impactDepth.includes('impactCount: 2'), 'impact with depth should work');


  // affected-tests
  const tests = await executeCommand(container, 'affected-tests src/app.js');
  assert(tests.includes('affectedTestsCount: 1'), 'affected-tests should count');
  assert(tests.includes('test-' + path.resolve('/project', 'src/app.js')), 'affected-tests should list files');


  // dead-exports
  const dead = await executeCommand(container, 'dead-exports');
  assert(dead.includes('deadExportsCount: 1'), 'dead-exports should count');
  assert(dead.includes('unusedFn'), 'dead-exports should list symbols');


  // unresolved
  const unresolved = await executeCommand(container, 'unresolved');
  assert(unresolved.includes('unresolvedCount: 1'), 'unresolved should count');
  assert(unresolved.includes('missing-pkg'), 'unresolved should list imports');


  // cycles
  const cycles = await executeCommand(container, 'cycles');
  assert(cycles.includes('cyclesCount: 1'), 'cycles should count');
  assert(cycles.includes('c.js -> d.js -> c.js'), 'cycles should format path');


  // dependents
  const dependents = await executeCommand(container, 'dependents src/app.js');
  assert(dependents.includes('dependentsCount: 1'), 'dependents should count');
  assert(dependents.includes('dependent-of-' + path.resolve('/project', 'src/app.js')), 'dependents should list files');


  // dependencies
  const dependencies = await executeCommand(container, 'dependencies src/app.js');
  assert(dependencies.includes('dependenciesCount: 1'), 'dependencies should count');
  assert(dependencies.includes('dependency-of-' + path.resolve('/project', 'src/app.js')), 'dependencies should list files');


  // stats
  const stats = await executeCommand(container, 'stats');
  assert(stats.includes('files: 42'), 'stats should show files');
  assert(stats.includes('totalImports: 100'), 'stats should show imports');


  // empty input
  const empty = await executeCommand(container, '');
  assert.strictEqual(empty, null, 'empty input should return null');


  // unknown command
  const unknown = await executeCommand(container, 'foobar');
  assert(unknown.includes('Unknown command'), 'unknown command should warn');


  // impact missing file
  const impactNoFile = await executeCommand(container, 'impact');
  assert(impactNoFile.includes('Usage:'), 'impact without file should show usage');


  // affected-tests missing file
  const testsNoFile = await executeCommand(container, 'affected-tests');
  assert(testsNoFile.includes('Usage:'), 'affected-tests without file should show usage');


  // dependents missing file
  const depNoFile = await executeCommand(container, 'dependents');
  assert(depNoFile.includes('Usage:'), 'dependents without file should show usage');


  // dependencies missing file
  const depsNoFile = await executeCommand(container, 'dependencies');
  assert(depsNoFile.includes('Usage:'), 'dependencies without file should show usage');


  // issues
  const issues = await executeCommand(container, 'issues');
  assert(issues.includes('severity: high'), 'issues should detect high severity due to unresolved + cycles');
  assert(issues.includes('deadExports: 1'), 'issues should count dead exports');
  assert(issues.includes('unresolved: 1'), 'issues should count unresolved');
  assert(issues.includes('cycles: 1'), 'issues should count cycles');
  assert(issues.includes('a.js'), 'issues should list dead export file');
  assert(issues.includes('missing-pkg'), 'issues should list unresolved import');
  assert(issues.includes('nextSteps:'), 'issues should include nextSteps');


  // top
  const top = await executeCommand(container, 'top');
  assert(top.includes('hotspot-1:'), 'top should list hotspot-1');
  assert(top.includes(path.relative('/project', '/project/src/utils/path.js')), 'top should include path.js');
  assert(top.includes('5 dependents'), 'top should show dependent count');


  // top with no hotspots (threshold not met)
  const noHotContainer = { depGraph: { ...container.depGraph, getDependents: () => [] } };
  const topNone = await executeCommand(noHotContainer, 'top');
  assert(topNone.includes('No hotspots detected'), 'top should handle no hotspots');


  // help includes new commands
  const help2 = await executeCommand(container, 'help');
  assert(help2.includes('issues'), 'help should list issues command');
  assert(help2.includes('top'), 'help should list top command');



}

async function testEvalMode() {
  const { startRepl } = require('../src/cli/repl');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await startRepl({ cwd: path.resolve(__dirname, '..'), quiet: true, eval: 'stats' });
  } finally {
    console.log = originalLog;
  }

  const output = logs.join('\n');
  assert(output.includes('files:'), `eval mode should output stats result. got: ${output}`);
  assert(output.includes('totalImports:') || output.includes('cycles:'), `eval mode stats should include imports or cycles. got: ${output}`);

}

async function testEvalModeJson() {
  const { startRepl } = require('../src/cli/repl');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await startRepl({ cwd: path.resolve(__dirname, '..'), quiet: true, eval: 'stats', json: true });
  } finally {
    console.log = originalLog;
  }

  const output = logs.join('\n');
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.ok, true, 'json eval should return ok: true');
  assert(typeof parsed.result === 'object', 'json eval should have structured result');
  assert(typeof parsed.result.files === 'number', 'json eval result should contain files count');

}

async function testEvalModeInvalidCwd() {
  const { runCliRaw } = require('./test-helpers');

  // CLI 路径：--cwd 无效目录时应返回 exit=1
  const result = runCliRaw(['repl', '--eval', 'stats', '--cwd', '/nonexistent-path-for-test', '--json', '--quiet']);
  assert.strictEqual(result.status, 1, `invalid cwd should exit with code 1. stdout: ${result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.ok, false, 'invalid cwd should return ok: false');
  assert(parsed.error.includes('Directory not found'), `should mention directory not found. got: ${parsed.error}`);

}

async function main() {
  await testExecuteCommand();
  await testEvalMode();
  await testEvalModeJson();
  await testEvalModeInvalidCwd();

}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
