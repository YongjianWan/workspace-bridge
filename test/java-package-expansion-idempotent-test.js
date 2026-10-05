#!/usr/bin/env node
// @fast
// @semantic
/**
 * Same-package and wildcard expansion indexes imports/records by membership. Expanding the same
 * file twice must add each edge and each implicit record exactly once.
 */
const assert = require('assert');
const os = require('os');
const { DependencyGraph } = require('../src/services/dep-graph');
const { GraphBuilder } = require('../src/services/dep-graph/builder');

const files = ['pkg/A.java', 'pkg/B.java', 'pkg/C.java'];

function freshBuilder() {
  const builder = new GraphBuilder(DependencyGraph.fromSchema(os.tmpdir(), {}));
  builder.packageIndex = new Map([['pkg', new Set(files)]]);
  builder._readReferenceSource = () => null; // no evidence either way: the gate keeps the edge
  return builder;
}

function expandTwice(info) {
  const builder = freshBuilder();
  builder.dg.graph.set('pkg/A.java', info);
  builder._expandJavaForFile('pkg/A.java', info);
  const second = builder._expandJavaForFile('pkg/A.java', info);
  return { info, second };
}

const samePackage = expandTwice({ package: 'pkg', imports: [], importRecords: [] });
assert.deepStrictEqual([...samePackage.info.imports].sort(), ['pkg/B.java', 'pkg/C.java']);
assert.strictEqual(samePackage.info.importRecords.filter((r) => r.resolutionMethod === 'java-same-package').length, 2);
assert.strictEqual(samePackage.second.edgeCount, 0, 'the second expansion adds no edge');

const wildcardRecord = { source: 'pkg.*', usesAllExports: true, resolved: null };
const wildcard = expandTwice({ package: null, imports: [], importRecords: [wildcardRecord] });
assert.deepStrictEqual([...wildcard.info.imports].sort(), ['pkg/B.java', 'pkg/C.java']);
assert.strictEqual(wildcard.info.importRecords.filter((r) => r.resolutionMethod === 'java-wildcard').length, 2);
