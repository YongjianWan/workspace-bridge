#!/usr/bin/env node
// @semantic

const assert = require('assert');
const {
  isTestLikeFile,
  isCollectedTestFile,
  buildHeuristicSignature,
  getHeuristicLanguageFamily,
  normalizeHeuristicName,
} = require('../src/utils/test-detector');

function testIsTestLikeFile() {
  assert.strictEqual(isTestLikeFile('foo.test.js'), true);
  assert.strictEqual(isTestLikeFile('foo.spec.ts'), true);
  assert.strictEqual(isTestLikeFile('__tests__/bar.js'), true);
  assert.strictEqual(isTestLikeFile('test_foo.py'), true);
  assert.strictEqual(isTestLikeFile('tests/unit/baz.rs'), true);
  assert.strictEqual(isTestLikeFile('src/main.js'), false);
  // P82: Maven Java test naming conventions
  assert.strictEqual(isTestLikeFile('src/test/java/com/example/FooTest.java'), true);
  assert.strictEqual(isTestLikeFile('src/test/java/com/example/FooTests.java'), true);
  assert.strictEqual(isTestLikeFile('src/test/java/com/example/FooIT.java'), true);
  assert.strictEqual(isTestLikeFile('src/test/java/com/example/AbstractTest.java'), true);
  assert.strictEqual(isTestLikeFile('src/main/java/com/example/FooService.java'), false);
}

// P0-12: isCollectedTestFile is what a runner executes — Python follows
// pytest collection (test_*.py / *_test.py) plus Django's per-app tests.py;
// a test-ish path or name is not enough. isTestLikeFile keeps the broader
// test-area answer for dead-exports/orphan scoping.
function testIsCollectedTestFile() {
  assert.strictEqual(isCollectedTestFile('tests/test_models.py'), true);
  assert.strictEqual(isCollectedTestFile('pkg/models_test.py'), true);
  assert.strictEqual(isCollectedTestFile('app/tests.py'), true);
  assert.strictEqual(isCollectedTestFile('tests/conftest.py'), false);
  assert.strictEqual(isCollectedTestFile('pkg/testing.py'), false);
  assert.strictEqual(isCollectedTestFile('tests/atomic_write_example.py'), false);
  assert.strictEqual(isCollectedTestFile('tests/models.py'), false);
  assert.strictEqual(isCollectedTestFile('django/test/utils.py'), false);
  assert.strictEqual(isCollectedTestFile('tests/helpers.py'), false);
  // non-Python currently shares the test-area rules
  assert.strictEqual(isCollectedTestFile('foo.test.js'), true);
  assert.strictEqual(isCollectedTestFile('src/test/java/com/example/FooTest.java'), true);
  assert.strictEqual(isCollectedTestFile('tests/unit/baz.rs'), true);
  assert.strictEqual(isCollectedTestFile('src/main.js'), false);
}

function testBuildHeuristicSignature() {
  const sig = buildHeuristicSignature('/workspace', '/workspace/src/utils/path.js');
  // HEURISTIC_ROOT_SEGMENTS filters out 'src', so result is 'utils/path'
  assert.strictEqual(sig, 'utils/path');
}

function testGetHeuristicLanguageFamily() {
  assert.strictEqual(getHeuristicLanguageFamily('a.js'), 'js-family');
  assert.strictEqual(getHeuristicLanguageFamily('a.ts'), 'js-family');
  assert.strictEqual(getHeuristicLanguageFamily('a.py'), 'python-family');
  assert.strictEqual(getHeuristicLanguageFamily('a.rs'), 'rust-family');
  assert.strictEqual(getHeuristicLanguageFamily('a.go'), 'go-family');
  assert.strictEqual(getHeuristicLanguageFamily('a.java'), 'java-family');
}

function testNormalizeHeuristicName() {
  assert.strictEqual(normalizeHeuristicName('test_foo.js'), 'foo');
  assert.strictEqual(normalizeHeuristicName('foo.test.js'), 'foo');
  assert.strictEqual(normalizeHeuristicName('foo.spec.ts'), 'foo');
  assert.strictEqual(normalizeHeuristicName('foo.js'), 'foo');
}

function main() {
  testIsTestLikeFile();
  testIsCollectedTestFile();
  testBuildHeuristicSignature();
  testGetHeuristicLanguageFamily();
  testNormalizeHeuristicName();
}

main();
