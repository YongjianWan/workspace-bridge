#!/usr/bin/env node
const assert = require('assert');
const { buildProjectMap } = require('../src/cli/audit-formatters');

function testProjectMapStructure() {
  const depGraph = {
    workspaceRoot: '/repo',
    graph: new Map([
      ['/repo/src/index.js', {
        imports: ['/repo/src/util.js'],
        exports: ['main'],
        exportRecords: [{ name: 'main', kind: 'function' }],
        parseMode: 'ast',
      }],
      ['/repo/src/util.js', {
        imports: [],
        exports: ['helper'],
        exportRecords: [{ name: 'helper', kind: 'function' }],
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
  assert(Array.isArray(result.tree), 'tree should be array');
  assert(result.tree.length > 0, 'tree should have entries');
  assert(Array.isArray(result.edges), 'edges should be array');
  assert(result.edges.length > 0, 'edges should have entries');
  assert(result.issueOverlay, 'issueOverlay should exist');

  const indexEntry = result.tree.find((t) => t.file === 'src/index.js');
  assert(indexEntry, 'tree should contain src/index.js');
  assert.strictEqual(indexEntry.role, 'entry', 'index.js role should be entry');

  const edge = result.edges.find((e) => e.from === 'src/index.js' && e.to === 'src/util.js');
  assert(edge, 'edges should contain index.js -> util.js');
  assert.strictEqual(edge.type, 'import', 'edge type should be import');

  console.log('testProjectMapStructure: ok');
}

function testProjectMapWithIssues() {
  const depGraph = {
    workspaceRoot: '/repo',
    graph: new Map([
      ['/repo/src/a.js', { imports: ['/repo/src/b.js'], exports: ['a'], exportRecords: [{ name: 'a', kind: 'function' }], parseMode: 'ast' }],
      ['/repo/src/b.js', { imports: ['/repo/src/a.js'], exports: ['b'], exportRecords: [{ name: 'b', kind: 'function' }], parseMode: 'ast' }],
      ['/repo/src/orphan.js', { imports: [], exports: [], exportRecords: [], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/b.js', ['/repo/src/a.js']],
      ['/repo/src/a.js', ['/repo/src/b.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return [{ file: '/repo/src/orphan.js', exports: ['unused'] }]; },
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
  assert.strictEqual(result.issueOverlay.unresolved.length, 1, 'should have 1 unresolved');
  assert.strictEqual(result.issueOverlay.cycles.length, 1, 'should have 1 cycle');
  assert.strictEqual(result.issueOverlay.orphans.length, 1, 'should have 1 orphan');

  console.log('testProjectMapWithIssues: ok');
}

testProjectMapStructure();
testProjectMapWithIssues();
console.log('audit-map-test: ok');
