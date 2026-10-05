// @fast
// @semantic
const assert = require('assert');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { buildProjectMap } = require('../src/cli/formatters/project-map');
const root = path.resolve(__dirname, 'case-fixture');
const graph = DependencyGraph.fromSchema(root, {
  'main.c': { imports: ['A.h'], exports: [] },
  'A.h': { imports: [], exports: [] },
});
const result = buildProjectMap(graph, { compact: false });
assert.strictEqual(result.edges.length, 1, 'audit-map must retain every selected local edge');
assert.strictEqual(result.edges[0].to, 'A.h', 'edge endpoint must use the same display identity as tree nodes');
console.log('project map case: 2/2 passed');
