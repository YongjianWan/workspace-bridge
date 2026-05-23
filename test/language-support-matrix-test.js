// @semantic
const assert = require('assert');
const path = require('path');
const { createMockDepGraph } = require('./test-helpers');

function testBuildLanguageSupportMatrix() {
  const root = '/repo';
  const depGraph = createMockDepGraph({
    schema: {
      [path.join(root, 'src', 'app.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'src', 'util.ts')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'lib', 'helper.py')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'lib', 'legacy.py')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex' },
      [path.join(root, 'src', 'main.go')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex' },
    }
  });

  const { buildLanguageSupportMatrix } = require('../src/tools/overview-assembler');
  const matrix = buildLanguageSupportMatrix(depGraph);

  assert.strictEqual(matrix.javascript.level, 'ast', 'javascript should be ast');
  assert.strictEqual(matrix.javascript.confidence, 'high', 'javascript should have high confidence (2/2 ast)');
  assert.strictEqual(matrix.python.level, 'ast', 'python should be ast (1/2 ast, ratio >= 0.5)');
  assert.strictEqual(matrix.python.confidence, 'medium', 'python should have medium confidence');
  assert.strictEqual(matrix.go.level, 'regex', 'go should be regex (all files are regex-parsed)');
  assert.strictEqual(matrix.go.confidence, 'low', 'go should have low confidence (0 ast)');
  assert.strictEqual(matrix.java, undefined, 'java should not be present');
}

function testBuildLanguageSupportMatrixEmpty() {
  const root = '/repo';
  const depGraph = createMockDepGraph({ schema: {} });
  const { buildLanguageSupportMatrix } = require('../src/tools/overview-assembler');
  const matrix = buildLanguageSupportMatrix(depGraph);
  assert.deepStrictEqual(matrix, {}, 'empty graph should yield empty matrix');
}

testBuildLanguageSupportMatrix();
testBuildLanguageSupportMatrixEmpty();

