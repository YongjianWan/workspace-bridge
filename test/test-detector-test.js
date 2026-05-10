#!/usr/bin/env node

const assert = require('assert');
const {
  isTestLikeFile,
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
  testBuildHeuristicSignature();
  testGetHeuristicLanguageFamily();
  testNormalizeHeuristicName();
  console.log('test-detector-test: all passed');
}

main();
