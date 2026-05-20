const assert = require('assert');
const { buildProjectMap, buildDirectoryTree, countTreeFiles } = require('../src/cli/formatters/project-map');
const { makeMockSnapshot } = require('./test-helpers');

function createMockDepGraph() {
  const fileInfo = {
    'src/a.js': { parseMode: 'ast', importRecords: [{ resolved: 'src/b.js' }, { resolved: 'src/c.js' }], exports: ['foo'] },
    'src/b.js': { parseMode: 'ast', importRecords: [], exports: ['bar'] },
    'src/c.js': { parseMode: 'ast', importRecords: [], exports: ['baz'] },
    'src/d.js': { parseMode: 'ast', importRecords: [{ resolved: 'src/a.js' }], exports: ['qux'] },
  };
  const snapshot = makeMockSnapshot({
    root: '/test',
    graph: new Map([
      ['src/a.js', { imports: ['src/b.js', 'src/c.js'], dependents: ['src/d.js'] }],
      ['src/b.js', { imports: [], dependents: ['src/a.js'] }],
      ['src/c.js', { imports: [], dependents: ['src/a.js'] }],
      ['src/d.js', { imports: ['src/a.js'], dependents: [] }],
    ]),
    entryFiles: new Set(['src/d.js']),
    projectContext: {
      mainlineFiles: new Set(['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']),
      classifyFile: (file) => ({ fileRole: 'library', isMainline: true }),
    },
    depGraphOverrides: {
      getFileInfo: (file) => fileInfo[file] || {},
      findDeadExports: () => [],
      findUnresolvedImports: () => [],
      findCircularDependencies: () => [],
    },
  });
  return snapshot.graph;
}

function testBuildProjectMapFull() {
  const depGraph = createMockDepGraph();
  const result = buildProjectMap(depGraph, { compact: false });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.workspaceRoot, '/test');
  assert(Array.isArray(result.tree));
  assert(Array.isArray(result.edges));
  assert(result.edges.length > 0);
  assert(result.issueOverlay);
  assert(Array.isArray(result.highlightedFiles));
}

function testBuildProjectMapCompact() {
  const depGraph = createMockDepGraph();
  const result = buildProjectMap(depGraph, { compact: true });
  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.tree));
  assert(Array.isArray(result.edges));
  assert(result.summary);
}

function testBuildDirectoryTree() {
  const files = [{ file: 'src/a.js' }, { file: 'src/b.js' }, { file: 'src/utils/c.js' }, { file: 'test/d.js' }];
  const tree = buildDirectoryTree(files);
  assert.strictEqual(tree.length, 2);
  const src = tree.find((t) => t.name === 'src');
  assert(src);
  assert.strictEqual(src.children.length, 3);
  assert(src.children.some((c) => c.name === 'a.js'));
  assert(src.children.some((c) => c.name === 'b.js'));
  assert(src.children.some((c) => c.name === 'utils'));
}

function testCountTreeFiles() {
  const tree = [
    { type: 'directory', name: 'src', children: [
      { type: 'file', name: 'a.js' },
      { type: 'directory', name: 'b', children: [{ type: 'file', name: 'c.js' }] },
    ]},
    { type: 'directory', name: 'test', children: [{ type: 'file', name: 'd.js' }] },
  ];
  assert.strictEqual(countTreeFiles(tree), 3);
}

function testBuildProjectMapEmptyGraph() {
  const snapshot = makeMockSnapshot({
    root: '/empty',
    graph: new Map(),
    entryFiles: new Set(),
    projectContext: { mainlineFiles: new Set() },
    depGraphOverrides: {
      getStats: () => ({ totalFiles: 0, totalEdges: 0, analysisCoverage: null }),
      findDeadExports: () => [],
      findUnresolvedImports: () => [],
      findCircularDependencies: () => [],
    },
  });
  const result = buildProjectMap(snapshot.graph, { compact: false });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.edges.length, 0);
}

function main() {
  testBuildProjectMapFull();
  testBuildProjectMapCompact();
  testBuildDirectoryTree();
  testCountTreeFiles();
  testBuildProjectMapEmptyGraph();
}

main();
