#!/usr/bin/env node
// @semantic
/**
 * Edge-case tests for repl.js executeCommand not covered by repl-test.js.
 * - top: hotspot threshold boundary (exactly at threshold, below threshold)
 * - issues: no structural issues scenario
 * - audit-map compact output
 */
const assert = require('assert');
const path = require('path');
const { executeCommand } = require('../src/cli/repl');

function makeMockDepGraph(opts = {}) {
  const { dependentsMap = {}, files = [] } = opts;
  const graph = new Map();
  for (const f of files) graph.set(f, {});
  return {
    workspaceRoot: '/project',
    graph,
    entryFiles: new Set(),
    getImpactRadius: () => [],
    findAffectedTests: () => [],
    findDeadExports: () => [],
    findUnresolvedImports: () => [],
    findCircularDependencies: () => [],
    findOrphanFiles: () => ({ docs: [], scripts: [], configs: [], modules: [], all: [] }),
    getDependents: (file) => dependentsMap[file] || [],
    getDependencies: () => [],
    getStats: () => ({ files: 10, totalImports: 20, totalExports: 15, cycles: 0 }),
    getAllFilePaths: () => Array.from(graph.keys()),
    _displayPath: (f) => f,
  };
}

async function main() {

  // top: file with dependents exactly at threshold
  {
    const threshold = 5;
    const depGraph = makeMockDepGraph({
      files: ['/project/src/exact.js'],
      dependentsMap: {
        '/project/src/exact.js': Array.from({ length: threshold }, (_, i) => `/project/src/d${i}.js`),
      },
    });
    // Patch SCORING.HOTSPOT_MIN_DEPENDENTS temporarily
    const constants = require('../src/config/constants');
    const originalThreshold = constants.SCORING.HOTSPOT_MIN_DEPENDENTS;
    constants.SCORING.HOTSPOT_MIN_DEPENDENTS = threshold;

    const container = { depGraph };
    const out = await executeCommand(container, 'top');
    assert(out.includes('hotspot-1:'), `exact threshold should be hotspot, got: ${out}`);
    assert(out.includes(`${threshold} dependents`), `should show ${threshold} dependents, got: ${out}`);

    constants.SCORING.HOTSPOT_MIN_DEPENDENTS = originalThreshold;
  }

  // top: file with dependents one below threshold
  {
    const threshold = 5;
    const depGraph = makeMockDepGraph({
      files: ['/project/src/below.js'],
      dependentsMap: {
        '/project/src/below.js': Array.from({ length: threshold - 1 }, (_, i) => `/project/src/d${i}.js`),
      },
    });
    const constants = require('../src/config/constants');
    const originalThreshold = constants.SCORING.HOTSPOT_MIN_DEPENDENTS;
    constants.SCORING.HOTSPOT_MIN_DEPENDENTS = threshold;

    const container = { depGraph };
    const out = await executeCommand(container, 'top');
    assert(out.includes('No hotspots detected'), `below threshold should show no hotspots, got: ${out}`);

    constants.SCORING.HOTSPOT_MIN_DEPENDENTS = originalThreshold;
  }

  // issues: no structural issues
  {
    const depGraph = makeMockDepGraph();
    const container = { depGraph };
    const out = await executeCommand(container, 'issues');
    assert(out.includes('severity: low'), `no issues should be low severity, got: ${out}`);
    assert(out.includes('deadExports: 0'), `should show 0 dead exports, got: ${out}`);
    assert(out.includes('unresolved: 0'), `should show 0 unresolved, got: ${out}`);
    assert(out.includes('cycles: 0'), `should show 0 cycles, got: ${out}`);
    assert(out.includes('No immediate structural issues detected.'), `should show no issues message, got: ${out}`);
  }

  // audit-map compact output
  {
    const depGraph = makeMockDepGraph();
    const container = { depGraph };
    const out = await executeCommand(container, 'audit-map --compact');
    assert(out.includes('directories:'), `compact audit-map should include directories, got: ${out}`);
    assert(out.includes('files:'), `compact audit-map should include files, got: ${out}`);
    assert(out.includes('edges:'), `compact audit-map should include edges, got: ${out}`);
    assert(out.includes('highlightedFiles:'), `compact audit-map should include highlightedFiles, got: ${out}`);
  }

  // audit-map non-compact output
  {
    const depGraph = makeMockDepGraph();
    const container = { depGraph };
    const out = await executeCommand(container, 'audit-map');
    assert(out.includes('workspaceRoot:'), `non-compact audit-map should include workspaceRoot, got: ${out}`);
    assert(out.includes('files:'), `non-compact audit-map should include files, got: ${out}`);
  }

  // Unknown command edge case
  {
    const depGraph = makeMockDepGraph();
    const container = { depGraph };
    const out = await executeCommand(container, 'unknown-xyz');
    assert.strictEqual(out, 'Unknown command: unknown-xyz. Type "help" for available commands.');
  }

}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
