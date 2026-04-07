#!/usr/bin/env node

const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');

function makeGraph() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  depGraph.graph = new Map([
    ['/repo/src/feature.js', { imports: [], exports: ['feature'] }],
    ['/repo/test/feature.test.js', { imports: [], exports: ['testFeature'] }],
    ['/repo/test/group-b/feature.test.js', { imports: [], exports: ['testFeature'] }],
    ['/repo/src/server/auth/login.js', { imports: [], exports: ['login'] }],
    ['/repo/test/client/auth/login.test.js', { imports: [], exports: ['testLogin'] }],
    ['/repo/src/test/java/server/auth/LoginTests.java', { imports: [], exports: ['LoginTests'] }],
    ['/repo/packages/foo/src/service.js', { imports: [], exports: ['service'] }],
    ['/repo/packages/foo/test/service.test.js', { imports: [], exports: ['testService'] }],
    ['/repo/packages/foo/test/group-b/service.test.js', { imports: [], exports: ['testService'] }],
    ['/repo/src/main/java/com/acme/Foo.java', { imports: [], exports: ['Foo'] }],
    ['/repo/src/test/java/com/acme/FooTests.java', { imports: [], exports: ['FooTests'] }],
    ['/repo/src/test/java/com/acme/FooSpecs.java', { imports: [], exports: ['FooSpecs'] }],
    ['/repo/src/test/java/com/acme/FooTestCases.java', { imports: [], exports: ['FooTestCases'] }],
    ['/repo/src/test/java/com/acme/FooITs.java', { imports: [], exports: ['FooITs'] }],
    ['/repo/src/test/java/com/acme/FooHelperTests.java', { imports: [], exports: ['FooHelperTests'] }],
    ['/repo/src/test/java/com/acme/FooHelperSpecs.java', { imports: [], exports: ['FooHelperSpecs'] }],
    ['/repo/src/main/java/com/acme/Audit.java', { imports: [], exports: ['Audit'] }],
    ['/repo/src/test/java/com/acme/AuditTests.java', { imports: [], exports: ['AuditTests'] }],
    ['/repo/src/test/java/com/acme/FooIT.java', { imports: [], exports: ['FooIT'] }],
    ['C:\\repo\\packages\\foo\\src\\service.js', { imports: [], exports: ['service'] }],
    ['C:\\repo\\packages\\foo\\test\\service.test.js', { imports: [], exports: ['testService'] }],
    ['C:\\repo\\packages\\foo\\test\\mismatch\\service.test.js', { imports: [], exports: ['testService'] }],
  ]);
  depGraph.reverseGraph = new Map();
  return depGraph;
}

function main() {
  const depGraph = makeGraph();

  const withoutHeuristic = depGraph.findAffectedTests('/repo/src/feature.js', 5, { includeHeuristic: false });
  assert.strictEqual(withoutHeuristic.length, 0, 'graph-only search should not find tests without dependents');

  const withHeuristic = depGraph.findAffectedTests('/repo/src/feature.js');
  const files = withHeuristic.map((entry) => entry.file.replace(/\\/g, '/'));

  assert(files.includes('/repo/test/feature.test.js'), 'matching test in mirrored layout should be included');
  assert(!files.includes('/repo/test/group-b/feature.test.js'), 'same-stem test in different layout should not be included');
  assert(!files.includes('/repo/test/client/auth/login.test.js'), 'cross-layer same-stem test should not be included');
  assert(!files.includes('/repo/src/test/java/server/auth/LoginTests.java'), 'JS source should not match Java tests via heuristic');

  const packageTests = depGraph.findAffectedTests('/repo/packages/foo/src/service.js');
  const packageFiles = packageTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(packageFiles.includes('/repo/packages/foo/test/service.test.js'), 'package-local mirrored test should be included');
  assert(!packageFiles.includes('/repo/packages/foo/test/group-b/service.test.js'), 'package-local nested test with different layout should not be included');

  const javaTests = depGraph.findAffectedTests('/repo/src/main/java/com/acme/Foo.java');
  const javaFiles = javaTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(javaFiles.includes('/repo/src/test/java/com/acme/FooTests.java'), 'Java *Tests test should be included');
  assert(javaFiles.includes('/repo/src/test/java/com/acme/FooSpecs.java'), 'Java *Specs test should be included');
  assert(javaFiles.includes('/repo/src/test/java/com/acme/FooTestCases.java'), 'Java *TestCases test should be included');
  assert(javaFiles.includes('/repo/src/test/java/com/acme/FooITs.java'), 'Java *ITs test should be included');
  assert(!javaFiles.includes('/repo/src/test/java/com/acme/FooHelperTests.java'), 'different Java test class should not be included');
  assert(!javaFiles.includes('/repo/src/test/java/com/acme/FooHelperSpecs.java'), 'different Java specs class should not be included');

  const auditTests = depGraph.findAffectedTests('/repo/src/main/java/com/acme/Audit.java');
  const auditFiles = auditTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(auditFiles.includes('/repo/src/test/java/com/acme/AuditTests.java'), 'Java AuditTests test should be included');

  const itTests = depGraph.findAffectedTests('/repo/src/main/java/com/acme/Foo.java');
  const itFiles = itTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(itFiles.includes('/repo/src/test/java/com/acme/FooIT.java'), 'Java IT-style test should be included');

  const winTests = depGraph.findAffectedTests('C:\\repo\\packages\\foo\\src\\service.js');
  const winFiles = winTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(winFiles.includes('C:/repo/packages/foo/test/service.test.js'), 'Windows mirrored test should be included');
  assert(!winFiles.includes('C:/repo/packages/foo/test/mismatch/service.test.js'), 'Windows mismatched layout should not be included');

  console.log('affected-tests-heuristic-test: ok');
}

main();
