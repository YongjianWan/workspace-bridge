const assert = require('assert');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');

function testBuildLanguageSupportMatrix() {
  const root = '/repo';
  const depGraph = new DependencyGraph(root, { fileMetadata: new Map() });

  depGraph.graph.set(path.join(root, 'src', 'app.js'), {
    imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast',
  });
  depGraph.graph.set(path.join(root, 'src', 'util.ts'), {
    imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast',
  });
  depGraph.graph.set(path.join(root, 'lib', 'helper.py'), {
    imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast',
  });
  depGraph.graph.set(path.join(root, 'lib', 'legacy.py'), {
    imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex',
  });
  depGraph.graph.set(path.join(root, 'src', 'main.go'), {
    imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex',
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

testBuildLanguageSupportMatrix();
