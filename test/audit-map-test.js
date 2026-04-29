#!/usr/bin/env node
const assert = require('assert');
const { buildProjectMap } = require('../src/cli/audit-formatters');

function testProjectMapStructure() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/index.js', {
        imports: ['/repo/src/util.js'],
        exports: ['main'],
        exportRecords: [{ name: 'main', kind: 'function' }],
        importRecords: [
          { source: './util.js', resolved: '/repo/src/util.js', imported: ['helper'], usesAllExports: false },
        ],
        parseMode: 'ast',
      }],
      ['/repo/src/util.js', {
        imports: [],
        exports: ['helper'],
        exportRecords: [{ name: 'helper', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/util.js', ['/repo/src/index.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return []; },
    findUnresolvedImports() { return []; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(['/repo/src/index.js']),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile(file) {
        if (file.includes('test')) return { isMainline: false, fileRole: 'test' };
        if (file.includes('index')) return { isMainline: true, fileRole: 'entry' };
        return { isMainline: true, fileRole: 'library' };
      },
    },
  };

  const result = buildProjectMap(depGraph);

  assert.strictEqual(result.ok, true, 'should return ok');
  assert.strictEqual(result.workspaceRoot, '/repo', 'workspaceRoot should match depGraph.root');
  assert(Array.isArray(result.tree), 'tree should be array');
  assert(result.tree.length > 0, 'tree should have entries');
  assert(Array.isArray(result.edges), 'edges should be array');
  assert(result.edges.length > 0, 'edges should have entries');
  assert(result.issueOverlay, 'issueOverlay should exist');

  // Directory-aggregated tree
  const srcDir = result.tree.find((t) => t.type === 'directory' && t.name === 'src');
  assert(srcDir, 'tree should contain src directory');
  assert(Array.isArray(srcDir.children), 'src directory should have children');

  const indexEntry = srcDir.children.find((t) => t.type === 'file' && t.name === 'index.js');
  assert(indexEntry, 'tree should contain index.js file node');
  assert.strictEqual(indexEntry.role, 'entry', 'index.js role should be entry');
  assert.strictEqual(indexEntry.file, 'src/index.js', 'index.js file path should be relative');

  const edge = result.edges.find((e) => e.from === 'src/index.js' && e.to === 'src/util.js');
  assert(edge, 'edges should contain index.js -> util.js');
  assert.strictEqual(edge.type, 'import', 'edge type should be import');
  assert.deepStrictEqual(edge.symbols, ['helper'], 'edge should carry imported symbols');

  console.log('testProjectMapStructure: ok');
}

function testProjectMapWithIssues() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/a.js', { imports: ['/repo/src/b.js'], exports: ['a'], exportRecords: [{ name: 'a', kind: 'function' }], importRecords: [{ source: './b.js', resolved: '/repo/src/b.js', imported: ['b'], usesAllExports: false }], parseMode: 'ast' }],
      ['/repo/src/b.js', { imports: ['/repo/src/a.js'], exports: ['b'], exportRecords: [{ name: 'b', kind: 'function' }], importRecords: [{ source: './a.js', resolved: '/repo/src/a.js', imported: ['a'], usesAllExports: false }], parseMode: 'ast' }],
      ['/repo/src/orphan.js', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/b.js', ['/repo/src/a.js']],
      ['/repo/src/a.js', ['/repo/src/b.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return [{ file: '/repo/src/orphan.js', exports: ['unused'], confidence: 'high' }]; },
    findUnresolvedImports() { return [{ file: '/repo/src/a.js', import: './missing' }]; },
    findCircularDependencies() { return [['/repo/src/a.js', '/repo/src/b.js', '/repo/src/a.js']]; },
    entryFiles: new Set(['/repo/src/a.js']),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile(file) {
        return { isMainline: true, fileRole: 'library' };
      },
    },
  };

  const result = buildProjectMap(depGraph);

  assert.strictEqual(result.issueOverlay.deadExports.length, 1, 'should have 1 dead export');
  assert.strictEqual(result.issueOverlay.deadExports[0].confidence, 'high', 'dead export should preserve confidence');
  assert.strictEqual(result.issueOverlay.unresolved.length, 1, 'should have 1 unresolved');
  assert.strictEqual(result.issueOverlay.cycles.length, 1, 'should have 1 cycle');
  assert.strictEqual(result.issueOverlay.orphans.length, 1, 'should have 1 orphan');

  console.log('testProjectMapWithIssues: ok');
}

function testProjectMapReExportEdges() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/barrel.js', {
        imports: ['/repo/src/a.js'],
        exports: ['foo'],
        exportRecords: [{ name: 'foo', kind: 'function' }],
        importRecords: [
          { source: './a.js', resolved: '/repo/src/a.js', imported: ['foo'], usesAllExports: false, reExported: [{ imported: 'foo', exported: 'foo' }] },
        ],
        parseMode: 'ast',
      }],
      ['/repo/src/a.js', {
        imports: [],
        exports: ['foo'],
        exportRecords: [{ name: 'foo', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/a.js', ['/repo/src/barrel.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return []; },
    findUnresolvedImports() { return []; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph);

  const reExportEdge = result.edges.find((e) => e.type === 're-export' && e.from === 'src/barrel.js' && e.to === 'src/a.js');
  assert(reExportEdge, 'should contain re-export edge from barrel to a');
  assert.strictEqual(reExportEdge.imported, 'foo', 're-export edge should carry imported symbol');
  assert.strictEqual(reExportEdge.exported, 'foo', 're-export edge should carry exported symbol');

  console.log('testProjectMapReExportEdges: ok');
}

function testProjectMapHotspots() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/core.js', { imports: [], exports: ['core'], exportRecords: [{ name: 'core' }], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/a.js', { imports: ['/repo/src/core.js'], exports: ['a'], exportRecords: [{ name: 'a' }], importRecords: [{ source: './core.js', resolved: '/repo/src/core.js', imported: ['core'] }], parseMode: 'ast' }],
      ['/repo/src/b.js', { imports: ['/repo/src/core.js'], exports: ['b'], exportRecords: [{ name: 'b' }], importRecords: [{ source: './core.js', resolved: '/repo/src/core.js', imported: ['core'] }], parseMode: 'ast' }],
      ['/repo/src/c.js', { imports: ['/repo/src/core.js'], exports: ['c'], exportRecords: [{ name: 'c' }], importRecords: [{ source: './core.js', resolved: '/repo/src/core.js', imported: ['core'] }], parseMode: 'ast' }],
      ['/repo/src/d.js', { imports: ['/repo/src/core.js'], exports: ['d'], exportRecords: [{ name: 'd' }], importRecords: [{ source: './core.js', resolved: '/repo/src/core.js', imported: ['core'] }], parseMode: 'ast' }],
      ['/repo/src/e.js', { imports: ['/repo/src/core.js'], exports: ['e'], exportRecords: [{ name: 'e' }], importRecords: [{ source: './core.js', resolved: '/repo/src/core.js', imported: ['core'] }], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/core.js', ['/repo/src/a.js', '/repo/src/b.js', '/repo/src/c.js', '/repo/src/d.js', '/repo/src/e.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return []; },
    findUnresolvedImports() { return []; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph);

  assert(Array.isArray(result.issueOverlay.hotspots), 'hotspots should be an array');
  assert(result.issueOverlay.hotspots.length > 0, 'should have hotspots for highly imported files');
  const coreHotspot = result.issueOverlay.hotspots.find((h) => h.file === 'src/core.js');
  assert(coreHotspot, 'core.js should be a hotspot');
  assert.strictEqual(coreHotspot.dependentCount, 5, 'core.js should have 5 dependents');

  console.log('testProjectMapHotspots: ok');
}

function testProjectMapToRelativePathBoundary() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo-extra/file.js', { imports: [], exports: ['x'], exportRecords: [{ name: 'x' }], importRecords: [], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map(),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents() { return []; },
    getDependencies() { return []; },
    findDeadExports() { return []; },
    findUnresolvedImports() { return []; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph);

  // /repo-extra/file.js should NOT be sliced to extra/file.js because /repo is the root
  const entry = result.tree.find((t) => t.type === 'directory' && t.name === 'repo-extra');
  assert(entry, 'repo-extra should remain as its own directory, not be sliced under /repo');
  if (entry) {
    const fileNode = entry.children.find((c) => c.type === 'file' && c.name === 'file.js');
    assert(fileNode, 'file.js should be under repo-extra');
    assert.strictEqual(fileNode.file, '/repo-extra/file.js', 'file path outside root should remain absolute');
  }

  console.log('testProjectMapToRelativePathBoundary: ok');
}

testProjectMapStructure();
testProjectMapWithIssues();
testProjectMapReExportEdges();
testProjectMapHotspots();
testProjectMapToRelativePathBoundary();
console.log('audit-map-test: ok');
