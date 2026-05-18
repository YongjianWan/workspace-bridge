const assert = require('assert');
const { buildProjectMap, buildDirectoryTree, countTreeFiles } = require('../src/cli/formatters/project-map');

function createMockDepGraph() {
  const fileInfo = {
    'src/a.js': { parseMode: 'ast', importRecords: [{ resolved: 'src/b.js' }, { resolved: 'src/c.js' }], exports: ['foo'] },
    'src/b.js': { parseMode: 'ast', importRecords: [], exports: ['bar'] },
    'src/c.js': { parseMode: 'ast', importRecords: [], exports: ['baz'] },
    'src/d.js': { parseMode: 'ast', importRecords: [{ resolved: 'src/a.js' }], exports: ['qux'] },
  };
  return {
    root: '/test',
    graph: new Map([
      ['src/a.js', { imports: ['src/b.js', 'src/c.js'], dependents: ['src/d.js'] }],
      ['src/b.js', { imports: [], dependents: ['src/a.js'] }],
      ['src/c.js', { imports: [], dependents: ['src/a.js'] }],
      ['src/d.js', { imports: ['src/a.js'], dependents: [] }],
    ]),
    importRecords: [
      { from: 'src/a.js', to: 'src/b.js', type: 'import' },
      { from: 'src/a.js', to: 'src/c.js', type: 'import' },
      { from: 'src/d.js', to: 'src/a.js', type: 'import' },
    ],
    projectContext: {
      mainlineFiles: new Set(['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']),
      classifyFile: (file) => ({ fileRole: 'library', isMainline: true }),
    },
    entryFiles: new Set(['src/d.js']),
    getStats: () => ({
      totalFiles: 4,
      totalEdges: 3,
      analysisCoverage: { parsedFiles: 4, totalFiles: 4, coverageRatio: 1.0 },
    }),
    getFileInfo: (file) => fileInfo[file] || {},
    _displayPath: (p) => p,
    findDeadExports: () => [],
    findUnresolvedImports: () => [],
    findCircularDependencies: () => [],
  };
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
  const depGraph = {
    root: '/empty',
    graph: new Map(),
    importRecords: [],
    projectContext: { mainlineFiles: new Set() },
    entryFiles: new Set(),
    getStats: () => ({ totalFiles: 0, totalEdges: 0, analysisCoverage: null }),
    findDeadExports: () => [],
    findUnresolvedImports: () => [],
    findCircularDependencies: () => [],
  };
  const result = buildProjectMap(depGraph, { compact: false });
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
