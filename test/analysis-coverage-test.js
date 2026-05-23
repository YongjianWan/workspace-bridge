#!/usr/bin/env node
const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');

function n(p) {
  return p.toLowerCase().replace(/\\/g, '/');
}

function testCoverageAllAst() {
  const dg = createMockDepGraph({
    schema: {
      [n('/repo/a.js')]: { imports: [], exports: ['a'], importRecords: [], exportRecords: [{ name: 'a' }], parseMode: 'ast' },
      [n('/repo/b.js')]: { imports: [], exports: ['b'], importRecords: [], exportRecords: [{ name: 'b' }], parseMode: 'ast' },
      [n('/repo/c.js')]: { imports: [], exports: ['c'], importRecords: [], exportRecords: [{ name: 'c' }], parseMode: 'ast' },
    }
  });

  const stats = dg.getStats();
  assert.ok(stats.analysisCoverage, 'should include analysisCoverage');
  assert.strictEqual(stats.analysisCoverage.totalFiles, 3);
  assert.strictEqual(stats.analysisCoverage.parsedFiles, 3);
  assert.strictEqual(stats.analysisCoverage.fallbackFiles, 0);
  assert.strictEqual(stats.analysisCoverage.coverageRatio, 1);
}

// @semantic
function testCoverageMixed() {
  const dg = createMockDepGraph({
    schema: {
      [n('/repo/a.js')]: { imports: [], exports: ['a'], importRecords: [], exportRecords: [{ name: 'a' }], parseMode: 'ast' },
      [n('/repo/b.rs')]: { imports: [], exports: ['b'], importRecords: [], exportRecords: [{ name: 'b' }], parseMode: 'regex' },
      [n('/repo/c.rs')]: { imports: [], exports: ['c'], importRecords: [], exportRecords: [{ name: 'c' }], parseMode: 'regex' },
      [n('/repo/d.rs')]: { imports: [], exports: ['d'], importRecords: [], exportRecords: [{ name: 'd' }], parseMode: 'regex' },
    }
  });

  const stats = dg.getStats();
  assert.strictEqual(stats.analysisCoverage.totalFiles, 4);
  assert.strictEqual(stats.analysisCoverage.parsedFiles, 1);
  assert.strictEqual(stats.analysisCoverage.fallbackFiles, 3);
  assert.strictEqual(stats.analysisCoverage.coverageRatio, 0.25);
}

function testCoverageEmptyGraph() {
  const dg = createMockDepGraph({ schema: {} });
  const stats = dg.getStats();
  assert.ok(stats.analysisCoverage, 'should include analysisCoverage even for empty graph');
  assert.strictEqual(stats.analysisCoverage.totalFiles, 0);
  assert.strictEqual(stats.analysisCoverage.parsedFiles, 0);
  assert.strictEqual(stats.analysisCoverage.fallbackFiles, 0);
  assert.strictEqual(stats.analysisCoverage.coverageRatio, 0);
}

function main() {
  testCoverageAllAst();
  testCoverageMixed();
  testCoverageEmptyGraph();
}

main();
