#!/usr/bin/env node
// @semantic
// @slow — builds large mock DependencyGraph; must not run concurrently with other graph-building tests.

const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');

function makeGraph() {
  const depGraph = createMockDepGraph({
    schema: {
      '/repo/src/feature.js': { imports: [], exports: ['feature'] },
      '/repo/test/feature.test.js': { imports: [], exports: ['testFeature'] },
      '/repo/test/group-b/feature.test.js': { imports: [], exports: ['testFeature'] },
      '/repo/src/server/auth/login.js': { imports: [], exports: ['login'] },
      '/repo/test/client/auth/login.test.js': { imports: [], exports: ['testLogin'] },
      '/repo/src/test/java/server/auth/LoginTests.java': { imports: [], exports: ['LoginTests'] },
      '/repo/packages/foo/src/service.js': { imports: [], exports: ['service'] },
      '/repo/packages/foo/test/service.test.js': { imports: [], exports: ['testService'] },
      '/repo/packages/foo/test/group-b/service.test.js': { imports: [], exports: ['testService'] },
      '/repo/src/main/java/com/acme/Foo.java': { imports: [], exports: ['Foo'] },
      '/repo/src/test/java/com/acme/FooTests.java': { imports: [], exports: ['FooTests'] },
      '/repo/src/test/java/com/acme/FooSpecs.java': { imports: [], exports: ['FooSpecs'] },
      '/repo/src/test/java/com/acme/FooTestCases.java': { imports: [], exports: ['FooTestCases'] },
      '/repo/src/test/java/com/acme/FooITs.java': { imports: [], exports: ['FooITs'] },
      '/repo/src/test/java/com/acme/FooHelperTests.java': { imports: [], exports: ['FooHelperTests'] },
      '/repo/src/test/java/com/acme/FooHelperSpecs.java': { imports: [], exports: ['FooHelperSpecs'] },
      '/repo/src/main/java/com/acme/Audit.java': { imports: [], exports: ['Audit'] },
      '/repo/src/test/java/com/acme/AuditTests.java': { imports: [], exports: ['AuditTests'] },
      '/repo/src/test/java/com/acme/FooIT.java': { imports: [], exports: ['FooIT'] },
      // __tests__ layout (React/Vue convention)
      '/repo/src/utils/request.js': { imports: [], exports: ['request'] },
      '/repo/__tests__/utils/request.test.js': { imports: [], exports: ['testRequest'] },
      '/repo/__tests__/utils/other.test.js': { imports: [], exports: ['testOther'] },
      // Java extended suffixes
      '/repo/src/main/java/com/acme/Service.java': { imports: [], exports: ['Service'] },
      '/repo/src/test/java/com/acme/ServiceUnitTest.java': { imports: [], exports: ['ServiceUnitTest'] },
      '/repo/src/test/java/com/acme/ServiceIntegrationTest.java': { imports: [], exports: ['ServiceIntegrationTest'] },
      '/repo/src/test/java/com/acme/ServiceHelperUnitTest.java': { imports: [], exports: ['ServiceHelperUnitTest'] },
      // Cypress / E2E / integration
      '/repo/src/components/Button.js': { imports: [], exports: ['Button'] },
      '/repo/cypress/components/Button.cy.js': { imports: [], exports: ['testButton'] },
      '/repo/src/components/Modal.js': { imports: [], exports: ['Modal'] },
      '/repo/e2e/components/Modal.e2e.js': { imports: [], exports: ['testModal'] },
      // Ruby
      '/repo/app/models/user.rb': { imports: [], exports: ['User'] },
      '/repo/spec/models/user_spec.rb': { imports: [], exports: ['testUser'] },
      '/repo/spec/models/admin_spec.rb': { imports: [], exports: ['testAdmin'] },
    }
  });
  return depGraph;
}

function makeWindowsGraph() {
  // Separate Windows-only graph so originalPath stays in Windows format and
  // assertions can be strict. Mixing POSIX and Windows keys in one schema makes
  // them normalize to the same graph key and leaves only one originalPath.
  return createMockDepGraph({
    schema: {
      'C:\\repo\\packages\\foo\\src\\service.js': { imports: [], exports: ['service'] },
      'C:\\repo\\packages\\foo\\test\\service.test.js': { imports: [], exports: ['testService'] },
      'C:\\repo\\packages\\foo\\test\\mismatch\\service.test.js': { imports: [], exports: ['testService'] },
    }
  });
}

function testHeuristicDisabled() {
  const depGraph = makeGraph();
  const withoutHeuristic = depGraph.findAffectedTests('/repo/src/feature.js', 5, { includeHeuristic: false });
  assert.strictEqual(withoutHeuristic.length, 0, 'graph-only search should not find tests without dependents');
}

function testMirroredLayout() {
  const depGraph = makeGraph();
  const withHeuristic = depGraph.findAffectedTests('/repo/src/feature.js');
  const files = withHeuristic.map((entry) => entry.file.replace(/\\/g, '/'));

  assert(files.includes('/repo/test/feature.test.js'), 'matching test in mirrored layout should be included');
  assert(!files.includes('/repo/test/group-b/feature.test.js'), 'same-stem test in different layout should not be included');
  assert(!files.includes('/repo/test/client/auth/login.test.js'), 'cross-layer same-stem test should not be included');
  assert(!files.includes('/repo/src/test/java/server/auth/LoginTests.java'), 'JS source should not match Java tests via heuristic');
}

function testPackageLocalMirroredLayout() {
  const depGraph = makeGraph();
  const packageTests = depGraph.findAffectedTests('/repo/packages/foo/src/service.js');
  const packageFiles = packageTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(packageFiles.includes('/repo/packages/foo/test/service.test.js'), 'package-local mirrored test should be included');
  assert(!packageFiles.includes('/repo/packages/foo/test/group-b/service.test.js'), 'package-local nested test with different layout should not be included');
}

function testJavaSuffixes() {
  const depGraph = makeGraph();

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
}

function testWindowsPaths() {
  if (process.platform !== 'win32') {
    // Windows path heuristics require path.win32 semantics; skip on POSIX.
    return;
  }
  const depGraph = makeWindowsGraph();
  const winTests = depGraph.findAffectedTests('C:\\repo\\packages\\foo\\src\\service.js');
  const winFiles = winTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(winFiles.includes('C:/repo/packages/foo/test/service.test.js'), 'Windows mirrored test should be included');
  assert(!winFiles.includes('C:/repo/packages/foo/test/mismatch/service.test.js'), 'Windows mismatched layout should not be included');
}

function testDunderTestsLayout() {
  const depGraph = makeGraph();
  const dunderTests = depGraph.findAffectedTests('/repo/src/utils/request.js');
  const dunderFiles = dunderTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(dunderFiles.includes('/repo/__tests__/utils/request.test.js'), '__tests__ mirrored layout should be included');
  assert(!dunderFiles.includes('/repo/__tests__/utils/other.test.js'), 'different __tests__ file should not be included');
}

function testJavaExtendedSuffixes() {
  const depGraph = makeGraph();
  const javaExtendedTests = depGraph.findAffectedTests('/repo/src/main/java/com/acme/Service.java');
  const javaExtendedFiles = javaExtendedTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(javaExtendedFiles.includes('/repo/src/test/java/com/acme/ServiceUnitTest.java'), 'Java *UnitTest should be included');
  assert(javaExtendedFiles.includes('/repo/src/test/java/com/acme/ServiceIntegrationTest.java'), 'Java *IntegrationTest should be included');
  assert(!javaExtendedFiles.includes('/repo/src/test/java/com/acme/ServiceHelperUnitTest.java'), 'different Java helper test should not be included');
}

function testCypressAndE2E() {
  const depGraph = makeGraph();
  const cypressTests = depGraph.findAffectedTests('/repo/src/components/Button.js');
  const cypressFiles = cypressTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(cypressFiles.includes('/repo/cypress/components/Button.cy.js'), 'Cypress .cy.js test should be included');

  const e2eTests = depGraph.findAffectedTests('/repo/src/components/Modal.js');
  const e2eFiles = e2eTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(e2eFiles.includes('/repo/e2e/components/Modal.e2e.js'), 'E2E .e2e.js test should be included');
}

function testRuby() {
  const depGraph = makeGraph();
  const rubyTests = depGraph.findAffectedTests('/repo/app/models/user.rb');
  const rubyFiles = rubyTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(rubyFiles.includes('/repo/spec/models/user_spec.rb'), 'Ruby spec should be included');
  assert(!rubyFiles.includes('/repo/spec/models/admin_spec.rb'), 'different Ruby spec should not be included');
}

function main() {
  testHeuristicDisabled();
  testMirroredLayout();
  testPackageLocalMirroredLayout();
  testJavaSuffixes();
  testWindowsPaths();
  testDunderTestsLayout();
  testJavaExtendedSuffixes();
  testCypressAndE2E();
  testRuby();
}

main();
