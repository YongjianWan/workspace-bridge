// @semantic — Registered dynamic query modules must not be reported as orphans (#11)
const assert = require('assert');
const { findOrphanFiles } = require('../src/utils/orphan-detector');

function mockGraph(testLike = [], dependents = {}) {
  return {
    isTestLikeFile: (f) => testLike.includes(f),
    getDependents: (f) => dependents[f] || [],
  };
}

function testRegisteredFilesAreNotOrphans() {
  const queryFile = '/workspace/src/services/dep-graph/queries/route-extraction/java-spring.js';
  const files = [queryFile];
  const graph = mockGraph();
  const registeredFiles = new Set([queryFile]);

  const result = findOrphanFiles(files, new Set(), graph, '/workspace', null, null, null, registeredFiles);

  assert.strictEqual(result.all.length, 0, 'registered query file should not be reported as orphan');
  assert.strictEqual(result.modules.length, 0, 'registered query file should not be in modules list');
}

function testUnregisteredFilesStillReportedAsOrphans() {
  const orphanFile = '/workspace/src/orphan.js';
  const files = [orphanFile];
  const graph = mockGraph();
  const registeredFiles = new Set();

  const result = findOrphanFiles(files, new Set(), graph, '/workspace', null, null, null, registeredFiles);

  assert.strictEqual(result.all.length, 1, 'unregistered orphan file should still be reported');
  assert.ok(result.modules.includes('src/orphan.js'), 'unregistered orphan file should be in modules list');
}

function testRegisteredFilesDoNotMaskRealOrphans() {
  const queryFile = '/workspace/src/services/dep-graph/queries/framework-detection/kt-ktor.js';
  const orphanFile = '/workspace/src/unused.js';
  const files = [queryFile, orphanFile];
  const graph = mockGraph();
  const registeredFiles = new Set([queryFile]);

  const result = findOrphanFiles(files, new Set(), graph, '/workspace', null, null, null, registeredFiles);

  assert.strictEqual(result.all.length, 1, 'only the real orphan should be reported');
  assert.ok(!result.all.some((f) => f.includes('kt-ktor')), 'registered query file should be skipped');
  assert.ok(result.modules.includes('src/unused.js'), 'real orphan should still be in modules list');
}

function main() {
  testRegisteredFilesAreNotOrphans();
  testUnregisteredFilesStillReportedAsOrphans();
  testRegisteredFilesDoNotMaskRealOrphans();
  console.log('Orphan registered query: all assertions passed');
}

main();
