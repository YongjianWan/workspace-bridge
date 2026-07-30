// @contract
//
// The JVM zero-list gate (L2-11 gap C) is the only gate whose input does not
// come from disk — the builder computes the workspace package set and hands it
// to the resolver through ctx. That makes the wiring, not the rule, the fragile
// part: `_isExternalJvmPackage` treats an absent set as "unknown" and steps
// aside, so a resolve path that forgets `_refreshWorkspacePackages()` turns the
// whole gate off with no edge count moving and no warning anywhere.
//
// This locks the structural precondition instead: resolving before the package
// set exists is a wiring bug and must throw. Silent degradation is what L1-4
// forbids, and per L3-8 a condition that structurally cannot happen gets to
// blow up rather than be papered over with a fallback.
const assert = require('assert');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

function makeGraph() {
  const root = path.resolve(__dirname, '..');
  const cache = new WorkspaceCache(root, { persist: false });
  return new DependencyGraph(root, cache, {});
}

function testResolveBeforePackageSetIsComputedThrows() {
  const graph = makeGraph();
  const builder = graph.builder;
  assert.strictEqual(
    builder.workspacePackages,
    null,
    'a fresh builder must declare the package set as "not computed", not leave it undefined'
  );

  const parsed = {
    filePath: path.join(graph.root, 'Main.java'),
    graphKey: 'main.java',
    content: '',
    imports: [],
    exports: [],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    parseModeReason: null,
    confidence: 1,
    package: 'com.example',
  };

  assert.throws(
    () => builder.resolveFileOnly(parsed),
    /workspacePackages/,
    'resolving before the package set is computed must fail loudly, not silently disable the JVM gate'
  );
}

function testRefreshMakesResolveLegal() {
  const graph = makeGraph();
  const builder = graph.builder;
  builder._refreshWorkspacePackages();
  assert.ok(builder.workspacePackages instanceof Set, 'refresh must produce a set');

  const parsed = {
    filePath: path.join(graph.root, 'Main.java'),
    graphKey: 'main.java',
    content: '',
    imports: [],
    exports: [],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    parseModeReason: null,
    confidence: 1,
    package: 'com.example',
  };
  builder.resolveFileOnly(parsed); // must not throw
}

function main() {
  testResolveBeforePackageSetIsComputedThrows();
  testRefreshMakesResolveLegal();
  console.log('jvm-gate-wiring: 2/2 passed');
}

main();
