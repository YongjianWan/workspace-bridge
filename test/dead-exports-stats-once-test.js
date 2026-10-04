#!/usr/bin/env node
// @semantic — findDeadExports must not recompute whole-graph stats once per unimported file
// (quadratic: every zero-importer file re-scanned every file in the graph).
const assert = require('assert');
const { GraphAnalyzer } = require('../src/services/dep-graph/analyzer');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');

const UNIMPORTED_FILES = 40;

function buildGraph() {
  const schema = {};
  for (let i = 0; i < UNIMPORTED_FILES; i++) {
    schema[normalizePathKey(`/repo/f${i}.js`)] = {
      imports: [], exports: [`foo${i}`], importRecords: [], exportRecords: [{ name: `foo${i}` }], parseMode: 'ast', confidence: 'high',
    };
  }
  return createMockDepGraph({ schema });
}

function testStatsComputedOncePerFindDeadExports() {
  const original = GraphAnalyzer.prototype.getStats;
  let calls = 0;
  GraphAnalyzer.prototype.getStats = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const dead = buildGraph().findDeadExports();
    assert.strictEqual(dead.length, UNIMPORTED_FILES, 'every unimported export is still reported');
    assert.ok(calls <= 1, `getStats ran ${calls} times for ${UNIMPORTED_FILES} unimported files; expected at most 1`);
  } finally {
    GraphAnalyzer.prototype.getStats = original;
  }
}

function testSparseGraphStillDowngradesEveryFinding() {
  const dead = buildGraph().findDeadExports();
  assert.ok(dead.every((d) => d.confidence === 'low' && d.confidenceSource === 'graph-sparse'),
    'a 40-file graph with 0 edges is unreliable; each finding keeps low confidence');
}

testStatsComputedOncePerFindDeadExports();
testSparseGraphStillDowngradesEveryFinding();
console.log('dead-exports-stats-once-test: OK');
