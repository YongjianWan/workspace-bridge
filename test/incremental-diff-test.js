// @semantic
const assert = require('assert');
const path = require('path');
const { buildIncrementalFindings, collectRelatedFiles } = require('../src/tools/incremental-diff');
const { normalizePathKey } = require('../src/utils/path');

function createMockDepGraph() {
  return {
    getImpactRadius: (file, depth = 2) => {
      const map = {
        'src/a.js': [
          { file: 'src/b.js', depth: 1 },
          { file: 'src/c.js', depth: 1 },
        ],
        'src/b.js': [{ file: 'src/d.js', depth: 1 }],
        'src/x.js': [{ file: 'src/y.js', depth: 1 }],
      };
      return map[file] || [];
    },
    getDependencies: (file) => {
      const map = {
        'src/a.js': ['src/b.js'],
        'src/b.js': ['src/c.js'],
      };
      return map[file] || [];
    },
    findDeadExports: () => [
      { file: 'src/a.js', exports: ['unusedA'] },
    ],
    findUnresolvedImports: () => [
      { file: 'src/a.js', import: 'missing-a' },
      { file: 'src/x.js', import: 'missing-x' },
    ],
    findCircularDependencies: () => [
      ['src/a.js', 'src/b.js'],
      ['src/x.js', 'src/y.js'],
    ],
  };
}

function testCollectRelatedFiles() {
  const depGraph = createMockDepGraph();
  const related = collectRelatedFiles(['src/a.js'], depGraph);
  assert(related.has(normalizePathKey('src/a.js')), 'should include the changed file itself');
  assert(related.has(normalizePathKey('src/b.js')), 'should include impact radius files');
  assert(related.has(normalizePathKey('src/c.js')), 'should include impact radius files');
  assert(!related.has(normalizePathKey('src/x.js')), 'should not include unrelated files');
}

function testCollectRelatedFilesMultiple() {
  const depGraph = createMockDepGraph();
  const related = collectRelatedFiles(['src/a.js', 'src/x.js'], depGraph);
  assert(related.has(normalizePathKey('src/a.js')));
  assert(related.has(normalizePathKey('src/b.js')));
  assert(related.has(normalizePathKey('src/x.js')));
  assert(related.has(normalizePathKey('src/y.js')));
}

function testCollectRelatedFilesEmpty() {
  const depGraph = createMockDepGraph();
  const related = collectRelatedFiles([], depGraph);
  assert.strictEqual(related.size, 0);
}

function testBuildIncrementalFindingsFiltersToRelated() {
  const depGraph = createMockDepGraph();
  const container = { depGraph };
  const result = buildIncrementalFindings(['src/a.js'], container);

  assert.strictEqual(result.deadExportsCount, 1);
  assert.strictEqual(result.deadExports[0].file, 'src/a.js');
  assert.strictEqual(result.unresolvedCount, 1);
  assert.strictEqual(result.unresolved[0].file, 'src/a.js');
  assert.strictEqual(result.cyclesCount, 1);
  assert.deepStrictEqual(result.cycles[0], ['src/a.js', 'src/b.js']);
}

function testBuildIncrementalFindingsNoOverlap() {
  const depGraph = createMockDepGraph();
  const container = { depGraph };
  const result = buildIncrementalFindings(['src/z.js'], container);

  assert.strictEqual(result.deadExportsCount, 0);
  assert.strictEqual(result.unresolvedCount, 0);
  assert.strictEqual(result.cyclesCount, 0);
}

function testBuildIncrementalFindingsMultipleFiles() {
  const depGraph = createMockDepGraph();
  const container = { depGraph };
  const result = buildIncrementalFindings(['src/a.js', 'src/x.js'], container);

  assert.strictEqual(result.deadExportsCount, 1, 'only a.js has dead exports');
  assert.strictEqual(result.unresolvedCount, 2);
  assert.strictEqual(result.cyclesCount, 2);
}

function testBuildIncrementalFindingsEmpty() {
  const depGraph = createMockDepGraph();
  const container = { depGraph };
  const result = buildIncrementalFindings([], container);

  assert.strictEqual(result.deadExportsCount, 0);
  assert.strictEqual(result.unresolvedCount, 0);
  assert.strictEqual(result.cyclesCount, 0);
}

function main() {
  testCollectRelatedFiles();
  testCollectRelatedFilesMultiple();
  testCollectRelatedFilesEmpty();
  testBuildIncrementalFindingsFiltersToRelated();
  testBuildIncrementalFindingsNoOverlap();
  testBuildIncrementalFindingsMultipleFiles();
  testBuildIncrementalFindingsEmpty();
}

main();
