#!/usr/bin/env node
const assert = require('assert');
const { buildProjectMap } = require('../src/cli/formatters');

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

function testProjectMapCompactMode() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/core/a.ts', {
        imports: ['/repo/src/core/b.ts', '/repo/src/mcp/c.ts'],
        exports: ['foo'],
        exportRecords: [{ name: 'foo', kind: 'function' }],
        importRecords: [
          { source: './b.ts', resolved: '/repo/src/core/b.ts', imported: ['bar'], usesAllExports: false },
          { source: '../mcp/c.ts', resolved: '/repo/src/mcp/c.ts', imported: ['baz'], usesAllExports: true },
        ],
        parseMode: 'ast',
      }],
      ['/repo/src/core/b.ts', {
        imports: [],
        exports: ['bar'],
        exportRecords: [{ name: 'bar', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      }],
      ['/repo/src/mcp/c.ts', {
        imports: ['/repo/src/core/a.ts'],
        exports: ['baz'],
        exportRecords: [{ name: 'baz', kind: 'function' }],
        importRecords: [
          { source: '../core/a.ts', resolved: '/repo/src/core/a.ts', imported: ['foo'], usesAllExports: false },
        ],
        parseMode: 'ast',
      }],
      ['/repo/rootfile.js', {
        imports: [],
        exports: ['x'],
        exportRecords: [{ name: 'x' }],
        importRecords: [],
        parseMode: 'ast',
      }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/core/b.ts', ['/repo/src/core/a.ts']],
      ['/repo/src/mcp/c.ts', ['/repo/src/core/a.ts']],
      ['/repo/src/core/a.ts', ['/repo/src/mcp/c.ts']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return [{ file: '/repo/src/core/b.ts', exports: ['unused'], confidence: 'medium' }]; },
    findUnresolvedImports() { return [{ file: '/repo/src/mcp/c.ts', import: './missing' }]; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(['/repo/rootfile.js']),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph, { compact: true });

  assert.strictEqual(result.ok, true, 'compact should return ok');

  function findFileNodes(nodes) {
    const files = [];
    for (const n of nodes || []) {
      if (n.type === 'file') files.push(n);
      if (n.type === 'directory' && n.children) files.push(...findFileNodes(n.children));
    }
    return files;
  }
  const fileNodes = findFileNodes(result.tree);
  assert.strictEqual(fileNodes.length, 0, 'compact tree should have no file nodes');

  function assertAllDirectories(nodes) {
    for (const n of nodes || []) {
      assert.strictEqual(n.type, 'directory', `expected directory node, got ${n.type}`);
      assert(typeof n.fileCount === 'number', `directory ${n.name} should have fileCount`);
      assert(typeof n.totalFileCount === 'number', `directory ${n.name} should have totalFileCount`);
      if (n.children) assertAllDirectories(n.children);
    }
  }
  assertAllDirectories(result.tree);

  assert(Array.isArray(result.highlightedFiles), 'highlightedFiles should be an array');
  const entryHighlight = result.highlightedFiles.find((h) => h.file === 'rootfile.js');
  assert(entryHighlight, 'highlightedFiles should contain entry file rootfile.js');
  assert.strictEqual(entryHighlight.reason, 'entry', 'entry file reason should be entry');

  function looksLikeFile(p) {
    const seg = p.split('/').pop();
    return seg !== '.' && seg.includes('.');
  }
  for (const e of result.edges) {
    assert(!looksLikeFile(e.from), `from should be directory: ${e.from}`);
    assert(!looksLikeFile(e.to), `to should be directory: ${e.to}`);
    assert(e.from !== e.to, `no self-referencing edges: ${e.from} -> ${e.to}`);
    assert(e.type === 'import' || e.type === 're-export-all', `type should be import or re-export-all, got ${e.type}`);
  }

  const coreToMcp = result.edges.find((e) => e.from === 'src/core' && e.to === 'src/mcp');
  assert(coreToMcp, 'should have src/core -> src/mcp edge');
  assert.strictEqual(coreToMcp.usesAllExports, true, 'usesAllExports should be OR-ed');

  const mcpToCore = result.edges.find((e) => e.from === 'src/mcp' && e.to === 'src/core');
  assert(mcpToCore, 'should have src/mcp -> src/core edge');

  assert(result.issueOverlay, 'issueOverlay should exist in compact mode');
  assert.strictEqual(result.issueOverlay.deadExports.length, 1, 'should preserve dead exports');
  assert.strictEqual(result.issueOverlay.unresolved.length, 1, 'should preserve unresolved');

  const deadExport = result.issueOverlay.deadExports[0];
  assert(!('exports' in deadExport), 'compact deadExport should omit exports array');

  console.log('testProjectMapCompactMode: ok');
}

testProjectMapStructure();
testProjectMapWithIssues();
testProjectMapReExportEdges();
testProjectMapHotspots();
testProjectMapToRelativePathBoundary();
function testProjectMapCompactDepthLimit() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/core/ingestion/a.ts', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/core/ingestion/b.ts', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/mcp/server/c.ts', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/mcp/d.ts', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
      ['/repo/docs/readme.md', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'none' }],
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

  const result = buildProjectMap(depGraph, { compact: true });

  function collectDirPaths(nodes, depth = 0) {
    const paths = [];
    for (const n of nodes || []) {
      if (n.type === 'directory') {
        paths.push({ path: n.path, depth });
        if (n.children) paths.push(...collectDirPaths(n.children, depth + 1));
      }
    }
    return paths;
  }
  const dirPaths = collectDirPaths(result.tree);
  const maxDepth = Math.max(...dirPaths.map((d) => d.depth));
  assert(maxDepth <= 3, `max depth should be <= 3, got ${maxDepth}`);

  const coreDir = result.tree.find((t) => t.name === 'src')?.children?.find((c) => c.name === 'core');
  assert(coreDir, 'should have src/core directory');
  const ingestionDir = coreDir.children.find((c) => c.type === 'directory' && c.name === 'ingestion');
  assert(ingestionDir, 'src/core should contain ingestion subdirectory (depth 3 retention)');
  assert.strictEqual(ingestionDir.fileCount, 2, 'ingestion fileCount should include its 2 files');
  assert.strictEqual(ingestionDir.totalFileCount, 2, 'ingestion totalFileCount should match');
  // core itself has no direct files; all files live under ingestion
  assert.strictEqual(coreDir.fileCount, 0, 'src/core fileCount should be 0 (files are in ingestion)');
  assert.strictEqual(coreDir.totalFileCount, 2, 'src/core totalFileCount should still aggregate ingestion');

  const mcpDir = result.tree.find((t) => t.name === 'src')?.children?.find((c) => c.name === 'mcp');
  assert(mcpDir, 'should have src/mcp directory');
  const serverDir = mcpDir.children.find((c) => c.type === 'directory' && c.name === 'server');
  assert(serverDir, 'src/mcp should contain server subdirectory (depth 3 retention)');
  assert.strictEqual(serverDir.fileCount, 1, 'server fileCount should include its 1 file');
  // mcp has 1 direct file (d.ts) plus 1 under server
  assert.strictEqual(mcpDir.fileCount, 1, 'src/mcp fileCount should reflect direct files only');
  assert.strictEqual(mcpDir.totalFileCount, 2, 'src/mcp totalFileCount should include server file');

  console.log('testProjectMapCompactDepthLimit: ok');
}

function testProjectMapCompactModuleEdges() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/core/ingestion/a.ts', {
        imports: ['/repo/src/mcp/server/c.ts', '/repo/src/utils/d.ts'],
        exports: [], exportRecords: [],
        importRecords: [
          { source: '../mcp/server/c.ts', resolved: '/repo/src/mcp/server/c.ts', imported: ['c'], usesAllExports: false },
          { source: '../../utils/d.ts', resolved: '/repo/src/utils/d.ts', imported: ['d'], usesAllExports: false },
        ],
        parseMode: 'ast',
      }],
      ['/repo/src/mcp/server/c.ts', {
        imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast',
      }],
      ['/repo/src/utils/d.ts', {
        imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast',
      }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/mcp/server/c.ts', ['/repo/src/core/ingestion/a.ts']],
      ['/repo/src/utils/d.ts', ['/repo/src/core/ingestion/a.ts']],
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

  const result = buildProjectMap(depGraph, { compact: true });

  for (const e of result.edges) {
    const fromSegs = e.from.split('/');
    const toSegs = e.to.split('/');
    assert(fromSegs.length <= 3, `edge from should be at most 3 segments, got ${e.from}`);
    assert(toSegs.length <= 3, `edge to should be at most 3 segments, got ${e.to}`);
    assert.strictEqual(e.type, 'import', `module-level edge type should be import, got ${e.type}`);
  }

  const coreToMcp = result.edges.find((e) => e.from === 'src/core/ingestion' && e.to === 'src/mcp/server');
  assert(coreToMcp, 'should have src/core/ingestion -> src/mcp/server module edge');

  const coreToUtils = result.edges.find((e) => e.from === 'src/core/ingestion' && e.to === 'src/utils');
  assert(coreToUtils, 'should have src/core/ingestion -> src/utils module edge');

  console.log('testProjectMapCompactModuleEdges: ok');
}

function testProjectMapCompactHighlightLimit() {
  const files = [];
  for (let i = 0; i < 40; i++) {
    files.push([`/repo/src/orphan${i}.js`, { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }]);
  }
  const depGraph = {
    root: '/repo',
    graph: new Map(files),
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

  const result = buildProjectMap(depGraph, { compact: true });
  assert(result.highlightedFiles.length <= 30, `highlightedFiles should be capped at 30 in compact mode, got ${result.highlightedFiles.length}`);

  console.log('testProjectMapCompactHighlightLimit: ok');
}

testProjectMapCompactMode();
testProjectMapCompactDepthLimit();
testProjectMapCompactModuleEdges();
testProjectMapCompactHighlightLimit();

function testProjectMapCompactSummary() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/a.js', { imports: ['/repo/src/b.js'], exports: ['a'], exportRecords: [{ name: 'a' }], importRecords: [{ source: './b.js', resolved: '/repo/src/b.js' }], parseMode: 'ast' }],
      ['/repo/src/b.js', { imports: ['/repo/src/a.js'], exports: ['b'], exportRecords: [{ name: 'b' }], importRecords: [{ source: './a.js', resolved: '/repo/src/a.js' }], parseMode: 'ast' }],
      ['/repo/src/c.js', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/d.js', { imports: [], exports: ['d'], exportRecords: [{ name: 'd' }], importRecords: [], parseMode: 'ast' }],
      ['/repo/src/e.js', { imports: [], exports: [], exportRecords: [], importRecords: [], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map([
      ['/repo/src/b.js', ['/repo/src/a.js']],
      ['/repo/src/a.js', ['/repo/src/b.js']],
    ]),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return [{ file: '/repo/src/d.js', exports: ['unused'], confidence: 'high' }]; },
    findUnresolvedImports() { return [{ file: '/repo/src/c.js', import: './missing' }]; },
    findCircularDependencies() { return [['/repo/src/a.js', '/repo/src/b.js']]; },
    entryFiles: new Set(['/repo/src/e.js']),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph, { compact: true });

  assert(result.summary, 'compact mode should include summary');
  assert.strictEqual(result.summary.severity, 'high', 'severity should be high due to unresolved');
  assert.strictEqual(result.summary.issueCounts.unresolved, 1, 'should count 1 unresolved');
  assert.strictEqual(result.summary.issueCounts.cycles, 1, 'should count 1 cycle');
  assert.strictEqual(result.summary.issueCounts.deadExports, 1, 'should count 1 dead export');
  assert.strictEqual(result.summary.issueCounts.orphans, 2, 'should count 2 orphans (c.js and d.js have no dependents and are not entry)');
  assert(Array.isArray(result.summary.nextSteps), 'nextSteps should be array');
  assert(result.summary.nextSteps.length > 0, 'nextSteps should not be empty');
  assert(result.summary.nextSteps[0].includes('unresolved'), 'first nextStep should mention unresolved');

  // highlightedFiles should be sorted by priority: unresolved > cycle > dead-export > orphan > entry
  const unresolvedIndex = result.highlightedFiles.findIndex((h) => h.file === 'src/c.js');
  const entryIndex = result.highlightedFiles.findIndex((h) => h.file === 'src/e.js');
  assert(unresolvedIndex >= 0, 'highlightedFiles should contain c.js');
  assert(entryIndex >= 0, 'highlightedFiles should contain e.js');
  assert(unresolvedIndex < entryIndex, 'unresolved file should appear before entry file in highlightedFiles');

  console.log('testProjectMapCompactSummary: ok');
}

function testProjectMapCompactSummaryClean() {
  const depGraph = {
    root: '/repo',
    graph: new Map([
      ['/repo/src/a.js', { imports: [], exports: ['a'], exportRecords: [{ name: 'a' }], importRecords: [], parseMode: 'ast' }],
    ]),
    reverseGraph: new Map(),
    getFileInfo(file) { return this.graph.get(file); },
    hasFile(file) { return this.graph.has(file); },
    getDependents(file) { return this.reverseGraph.get(file) || []; },
    getDependencies(file) { return this.graph.get(file)?.imports || []; },
    findDeadExports() { return []; },
    findUnresolvedImports() { return []; },
    findCircularDependencies() { return []; },
    entryFiles: new Set(['/repo/src/a.js']),
    isTestLikeFile() { return false; },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  };

  const result = buildProjectMap(depGraph, { compact: true });

  assert(result.summary, 'compact mode should include summary even when clean');
  assert.strictEqual(result.summary.severity, 'none', 'severity should be none when no issues');
  assert.strictEqual(result.summary.nextSteps[0], 'No structural issues detected by the aggregate audit.', 'clean project should say no issues');

  console.log('testProjectMapCompactSummaryClean: ok');
}

testProjectMapCompactSummary();
testProjectMapCompactSummaryClean();
console.log('audit-map-test: ok');
