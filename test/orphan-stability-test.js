// @contract — Orphan detection stability & determinism (W3-3 regression)
const assert = require('assert');
const { findOrphanFiles } = require('../src/utils/orphan-detector');
const { createMockDepGraph } = require('./test-helpers');

function makeGraph() {
  return createMockDepGraph({
    mode: 'stub',
    root: '/project',
    schema: {
      '/project/src/app.js': { imports: ['/project/src/utils.js'] },
      '/project/src/utils.js': {},
      '/project/src/orphan.js': {},
      '/project/test/app.test.js': { imports: ['/project/src/app.js'] },
      '/project/README.md': {},
      '/project/scripts/build.js': {},
    },
  });
}

// findOrphanFiles must be deterministic: same input → same output
{
  const graph = makeGraph();
  const files = Array.from(graph.graph.keys());
  const entryFiles = new Set(['/project/src/app.js']);

  const shouldExcludeTest = (file) => file.includes('/test/');
  const r1 = findOrphanFiles(files, entryFiles, graph, '/project', null, null, shouldExcludeTest);
  const r2 = findOrphanFiles(files, entryFiles, graph, '/project', null, null, shouldExcludeTest);

  assert.deepStrictEqual(r1.all, r2.all, 'W3-3: orphan detection must be deterministic');
  assert.strictEqual(r1.all.length, 2, `W3-3: expected 2 orphans (orphan.js + scripts/build.js), got ${r1.all.length}`);
  assert.ok(r1.all.includes('src/orphan.js'), 'W3-3: src/orphan.js should be orphan');
  assert.ok(r1.modules.includes('src/orphan.js'), 'W3-3: src/orphan.js should be categorized as module');
}

// Empty entryFiles (undefined vs new Set) must produce identical counts
{
  const graph = makeGraph();
  const files = Array.from(graph.graph.keys());

  const rSet = findOrphanFiles(files, new Set(), graph, '/project');
  const rUndef = findOrphanFiles(files, undefined, graph, '/project');

  assert.strictEqual(rSet.all.length, rUndef.all.length, 'W3-3: undefined entryFiles vs empty Set must yield same orphan count');
}

// README.md and scripts should be excluded by standalone-entry logic, not counted as modules
{
  const graph = makeGraph();
  const files = Array.from(graph.graph.keys());
  const entryFiles = new Set();

  const r = findOrphanFiles(files, entryFiles, graph, '/project');
  assert.ok(!r.modules.includes('README.md'), 'W3-3: README.md should not be in modules');
  assert.ok(!r.modules.includes('scripts/build.js'), 'W3-3: scripts/build.js should not be in modules (standalone entry)');
  assert.ok(r.all.includes('README.md') || r.docs.includes('README.md'), 'W3-3: README.md should still be tracked in all/docs');
}

console.log('Orphan stability: all assertions passed');
